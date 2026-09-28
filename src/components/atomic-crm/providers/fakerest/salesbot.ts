import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  advance,
  isActive,
  isBroken,
  receiveReply,
  resumeDue,
  startSession,
  stopSession,
  validateScenario,
  type EngineHooks,
  type EngineSession,
} from "../../salesbot/engine";
import type {
  Salesbot,
  SalesbotLog,
  SalesbotSession,
  SessionTrigger,
  SetAction,
} from "../../salesbot/types";
import type {
  CrmNotification,
  CustomField,
  Deal,
  Message,
  Patient,
  Sale,
  Stage,
  Tag,
  Task,
} from "../../types";
import type { Webhook } from "../../pipeline-automation/types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/**
 * «Салесбот» of the demo (stage 26): the same engine as the editor's test
 * mode (salesbot/engine.ts) on the in-browser data, with the rules of the
 * database (supabase/schemas/26_salesbot.sql): one session per deal, starts
 * by hand, by the digital pipeline and by inbound messages, an employee's
 * own message stops the bot, the messages go through the auto-message
 * queue. Timeouts and delays are checked when sessions or logs are read.
 */
export const createSalesbotDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
  renderText,
  sendTime,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getDataProvider: () => DataProvider;
  /** Template variables of a deal in a text (same as the auto-messages) */
  renderText: (deal: Deal, body: string) => Promise<string>;
  /** Quiet hours */
  sendTime: (now: Date) => Date;
}) => {
  /** Nesting of the bot's own changes (no author, loop protection) */
  let depth = 0;
  const nowIso = () => new Date().toISOString();

  const getDeal = async (id: Identifier) =>
    (await all<Deal>("deals")).find((deal) => same(deal.id, id));
  const activeSession = async (dealId: Identifier) =>
    (await all<SalesbotSession>("salesbot_sessions")).find(
      (s) => same(s.deal_id, dealId) && isActive(s.status),
    );

  const requireConfigurator = async () => {
    const salesId = await currentSalesId();
    const me = (await all<Sale>("sales")).find((sale) =>
      same(sale.id, salesId),
    );
    if (me && me.role !== "owner" && me.role !== "head") {
      throw new Error("salesbot.errors.forbidden");
    }
  };

  const log = (
    session: Pick<SalesbotSession, "id" | "deal_id">,
    entry: Omit<SalesbotLog, "id" | "session_id" | "deal_id" | "created_at">,
  ) =>
    baseDataProvider.create<SalesbotLog>("salesbot_logs", {
      data: {
        session_id: session.id,
        deal_id: session.deal_id,
        created_at: nowIso(),
        ...entry,
      },
    });

  /** The hooks of the engine for one session of one deal */
  const hooksFor = (session: SalesbotSession): EngineHooks => {
    const dealNow = async () => (await getDeal(session.deal_id))!;
    return {
      sendTime,
      deal: async () => {
        const deal = await dealNow();
        return {
          stage_id: deal.stage_id,
          tags: deal.tags,
          source_id: deal.source_id,
          custom_values: deal.custom_values,
        };
      },
      render: async (body, reply) =>
        renderText(await dealNow(), body.split("{ответ}").join(reply ?? "")),
      templateBody: async (id) =>
        (await all<{ id: Identifier; body: string }>("message_templates")).find(
          (t) => same(t.id, id),
        )?.body,
      send: async (text, sendAt) => {
        const deal = await dealNow();
        await baseDataProvider.create("automessages", {
          data: {
            deal_id: deal.id,
            rule_id: null,
            template_id: null,
            stage_id: deal.stage_id,
            timing: "after_stage",
            send_at: sendAt.toISOString(),
            status: "pending",
            text,
            salesbot_session_id: session.id,
            created_at: nowIso(),
          },
        });
      },
      applySet: (action, reply) => applySet(action, reply, session.deal_id),
      createTask: async (step, text) => {
        const deal = await dealNow();
        await baseDataProvider.create("tasks", {
          data: {
            deal_id: deal.id,
            type: step.task_type ?? "call",
            text,
            due_date: new Date(
              Date.now() + (step.due_minutes ?? 0) * 60_000,
            ).toISOString(),
            done_date: null,
            sales_id: deal.sales_id ?? undefined,
            created_at: nowIso(),
          } satisfies Partial<Task>,
        });
      },
      handoff: async (step) => {
        const deal = await dealNow();
        let taskId: Identifier | null = null;
        if (step.create_task) {
          const { data: task } = await baseDataProvider.create<Task>("tasks", {
            data: {
              deal_id: deal.id,
              type: "message",
              text:
                step.task_text?.trim() ||
                "Ответить пациенту: бот передал диалог",
              due_date: nowIso(),
              done_date: null,
              sales_id: deal.sales_id ?? undefined,
            },
          });
          taskId = task.id;
        }
        const sales = await all<Sale>("sales");
        const recipients =
          deal.sales_id != null
            ? [deal.sales_id]
            : sales
                .filter(
                  (s) => !s.disabled && (s.role === "owner" || s.role === "head"),
                )
                .map((s) => s.id);
        const patient = (await all<Patient>("patients")).find((p) =>
          same(p.id, deal.patient_id),
        );
        const label = [
          [patient?.last_name, patient?.first_name].filter(Boolean).join(" ") ||
            "Пациент",
          deal.name,
        ]
          .filter(Boolean)
          .join(" · ");
        for (const recipient of recipients) {
          const now = nowIso();
          await baseDataProvider.create("notifications", {
            data: {
              sales_id: recipient,
              kind: "bot_handoff",
              title: "Бот передал диалог",
              body: step.text?.trim() ? `${label}: ${step.text.trim()}` : label,
              deal_id: deal.id,
              patient_id: deal.patient_id,
              task_id: taskId,
              message_count: 1,
              created_at: now,
              updated_at: now,
              read_at: null,
            } satisfies Omit<CrmNotification, "id">,
          });
        }
      },
      webhook: async (step) => {
        const webhook = (await all<Webhook>("webhooks")).find(
          (w) => same(w.id, step.webhook_id) && w.is_active,
        );
        if (!webhook) return false;
        const deal = await dealNow();
        const now = nowIso();
        await baseDataProvider.create("webhook_deliveries", {
          data: {
            webhook_id: webhook.id,
            event: "salesbot",
            payload: {
              event: "salesbot",
              occurred_at: now,
              organization_id: 1,
              data: {
                deal_id: deal.id,
                patient_id: deal.patient_id,
                salesbot: {
                  id: session.bot_id,
                  name: session.bot_name,
                  session_id: session.id,
                  step: step.id,
                },
              },
            },
            status: "pending",
            attempts: 0,
            next_attempt_at: now,
            created_at: now,
          },
        });
        return true;
      },
      log: async (entry) => {
        await log(session, {
          step_id: entry.step?.id ?? null,
          step_type: entry.step?.type ?? null,
          kind: entry.kind,
          text: entry.text ?? null,
          details: entry.details ?? {},
        });
      },
    };
  };

  /** Same as private.salesbot_apply_set */
  const applySet = async (
    action: SetAction,
    reply: string | null,
    dealId: Identifier,
  ): Promise<Record<string, unknown>> => {
    const deal = (await getDeal(dealId))!;
    const value = (action.value ?? "").split("{ответ}").join(reply ?? "");
    const update = (data: Partial<Deal>) =>
      getDataProvider().update<Deal>("deals", {
        id: deal.id,
        data,
        previousData: deal,
      });
    switch (action.kind) {
      case "stage": {
        const stage = (await all<Stage>("stages")).find((s) =>
          same(s.id, action.stage_id),
        );
        if (!stage || !same(stage.pipeline_id, deal.pipeline_id)) {
          throw new Error("Этап не найден в воронке сделки");
        }
        if (stage.kind === "lost") {
          throw new Error("Перевести в отказ может только сотрудник: нужна причина");
        }
        if (same(deal.stage_id, stage.id)) return { unchanged: true };
        await update({ stage_id: stage.id });
        return { from_stage_id: deal.stage_id, to_stage_id: stage.id };
      }
      case "responsible": {
        const salesId = action.sales_id;
        const sale = (await all<Sale>("sales")).find(
          (s) => same(s.id, salesId) && !s.disabled,
        );
        if (!sale) throw new Error("Некому назначить");
        if (same(deal.sales_id, sale.id)) return { unchanged: true };
        await update({ sales_id: sale.id });
        return { from_sales_id: deal.sales_id ?? null, to_sales_id: sale.id };
      }
      case "tag_add":
      case "tag_remove": {
        const tag = (await all<Tag>("tags")).find((t) =>
          same(t.id, action.tag_id),
        );
        if (!tag) throw new Error("Тег не найден");
        const has = deal.tags.some((t) => same(t, tag.id));
        if (has === (action.kind === "tag_add")) {
          return { unchanged: true, tag_id: tag.id };
        }
        await update({
          tags:
            action.kind === "tag_add"
              ? [...deal.tags, Number(tag.id)]
              : deal.tags.filter((t) => !same(t, tag.id)),
        });
        return { tag_id: tag.id };
      }
      case "field": {
        const field = (await all<CustomField>("custom_fields")).find(
          (f) => same(f.id, action.field_id) && f.entity === "deal" && f.is_active,
        );
        if (!field) throw new Error("Поле не найдено");
        const values = { ...(deal.custom_values ?? {}) };
        if (value.trim()) values[String(field.id)] = value.trim();
        else delete values[String(field.id)];
        await update({ custom_values: values });
        return { field_id: field.id, value: value.trim() };
      }
      case "deal_field": {
        const field = action.field ?? "";
        const text = value.trim() || null;
        const data: Partial<Deal> =
          field === "plan_amount"
            ? { plan_amount: Number((text ?? "0").replace(/\D/g, "")) || 0 }
            : field === "name"
              ? { name: text }
              : { [field]: text == null ? null : Number(text) };
        await update(data);
        return { field, value: text };
      }
      case "patient_field": {
        const patient = (await all<Patient>("patients")).find((p) =>
          same(p.id, deal.patient_id),
        );
        if (!patient) throw new Error("Пациент не найден");
        await getDataProvider().update("patients", {
          id: patient.id,
          data: { [action.field ?? "first_name"]: value.trim() || null },
          previousData: patient,
        });
        return { field: action.field, value: value.trim() };
      }
    }
  };

  const saveSession = async (
    session: SalesbotSession,
    engine: EngineSession,
  ) => {
    const now = nowIso();
    const { data } = await baseDataProvider.update<SalesbotSession>(
      "salesbot_sessions",
      {
        id: session.id,
        data: {
          current_step: engine.current_step,
          state: engine.state,
          status: engine.status,
          wait_until: engine.wait_until,
          last_reply: engine.last_reply,
          messages_sent: engine.messages_sent,
          stopped_reason: engine.stopped_reason ?? null,
          updated_at: now,
          finished_at: isActive(engine.status) ? null : now,
        },
        previousData: session,
      },
    );
    // A stopped session cancels its queue
    if (engine.status === "stopped") {
      const rows = (
        await all<{
          id: Identifier;
          status: string;
          salesbot_session_id?: Identifier | null;
        }>("automessages")
      ).filter(
        (row) =>
          same(row.salesbot_session_id, session.id) && row.status === "pending",
      );
      for (const row of rows) {
        await baseDataProvider.update("automessages", {
          id: row.id,
          data: {
            status: "cancelled",
            error: engine.stopped_reason ?? "Бот остановлен",
            processed_at: now,
          },
          previousData: row,
        });
      }
    }
    return data;
  };

  /** Runs an engine step function on a session, as the bot (no author) */
  const run = async (
    session: SalesbotSession,
    step: (hooks: EngineHooks) => Promise<EngineSession>,
  ) => {
    depth++;
    try {
      return await saveSession(session, await step(hooksFor(session)));
    } finally {
      depth--;
    }
  };

  const stop = async (session: SalesbotSession, reason: string) =>
    run(session, (hooks) => stopSession(session, reason, hooks));

  /** Same as private.salesbot_start */
  const start = async (
    botId: Identifier,
    dealId: Identifier,
    trigger: SessionTrigger,
    startedBy: Identifier | null = null,
  ) => {
    const deal = await getDeal(dealId);
    if (!deal) throw new Error("salesbot.errors.deal");
    if (deal.unsorted_at) {
      if (trigger === "manual") throw new Error("salesbot.errors.unsorted");
      return null;
    }
    if (deal.archived_at) throw new Error("salesbot.errors.archived");
    if (depth > 0) throw new Error("salesbot.errors.busy");
    const bot = (await all<Salesbot>("salesbots")).find((b) =>
      same(b.id, botId),
    );
    if (!bot) throw new Error("salesbot.errors.unknown");
    if (!bot.is_active) throw new Error("salesbot.errors.inactive");
    const previous = await activeSession(deal.id);
    if (previous) await stop(previous, `Запущен бот «${bot.name}»`);
    const now = nowIso();
    const initial = startSession(bot.scenario);
    const { data: session } = await baseDataProvider.create<SalesbotSession>(
      "salesbot_sessions",
      {
        data: {
          deal_id: deal.id,
          bot_id: bot.id,
          bot_name: bot.name,
          bot_version: bot.version,
          scenario: bot.scenario,
          current_step: initial.current_step,
          state: {},
          status: "running",
          wait_until: null,
          last_reply: null,
          messages_sent: 0,
          trigger,
          started_by: startedBy,
          stopped_reason: null,
          created_at: now,
          updated_at: now,
          finished_at: null,
        },
      },
    );
    await log(session, {
      kind: "started",
      text: bot.name,
      step_id: null,
      step_type: null,
      details: { trigger, bot_id: bot.id, version: bot.version },
    });
    return run(session, (hooks) => advance(initial, hooks));
  };

  const firstBotFor = async (
    deal: Deal,
    message: Pick<Message, "transport" | "text">,
    firstMessage: boolean,
  ) => {
    const bots = (await all<Salesbot>("salesbots"))
      .filter((bot) => bot.is_active)
      .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));
    if (firstMessage) {
      const bot = bots.find(
        (b) =>
          b.trigger_new_lead &&
          (!b.trigger_transports.length ||
            b.trigger_transports.includes(message.transport as never)) &&
          (!b.trigger_source_ids.length ||
            b.trigger_source_ids.some((id) => same(id, deal.source_id))),
      );
      if (bot) return { bot, trigger: "new_lead" as const };
    }
    const text = (message.text ?? "").toLowerCase().replace(/ё/g, "е");
    const bot = text
      ? bots.find((b) =>
          b.trigger_keywords.some(
            (word) => word.trim() && text.includes(word.trim()),
          ),
        )
      : undefined;
    return bot ? { bot, trigger: "keyword" as const } : null;
  };

  /** A message stored by the demo. Same as private.handle_message_salesbot */
  const onMessage = async (message: Message) => {
    if (message.direction === "out") {
      if (message.sales_id != null && message.automessage_id == null) {
        const session = await activeSession(message.deal_id);
        if (session) await stop(session, "Сотрудник ответил сам");
      }
      return;
    }
    const deal = await getDeal(message.deal_id);
    if (!deal || deal.unsorted_at || deal.archived_at) return;
    const session = await activeSession(deal.id);
    if (session) {
      await run(session, (hooks) =>
        receiveReply(session, message.text ?? "", hooks),
      );
      return;
    }
    const first = !(await all<Message>("messages")).some(
      (m) => same(m.deal_id, deal.id) && !same(m.id, message.id),
    );
    const found = await firstBotFor(deal, message, first);
    if (found) await start(found.bot.id, deal.id, found.trigger);
  };

  /** Same as private.salesbot_tick (run when the sessions are read) */
  let lastTick = 0;
  const tick = async (moment = new Date()) => {
    const due = (await all<SalesbotSession>("salesbot_sessions")).filter(
      (s) =>
        s.status === "waiting" &&
        s.wait_until != null &&
        new Date(s.wait_until) <= moment,
    );
    for (const session of due) {
      await run(session, (hooks) => resumeDue(session, hooks, moment));
    }
    return due.length;
  };
  const throttledTick = async () => {
    if (Date.now() - lastTick < 20_000) return;
    lastTick = Date.now();
    await tick();
  };

  /** Same as the checks of public.salesbots (handle_salesbot_saved) */
  const normalizeBot = async (
    data: Partial<Salesbot>,
    previous?: Salesbot,
  ): Promise<Partial<Salesbot>> => {
    await requireConfigurator();
    const merged = { ...previous, ...data } as Salesbot;
    if (!merged.name?.trim()) throw new Error("salesbot.errors.name");
    const errors = validateScenario(merged.scenario);
    if (isBroken(errors)) throw new Error("salesbot.errors.broken");
    if (merged.is_active && errors.length) {
      throw new Error("salesbot.errors.invalid");
    }
    const scenarioChanged =
      previous &&
      JSON.stringify(previous.scenario) !== JSON.stringify(merged.scenario);
    return {
      ...data,
      name: merged.name.trim(),
      ...(data.trigger_keywords
        ? {
            trigger_keywords: [
              ...new Set(
                data.trigger_keywords
                  .map((k) => k.trim().toLowerCase().replace(/ё/g, "е"))
                  .filter(Boolean),
              ),
            ].sort(),
          }
        : {}),
      version: previous
        ? previous.version + (scenarioChanged ? 1 : 0)
        : 1,
      updated_at: nowIso(),
    };
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "salesbots",
      beforeCreate: async (params) => ({
        ...params,
        data: {
          description: null,
          is_active: false,
          scenario: { start: null, steps: [] },
          trigger_new_lead: false,
          trigger_transports: [],
          trigger_source_ids: [],
          trigger_keywords: [],
          position: 0,
          created_by: (await currentSalesId()) ?? null,
          created_at: nowIso(),
          ...params.data,
          ...(await normalizeBot({
            description: null,
            is_active: false,
            scenario: { start: null, steps: [] },
            trigger_keywords: [],
            ...params.data,
          })),
        },
      }),
      beforeUpdate: async (params) => {
        const previous = (await all<Salesbot>("salesbots")).find((b) =>
          same(b.id, params.id),
        );
        return {
          ...params,
          data: await normalizeBot(params.data, previous),
        };
      },
      beforeDelete: async (params) => {
        await requireConfigurator();
        return params;
      },
    },
    {
      resource: "salesbot_sessions",
      beforeGetList: async (params) => {
        await throttledTick();
        return params;
      },
    },
    {
      resource: "salesbot_logs",
      beforeGetList: async (params) => {
        await throttledTick();
        return params;
      },
    },
    {
      // Same as private.handle_deal_salesbot: archiving stops the bot
      resource: "deals",
      afterUpdate: async (result) => {
        const deal = result.data as Deal;
        if (deal.archived_at) {
          const session = await activeSession(deal.id);
          if (session) await stop(session, "Сделка в архиве");
        }
        return result;
      },
    },
  ];

  const methods = {
    async startSalesbot(
      dealId: Identifier,
      botId: Identifier,
    ): Promise<Identifier | null> {
      const session = await start(
        botId,
        dealId,
        "manual",
        (await currentSalesId()) ?? null,
      );
      return session?.id ?? null;
    },
    async stopSalesbot(dealId: Identifier): Promise<boolean> {
      const session = await activeSession(dealId);
      if (!session) return false;
      await stop(session, "Остановлен сотрудником");
      return true;
    },
  };

  return {
    callbacks,
    methods,
    onMessage,
    start,
    tick,
    isAutomating: () => depth > 0,
  };
};
