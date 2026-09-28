import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  cleanTrigger,
  delayedEventKey,
  DELAYED_EVENTS,
  eventKey,
  lastActivityAt,
  MAX_AUTOMATION_DEPTH,
  missingTriggerFields,
  triggerMatches,
} from "../../pipeline-automation/automation";
import { isPublicWebhookUrl } from "../../pipeline-automation/webhooks";
import type {
  ApiKey,
  ApiKeyScope,
  CreatedApiKey,
  StageTrigger,
  StageTriggerEvent,
  StageTriggerRun,
  Webhook,
  WebhookDelivery,
} from "../../pipeline-automation/types";
import type {
  Call,
  Deal,
  DealNote,
  DealPayment,
  Message,
  OrganizationSettings,
  Patient,
  Sale,
  Stage,
  Task,
} from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const randomHex = (length: number) =>
  Array.from({ length }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");

export const DEMO_API_BASE_URL = "https://demo.dentalcrm.kz/functions/v1/api";

/**
 * Digital pipeline, webhooks and API keys of the demo (stage 20): the same
 * rules as the database (supabase/schemas/20_digital_pipeline.sql) on the
 * in-browser data. Triggers run from the lifecycle callbacks of the deals,
 * payments and calls, and from the messages the demo stores; the delayed
 * ones when a deal feed is read. Webhook "sending" is simulated: a pending
 * delivery of an active webhook is delivered when the deliveries are listed.
 */
export const createDigitalPipelineDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
  renderTemplate,
  startSalesbot,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  /** The provider with the lifecycle callbacks (deal triggers) */
  getDataProvider: () => DataProvider;
  /** Text of a template for a deal (same as the auto-messages) */
  renderTemplate: (deal: Deal, templateId: Identifier) => Promise<string>;
  /** «Запустить салесбот» (stage 26): the session, null when not started */
  startSalesbot: (
    dealId: Identifier,
    botId: Identifier,
  ) => Promise<{ id: Identifier } | null>;
}) => {
  /** Nesting of the automatic actions (crm.automation_depth) */
  let depth = 0;
  const nowIso = () => new Date().toISOString();

  const getDeal = async (id: Identifier) =>
    (await all<Deal>("deals")).find((deal) => same(deal.id, id));

  const requireManager = async () => {
    const salesId = await currentSalesId();
    const me = (await all<Sale>("sales")).find((sale) =>
      same(sale.id, salesId),
    );
    // The integrator (stage 25) configures the webhooks and the keys too
    if (
      me &&
      me.role !== "owner" &&
      me.role !== "head" &&
      me.role !== "integrator"
    ) {
      throw new Error("api.errors.forbidden");
    }
  };

  // --- webhooks -----------------------------------------------------------

  const enqueueWebhook = async (
    event: string,
    data: Record<string, unknown>,
    onlyWebhookId?: Identifier | null,
  ) => {
    const webhooks = (await all<Webhook>("webhooks")).filter(
      (webhook) =>
        webhook.is_active &&
        (onlyWebhookId != null
          ? same(webhook.id, onlyWebhookId)
          : (webhook.events as string[]).includes(event)),
    );
    for (const webhook of webhooks) {
      const now = nowIso();
      await baseDataProvider.create("webhook_deliveries", {
        data: {
          webhook_id: webhook.id,
          event,
          payload: { event, occurred_at: now, organization_id: 1, data },
          status: "pending",
          attempts: 0,
          next_attempt_at: now,
          response_status: null,
          error: null,
          delivered_at: null,
          created_at: now,
        } satisfies Omit<WebhookDelivery, "id">,
      });
    }
    return webhooks.length;
  };

  /** The demo "dispatcher": nothing leaves the browser, every delivery succeeds */
  const dispatchWebhooks = async () => {
    const [deliveries, webhooks] = await Promise.all([
      all<WebhookDelivery>("webhook_deliveries"),
      all<Webhook>("webhooks"),
    ]);
    for (const delivery of deliveries.filter((d) => d.status === "pending")) {
      const webhook = webhooks.find((w) => same(w.id, delivery.webhook_id));
      if (!webhook?.is_active) continue;
      const now = nowIso();
      await baseDataProvider.update("webhook_deliveries", {
        id: delivery.id,
        data: {
          status: "delivered",
          attempts: delivery.attempts + 1,
          response_status: 200,
          error: null,
          delivered_at: now,
        },
        previousData: delivery,
      });
      await baseDataProvider.update("webhooks", {
        id: webhook.id,
        data: { failure_count: 0, last_success_at: now },
        previousData: webhook,
      });
    }
  };

  const dealData = async (deal: Deal) => {
    const stage = (await all<Stage>("stages")).find((s) =>
      same(s.id, deal.stage_id),
    );
    return {
      deal_id: deal.id,
      patient_id: deal.patient_id,
      deal: {
        id: deal.id,
        name: deal.name ?? null,
        patient_id: deal.patient_id,
        pipeline_id: deal.pipeline_id,
        stage_id: deal.stage_id,
        stage_name: stage?.name ?? null,
        stage_kind: stage?.kind ?? null,
        sales_id: deal.sales_id ?? null,
        plan_amount: deal.plan_amount,
        paid_amount: deal.paid_amount,
        appointment_at: deal.appointment_at ?? null,
        updated_at: deal.updated_at,
      },
    };
  };

  // --- triggers -----------------------------------------------------------

  const nextResponsible = async () => {
    const [settings] = await all<OrganizationSettings & { id: Identifier }>(
      "organization_settings",
    );
    const sales = await all<Sale>("sales");
    if (settings?.lead_distribution !== "round_robin") return null;
    const queue = settings.lead_distribution_sales_ids.filter((id) =>
      sales.some((sale) => same(sale.id, id) && !sale.disabled),
    );
    if (!queue.length) return null;
    const last = queue.findIndex((id) =>
      same(id, settings.last_distributed_sales_id),
    );
    const chosen = queue[(last + 1) % queue.length];
    await baseDataProvider.update("organization_settings", {
      id: settings.id,
      data: { last_distributed_sales_id: chosen },
      previousData: settings,
    });
    return chosen;
  };

  const updateDeal = (deal: Deal, data: Partial<Deal>) =>
    getDataProvider().update<Deal>("deals", {
      id: deal.id,
      data,
      previousData: deal,
    });

  /** Same as private.apply_stage_trigger_action */
  const applyAction = async (
    trigger: StageTrigger,
    deal: Deal,
  ): Promise<StageTriggerRun["details"]> => {
    switch (trigger.action) {
      case "move_stage":
        if (same(deal.stage_id, trigger.target_stage_id)) {
          return { unchanged: true };
        }
        await updateDeal(deal, { stage_id: trigger.target_stage_id! });
        return {
          from_stage_id: deal.stage_id,
          to_stage_id: trigger.target_stage_id!,
        };
      case "set_responsible": {
        const salesId = trigger.target_sales_id ?? (await nextResponsible());
        if (salesId == null) {
          throw new Error(
            "Некому назначить: распределение по очереди не настроено",
          );
        }
        if (same(deal.sales_id, salesId)) return { unchanged: true };
        await updateDeal(deal, { sales_id: salesId });
        return { from_sales_id: deal.sales_id ?? null, to_sales_id: salesId };
      }
      case "add_tag":
      case "remove_tag": {
        const tagId = Number(trigger.tag_id);
        const has = deal.tags.some((tag) => same(tag, tagId));
        if (has === (trigger.action === "add_tag")) {
          return { unchanged: true, tag_id: tagId };
        }
        await updateDeal(deal, {
          tags:
            trigger.action === "add_tag"
              ? [...deal.tags, tagId]
              : deal.tags.filter((tag) => !same(tag, tagId)),
        });
        return { tag_id: tagId };
      }
      case "create_task": {
        const { data: task } = await getDataProvider().create<Task>("tasks", {
          data: {
            deal_id: deal.id,
            type: trigger.task_type ?? "call",
            text: trigger.task_text ?? "",
            due_date: new Date(
              Date.now() + (trigger.task_due_minutes ?? 0) * 60_000,
            ).toISOString(),
            done_date: null,
            sales_id: deal.sales_id ?? undefined,
          },
        });
        return { task_id: task.id };
      }
      case "send_template": {
        const mode = trigger.message_mode ?? "auto";
        const now = nowIso();
        if (mode === "confirm") {
          const text = await renderTemplate(deal, trigger.template_id!);
          const { data: row } = await baseDataProvider.create("automessages", {
            data: {
              deal_id: deal.id,
              rule_id: null,
              template_id: trigger.template_id,
              stage_id: deal.stage_id,
              timing: "after_stage",
              send_at: now,
              status: "awaiting",
              text,
              processed_at: now,
              created_at: now,
            },
          });
          await baseDataProvider.create("tasks", {
            data: {
              deal_id: deal.id,
              type: "message",
              text,
              due_date: now,
              done_date: null,
              sales_id: deal.sales_id ?? undefined,
              automessage_id: row.id,
              created_at: now,
            },
          });
          return {
            automessage_id: row.id,
            template_id: trigger.template_id!,
            mode,
          };
        }
        const { data: row } = await baseDataProvider.create("automessages", {
          data: {
            deal_id: deal.id,
            rule_id: null,
            template_id: trigger.template_id,
            stage_id: deal.stage_id,
            timing: "after_stage",
            send_at: now,
            status: "pending",
            created_at: now,
          },
        });
        return {
          automessage_id: row.id,
          template_id: trigger.template_id!,
          mode,
        };
      }
      case "send_webhook": {
        const queued = await enqueueWebhook(
          "automation",
          {
            ...(await dealData(deal)),
            trigger: {
              id: trigger.id,
              name: trigger.name ?? null,
              event: trigger.event,
            },
          },
          trigger.webhook_id,
        );
        if (!queued) throw new Error("Вебхук выключен");
        return { webhook_id: trigger.webhook_id! };
      }
      case "start_salesbot": {
        const session = await startSalesbot(deal.id, trigger.salesbot_id!);
        if (!session) throw new Error("Бот не запущен");
        return { salesbot_id: trigger.salesbot_id!, session_id: session.id };
      }
      case "set_field": {
        const field = trigger.field_name!;
        const value =
          field === "plan_amount"
            ? Number(trigger.plan_amount ?? 0)
            : field === "doctor_id"
              ? trigger.doctor_id
              : trigger.service_id;
        const from = (deal as Record<string, unknown>)[field] ?? null;
        await updateDeal(deal, { [field]: value } as Partial<Deal>);
        return { field, from, to: value };
      }
    }
  };

  /** Same as private.fire_stage_trigger */
  const fire = async (
    trigger: StageTrigger,
    dealId: Identifier,
    key: string,
  ) => {
    const deal = await getDeal(dealId);
    if (
      !deal ||
      deal.archived_at ||
      !same(deal.stage_id, trigger.stage_id) ||
      !triggerMatches(trigger, deal)
    ) {
      return null;
    }
    const runs = await all<StageTriggerRun>("stage_trigger_runs");
    if (
      runs.some(
        (run) =>
          same(run.trigger_id, trigger.id) &&
          same(run.deal_id, deal.id) &&
          run.event_key === key,
      )
    ) {
      return null;
    }
    const { data: run } = await baseDataProvider.create<StageTriggerRun>(
      "stage_trigger_runs",
      {
        data: {
          deal_id: deal.id,
          trigger_id: trigger.id,
          trigger_name: trigger.name ?? null,
          event: trigger.event,
          event_key: key,
          action: trigger.action,
          status: "done",
          details: {},
          error: null,
          created_at: nowIso(),
        },
      },
    );
    let status: StageTriggerRun["status"] = "done";
    let details: StageTriggerRun["details"] = {};
    let error: string | null = null;
    if (depth >= MAX_AUTOMATION_DEPTH) {
      status = "skipped";
      error = "Слишком длинная цепочка автоматических действий";
    } else {
      depth++;
      try {
        details = await applyAction(trigger, deal);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        status = error.startsWith("Выполните чек-лист") ? "skipped" : "failed";
      } finally {
        depth--;
      }
    }
    await baseDataProvider.update("stage_trigger_runs", {
      id: run.id,
      data: { status, details, error },
      previousData: run,
    });
    return status;
  };

  /** Same as private.run_stage_triggers */
  const runTriggers = async (
    deal: Deal,
    event: StageTriggerEvent,
    key: string,
  ) => {
    if (deal.archived_at) return 0;
    const triggers = (await all<StageTrigger>("stage_triggers"))
      .filter(
        (trigger) =>
          trigger.is_active &&
          trigger.event === event &&
          same(trigger.stage_id, deal.stage_id),
      )
      .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));
    let fired = 0;
    for (const trigger of triggers) {
      if (await fire(trigger, deal.id, key)) fired++;
    }
    return fired;
  };

  /** Same as private.stage_triggers_tick (the demo runs it when a feed is read) */
  let lastTick = 0;
  const tick = async (now = new Date()) => {
    const triggers = (await all<StageTrigger>("stage_triggers")).filter(
      (trigger) => trigger.is_active && DELAYED_EVENTS.includes(trigger.event),
    );
    if (!triggers.length) return 0;
    const [deals, messages, notes, calls, tasks] = await Promise.all([
      all<Deal>("deals"),
      all<Message>("messages"),
      all<DealNote>("deal_notes"),
      all<Call>("calls"),
      all<Task>("tasks"),
    ]);
    let fired = 0;
    for (const trigger of triggers) {
      for (const deal of deals.filter(
        (d) =>
          same(d.stage_id, trigger.stage_id) &&
          !d.archived_at &&
          triggerMatches(trigger, d),
      )) {
        const key = delayedEventKey(
          trigger,
          deal,
          lastActivityAt({ deal, messages, notes, calls, tasks }),
          now,
        );
        if (key && (await fire(trigger, deal.id, key))) fired++;
      }
    }
    return fired;
  };
  const throttledTick = async () => {
    if (Date.now() - lastTick < 30_000) return;
    lastTick = Date.now();
    await tick();
  };

  // --- events -------------------------------------------------------------

  const onDealCreated = async (deal: Deal) => {
    await enqueueWebhook("deal.created", await dealData(deal));
    await runTriggers(
      deal,
      "stage_entered",
      eventKey(
        "stage_entered",
        deal.stage_changed_at ?? deal.created_at,
        deal.stage_id,
      ),
    );
    if (deal.appointment_at) {
      const current = await getDeal(deal.id);
      if (current) {
        await runTriggers(
          current,
          "appointment_set",
          eventKey("appointment_set", deal.appointment_at),
        );
      }
    }
  };

  const onDealUpdated = async (previous: Deal, deal: Deal) => {
    if (!same(previous.stage_id, deal.stage_id)) {
      const data = await dealData(deal);
      await enqueueWebhook("deal.stage_changed", {
        ...data,
        previous_stage_id: previous.stage_id,
      });
      const kind = data.deal.stage_kind;
      if (kind === "won" || kind === "lost") {
        await enqueueWebhook(`deal.${kind}`, data);
      }
      await runTriggers(
        deal,
        "stage_entered",
        eventKey(
          "stage_entered",
          deal.stage_changed_at ?? nowIso(),
          deal.stage_id,
        ),
      );
    }
    if (
      deal.appointment_at &&
      (deal.appointment_at ?? null) !== (previous.appointment_at ?? null)
    ) {
      const current = await getDeal(deal.id);
      if (current) {
        await runTriggers(
          current,
          "appointment_set",
          eventKey("appointment_set", deal.appointment_at),
        );
      }
    }
  };

  /** A message stored by the demo (sent from the deal page, auto-message) */
  const onMessage = async (message: Message) => {
    if (message.direction === "in") {
      await enqueueWebhook("message.received", {
        message_id: message.id,
        deal_id: message.deal_id,
        patient_id: message.patient_id,
        message: {
          id: message.id,
          transport: message.transport,
          text: message.text ?? null,
          sent_at: message.sent_at,
        },
      });
    }
    const deal = await getDeal(message.deal_id);
    if (deal) {
      await runTriggers(
        deal,
        message.direction === "in" ? "message_in" : "message_out",
        eventKey("message_in", message.id),
      );
    }
  };

  const onCall = async (call: Call, previous?: Call) => {
    if (
      call.status === "missed" &&
      call.direction === "in" &&
      call.deal_id != null &&
      previous?.status !== "missed"
    ) {
      const deal = await getDeal(call.deal_id);
      if (deal)
        await runTriggers(
          deal,
          "call_missed",
          eventKey("call_missed", call.id),
        );
    }
  };

  const previousDeals = new Map<Identifier, Deal>();
  const previousTasks = new Map<Identifier, Task>();
  const previousCalls = new Map<Identifier, Call>();

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "deals",
      beforeUpdate: async (params) => {
        const previous = await getDeal(params.id);
        if (previous) previousDeals.set(params.id, previous);
        return params;
      },
      afterCreate: async (result) => {
        await onDealCreated(result.data as Deal);
        return result;
      },
      afterUpdate: async (result) => {
        const deal = result.data as Deal;
        const previous = previousDeals.get(deal.id);
        previousDeals.delete(deal.id);
        if (previous) await onDealUpdated(previous, deal);
        return result;
      },
    },
    {
      resource: "deal_payments",
      afterCreate: async (result) => {
        const payment = result.data as DealPayment;
        const deal = await getDeal(payment.deal_id);
        await enqueueWebhook("payment.added", {
          payment_id: payment.id,
          deal_id: payment.deal_id,
          patient_id: deal?.patient_id ?? null,
          payment: {
            id: payment.id,
            amount: payment.amount,
            kind: payment.kind ?? "payment",
            paid_at: payment.paid_at,
          },
        });
        if (deal) {
          await runTriggers(
            deal,
            "payment_added",
            eventKey("payment_added", payment.id),
          );
        }
        return result;
      },
    },
    {
      resource: "patients",
      afterCreate: async (result) => {
        const patient = result.data as Patient;
        await enqueueWebhook("patient.created", {
          patient_id: patient.id,
          patient: {
            id: patient.id,
            first_name: patient.first_name ?? null,
            last_name: patient.last_name ?? null,
            phones: patient.phones ?? [],
          },
        });
        return result;
      },
    },
    {
      resource: "tasks",
      beforeUpdate: async (params) => {
        const previous = (await all<Task>("tasks")).find((t) =>
          same(t.id, params.id),
        );
        if (previous) previousTasks.set(params.id, previous);
        return params;
      },
      afterUpdate: async (result) => {
        const task = result.data as Task;
        const previous = previousTasks.get(task.id);
        previousTasks.delete(task.id);
        if (task.done_date && previous && !previous.done_date) {
          await enqueueWebhook("task.completed", {
            task_id: task.id,
            deal_id: task.deal_id,
            task: {
              id: task.id,
              deal_id: task.deal_id,
              type: task.type,
              text: task.text,
              done_date: task.done_date,
            },
          });
        }
        return result;
      },
    },
    {
      resource: "calls",
      beforeUpdate: async (params) => {
        const previous = (await all<Call>("calls")).find((c) =>
          same(c.id, params.id),
        );
        if (previous) previousCalls.set(params.id, previous);
        return params;
      },
      afterCreate: async (result) => {
        await onCall(result.data as Call);
        return result;
      },
      afterUpdate: async (result) => {
        const call = result.data as Call;
        const previous = previousCalls.get(call.id);
        previousCalls.delete(call.id);
        await onCall(call, previous);
        return result;
      },
    },
    {
      // Same as the checks and the trigger of public.stage_triggers
      resource: "stage_triggers",
      beforeCreate: async (params) => ({
        ...params,
        data: await normalizeTrigger(params.data),
      }),
      beforeUpdate: async (params) => {
        const previous = (await all<StageTrigger>("stage_triggers")).find((t) =>
          same(t.id, params.id),
        );
        return {
          ...params,
          data: await normalizeTrigger({ ...previous, ...params.data }),
        };
      },
    },
    {
      resource: "webhooks",
      beforeCreate: async (params) => {
        await requireManager();
        checkWebhook(params.data);
        return {
          ...params,
          data: {
            name: null,
            events: [],
            is_active: true,
            ...params.data,
            secret: randomHex(64),
            failure_count: 0,
            last_error: null,
            last_success_at: null,
            last_failure_at: null,
            disabled_at: null,
            created_at: nowIso(),
          },
        };
      },
      beforeUpdate: async (params) => {
        const previous = (await all<Webhook>("webhooks")).find((w) =>
          same(w.id, params.id),
        );
        const data = { ...params.data };
        if (data.url != null || data.events != null) {
          checkWebhook({ ...previous, ...data });
        }
        if (data.is_active === true && previous && !previous.is_active) {
          Object.assign(data, {
            failure_count: 0,
            disabled_at: null,
            last_error: null,
          });
        }
        if (data.is_active === false && previous?.is_active) {
          const pending = (
            await all<WebhookDelivery>("webhook_deliveries")
          ).filter(
            (d) => same(d.webhook_id, previous.id) && d.status === "pending",
          );
          for (const delivery of pending) {
            await baseDataProvider.update("webhook_deliveries", {
              id: delivery.id,
              data: { status: "cancelled", error: "Вебхук выключен" },
              previousData: delivery,
            });
          }
        }
        return { ...params, data };
      },
    },
    {
      resource: "webhook_deliveries",
      beforeGetList: async (params) => {
        await dispatchWebhooks();
        return params;
      },
    },
    {
      resource: "stage_trigger_runs",
      beforeGetList: async (params) => {
        await throttledTick();
        return params;
      },
    },
  ];

  const normalizeTrigger = async (data: Partial<StageTrigger>) => {
    await requireManager();
    const stage = (await all<Stage>("stages")).find((s) =>
      same(s.id, data.stage_id),
    );
    const trigger = cleanTrigger({
      source_ids: [],
      service_ids: [],
      doctor_ids: [],
      sales_ids: [],
      tags_present: [],
      tags_absent: [],
      delay_minutes: 0,
      is_active: true,
      position: 0,
      created_at: nowIso(),
      ...data,
      pipeline_id: stage?.pipeline_id,
      name: data.name?.trim() || null,
    });
    if (trigger.action === "move_stage") {
      const target = (await all<Stage>("stages")).find((s) =>
        same(s.id, trigger.target_stage_id),
      );
      if (target && !same(target.pipeline_id, stage?.pipeline_id)) {
        throw new Error("pipeline_automation.errors.other_pipeline");
      }
    }
    if (!stage || missingTriggerFields(trigger).length) {
      throw new Error("pipeline_automation.errors.incomplete");
    }
    return trigger;
  };

  const checkWebhook = (data: Partial<Webhook>) => {
    if (!data.url || !/^https?:\/\/[^/\s]+/.test(data.url)) {
      throw new Error("api.errors.webhook_url");
    }
    if (!isPublicWebhookUrl(data.url)) {
      throw new Error("api.errors.webhook_private");
    }
  };

  const methods = {
    async getApiBaseUrl(): Promise<string> {
      return DEMO_API_BASE_URL;
    },
    async listApiKeys(): Promise<ApiKey[]> {
      await requireManager();
      return (await all<ApiKey>("api_keys")).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
    },
    async createApiKey(
      name: string,
      scope: ApiKeyScope,
    ): Promise<CreatedApiKey> {
      await requireManager();
      if (!name.trim()) throw new Error("api.errors.key_name");
      const key = `dcrm_${randomHex(64)}`;
      const { data } = await baseDataProvider.create<ApiKey>("api_keys", {
        data: {
          name: name.trim(),
          prefix: key.slice(0, 12),
          scope,
          created_by: (await currentSalesId()) ?? null,
          created_at: nowIso(),
          last_used_at: null,
          revoked_at: null,
        },
      });
      return { ...data, key };
    },
    async revokeApiKey(id: Identifier): Promise<void> {
      await requireManager();
      const key = (await all<ApiKey>("api_keys")).find((k) => same(k.id, id));
      if (!key || key.revoked_at) return;
      await baseDataProvider.update("api_keys", {
        id,
        data: { revoked_at: nowIso() },
        previousData: key,
      });
    },
    async sendTestWebhook(id: Identifier): Promise<void> {
      await requireManager();
      const queued = await enqueueWebhook(
        "ping",
        { message: "Тестовое событие DentalCRM" },
        id,
      );
      if (!queued) throw new Error("api.errors.webhook_off");
    },
    async regenerateWebhookSecret(id: Identifier): Promise<string> {
      await requireManager();
      const webhook = (await all<Webhook>("webhooks")).find((w) =>
        same(w.id, id),
      );
      if (!webhook) throw new Error("api.errors.webhook_off");
      const secret = randomHex(64);
      await baseDataProvider.update("webhooks", {
        id,
        data: { secret },
        previousData: webhook,
      });
      return secret;
    },
  };

  return {
    callbacks,
    methods,
    onMessage,
    onCall,
    tick,
    isAutomating: () => depth > 0,
  };
};
