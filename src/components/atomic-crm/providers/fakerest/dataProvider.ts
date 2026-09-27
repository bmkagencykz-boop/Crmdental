import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import type {
  Deal,
  DealEvent,
  DealNote,
  DealPayment,
  OrganizationSettings,
  Patient,
  PatientNote,
  Pipeline,
  Sale,
  SalesFormData,
  SignUpData,
  Stage,
  Task,
  Message,
  MessengerStatus,
  DealChecklistCheck,
  StageChecklistItem,
  TaskRule,
  Automessage,
  AutomessageRule,
  MessageTemplate,
  Service,
} from "../../types";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { getActivityLog } from "../commons/activity";
import {
  automessageValues,
  isAutomessageOpen,
  renderTemplate,
  scheduleAutomessages,
} from "../commons/automessages";
import { DEMO_CLINIC_NAME } from "./dataGenerator/automessages";
import {
  applyPipelineMove,
  checkDealStageChange,
  checkStageChecklist,
  ruleTasks,
  dealChanges,
  normalizePatient,
  normalizePhone,
  pipelineHasClosingStages,
} from "../commons/domain";
import type { CrmDataProvider } from "../types";
import {
  computeReport,
  type ReportFilters,
  type ReportName,
  type ReportResult,
} from "../../reports/reportMath";
import {
  authProvider as defaultAuthProvider,
  USER_STORAGE_KEY,
} from "./authProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";
import { withSupabaseFilterAdapter } from "./internal/supabaseAdapter";
import { createMailingDemo } from "./mailings";

export interface CreateFakeRestDataProviderOptions {
  db?: Db;
  latency?: number;
  authProvider?: Pick<typeof defaultAuthProvider, "getIdentity">;
  silent?: boolean;
}

const PATIENT_VIEW_COLUMNS = [
  "phone_fts",
  "nb_deals",
  "nb_open_deals",
  "nb_tasks",
];
const DEAL_VIEW_COLUMNS = [
  "stage_kind",
  "patient_first_name",
  "patient_last_name",
  "patient_phone",
  "search_text",
  "nb_open_tasks",
  "next_task_due_at",
  "nb_unread_messages",
  "last_message_at",
  "last_message_text",
];

const withoutKeys = <T extends Record<string, any>>(data: T, keys: string[]) =>
  Object.fromEntries(
    Object.entries(data).filter(([key]) => !keys.includes(key)),
  ) as T;

const everything: GetListParams = {
  pagination: { page: 1, perPage: 1_000_000 },
  sort: { field: "id", order: "ASC" },
  filter: {},
};

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    return (await convertFileToBase64(logo)) as string;
  }
  return logo?.src ?? "";
};

const preserveAttachmentMimeType = <
  NoteType extends { attachments?: Array<{ rawFile?: File; type?: string }> },
>(
  note: NoteType,
): NoteType => ({
  ...note,
  attachments: (note.attachments ?? []).map((attachment) => ({
    ...attachment,
    type: attachment.type ?? attachment.rawFile?.type,
  })),
});

/**
 * In-browser data provider of the demo. It mirrors the database: summary
 * views are computed on read, triggers run as lifecycle callbacks with the
 * same rules (see ../commons/domain.ts).
 */
export const createDataProvider = ({
  db = generateData(),
  latency = 300,
  authProvider,
  silent = false,
}: CreateFakeRestDataProviderOptions = {}): CrmDataProvider => {
  const baseDataProvider = fakeRestDataProvider(db, !silent, latency);
  let messengerConnected = true;
  const getIdentity = async () =>
    authProvider?.getIdentity?.() ?? defaultAuthProvider.getIdentity?.();
  const all = async <T>(resource: string) =>
    (await baseDataProvider.getList(resource, everything)).data as T[];
  // Repeat sales and mailings (stage 17)
  const mailingDemo = createMailingDemo({
    baseDataProvider,
    all,
    currentSalesId: () => currentSalesId(),
    getDataProvider: () => dataProvider,
  });

  // Same as private.create_rule_tasks
  const createRuleTasks = async (
    deal: Deal,
    event: TaskRule["event"],
    stageId: Identifier | null = null,
  ) => {
    const tasks = ruleTasks({
      deal,
      rules: await all<TaskRule>("task_rules"),
      event,
      stageId,
    });
    for (const task of tasks) {
      await baseDataProvider.create("tasks", { data: task });
    }
  };

  // --- automatic messages (same as supabase/schemas/08_automessages.sql) --

  // Same as private.schedule_automessages
  const scheduleDealAutomessages = async (
    deal: Deal,
    onlyTiming?: AutomessageRule["timing"],
  ) => {
    const jobs = scheduleAutomessages({
      deal,
      rules: await all<AutomessageRule>("automessage_rules"),
      onlyTiming,
    });
    for (const job of jobs) {
      await baseDataProvider.create("automessages", { data: job });
    }
  };

  // Same as private.cancel_automessages (and the task of a waiting message)
  const cancelDealAutomessages = async (
    dealId: Identifier,
    statuses: Automessage["status"][],
    reason: string,
    onlyTiming?: AutomessageRule["timing"],
  ) => {
    const rows = (await all<Automessage>("automessages")).filter(
      (row) =>
        row.deal_id === dealId &&
        statuses.includes(row.status) &&
        (!onlyTiming || row.timing === onlyTiming),
    );
    for (const row of rows) {
      await baseDataProvider.update("automessages", {
        id: row.id,
        data: {
          status: "cancelled",
          error: reason,
          processed_at: new Date().toISOString(),
        },
        previousData: row,
      });
      if (row.status === "awaiting") await dropAutomessageTasks(row.id);
    }
  };

  const dropAutomessageTasks = async (automessageId: Identifier) => {
    const tasks = (await all<Task>("tasks")).filter(
      (task) => task.automessage_id === automessageId && !task.done_date,
    );
    for (const task of tasks) {
      await baseDataProvider.delete("tasks", {
        id: task.id,
        previousData: task,
      });
    }
  };

  const renderAutomessage = async (deal: Deal, template: MessageTemplate) => {
    const [patient, services, configuration] = await Promise.all([
      baseDataProvider
        .getOne<Patient>("patients", { id: deal.patient_id })
        .then((r) => r.data)
        .catch(() => undefined),
      all<Service>("services"),
      baseDataProvider
        .getOne("configuration", { id: 1 })
        .then((r) => r.data)
        .catch(() => undefined),
    ]);
    return renderTemplate(
      template.body,
      automessageValues({
        deal,
        patientFirstName: patient?.first_name,
        serviceName: services.find((s) => s.id === deal.service_id)?.name,
        clinicName: configuration?.config?.title || DEMO_CLINIC_NAME,
      }),
    );
  };

  /**
   * The dispatcher of the demo (public.claim_automessages + the edge
   * function): due messages are "sent" (stored) or become a task, when a list
   * showing them is read.
   */
  let dispatching: Promise<void> | null = null;
  const dispatchDueAutomessages = () => {
    dispatching ??= (async () => {
      const now = new Date().toISOString();
      const due = (await all<Automessage>("automessages")).filter(
        (row) => row.status === "pending" && row.send_at <= now,
      );
      if (!due.length) return;
      const [deals, rules, templates] = await Promise.all([
        all<Deal>("deals"),
        all<AutomessageRule>("automessage_rules"),
        all<MessageTemplate>("message_templates"),
      ]);
      for (const row of due) {
        const deal = deals.find((d) => d.id === row.deal_id);
        const rule = rules.find((r) => r.id === row.rule_id);
        const template = templates.find((t) => t.id === rule?.template_id);
        const close = (data: Partial<Automessage>) =>
          baseDataProvider.update("automessages", {
            id: row.id,
            data: { processed_at: new Date().toISOString(), ...data },
            previousData: row,
          });
        if (!deal || deal.stage_id !== row.stage_id || deal.archived_at) {
          await close({ status: "cancelled", error: "Сделка ушла с этапа" });
          continue;
        }
        if (!rule?.is_active || !template) {
          await close({
            status: "cancelled",
            error: "Правило выключено или удалено",
          });
          continue;
        }
        const text = await renderAutomessage(deal, template);
        if (rule.mode === "confirm") {
          await baseDataProvider.create("tasks", {
            data: {
              deal_id: deal.id,
              type: "message",
              text,
              due_date: new Date().toISOString(),
              done_date: null,
              sales_id: deal.sales_id ?? undefined,
              automessage_id: row.id,
            },
          });
          await close({ status: "awaiting", text });
        } else if (!messengerConnected) {
          await close({
            status: "failed",
            text,
            error: "Мессенджеры не подключены (Настройки → Мессенджеры)",
          });
        } else {
          await storeOutgoing(deal, text, null, row.id);
        }
      }
    })().finally(() => {
      dispatching = null;
    });
    return dispatching;
  };

  /** An outgoing message of a deal (no Wazzup24 in the demo) */
  const storeOutgoing = async (
    deal: Deal,
    text: string,
    salesId: Identifier | null | undefined,
    automessageId: Identifier | null,
  ) => {
    const previous = (await all<Message>("messages"))
      .filter((message) => message.deal_id === deal.id)
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
    const { data: patient } = await baseDataProvider.getOne<Patient>(
      "patients",
      { id: deal.patient_id },
    );
    const { data } = await baseDataProvider.create<Message>("messages", {
      data: {
        patient_id: deal.patient_id,
        deal_id: deal.id,
        channel_id: previous?.channel_id ?? 1,
        transport: previous?.transport ?? "whatsapp",
        chat_id:
          previous?.chat_id ?? (patient.phones?.[0] ?? "").replace(/\D/g, ""),
        direction: "out",
        sales_id: salesId ?? null,
        text,
        content_type: "text",
        status: "sent",
        sent_at: new Date().toISOString(),
        automessage_id: automessageId,
      },
    });
    // Same as private.handle_automessage_sent
    if (automessageId != null) {
      const row = (await all<Automessage>("automessages")).find(
        (a) => a.id === automessageId,
      );
      if (row) {
        await baseDataProvider.update("automessages", {
          id: row.id,
          data: {
            status: "sent",
            error: null,
            text,
            processed_at: new Date().toISOString(),
          },
          previousData: row,
        });
      }
      const tasks = (await all<Task>("tasks")).filter(
        (task) => task.automessage_id === automessageId && !task.done_date,
      );
      for (const task of tasks) {
        await baseDataProvider.update("tasks", {
          id: task.id,
          data: { done_date: new Date().toISOString() },
          previousData: task,
        });
      }
    }
    return data;
  };

  // --- views ------------------------------------------------------------

  const patientsSummary = async () => {
    const [patients, deals, stages, tasks] = await Promise.all([
      all<Patient>("patients"),
      all<Deal>("deals"),
      all<Stage>("stages"),
      all<Task>("tasks"),
    ]);
    const kind = new Map(stages.map((stage) => [stage.id, stage.kind]));
    return patients.map((patient) => {
      const own = deals.filter((deal) => deal.patient_id === patient.id);
      const ids = new Set(own.map((deal) => deal.id));
      return {
        ...patient,
        phone_fts: (patient.phones ?? []).join(" "),
        nb_deals: own.length,
        nb_open_deals: own.filter((deal) => kind.get(deal.stage_id) === "open")
          .length,
        nb_tasks: tasks.filter(
          (task) => ids.has(task.deal_id) && !task.done_date,
        ).length,
      };
    });
  };

  const dealsSummary = async () => {
    const [deals, stages, patients, tasks, messages] = await Promise.all([
      all<Deal>("deals"),
      all<Stage>("stages"),
      all<Patient>("patients"),
      all<Task>("tasks"),
      all<Message>("messages"),
    ]);
    const kind = new Map(stages.map((stage) => [stage.id, stage.kind]));
    const patientsById = new Map(patients.map((p) => [p.id, p]));
    return deals.map((deal) => {
      const patient = patientsById.get(deal.patient_id);
      const open = tasks.filter(
        (task) => task.deal_id === deal.id && !task.done_date,
      );
      return {
        ...deal,
        stage_kind: kind.get(deal.stage_id),
        patient_first_name: patient?.first_name ?? null,
        patient_last_name: patient?.last_name ?? null,
        patient_phone: patient?.phones?.[0] ?? null,
        search_text: [
          deal.name,
          patient?.last_name,
          patient?.first_name,
          patient?.middle_name,
          ...(patient?.phones ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        nb_open_tasks: open.length,
        next_task_due_at: open.map((task) => task.due_date).sort()[0] ?? null,
        ...messageSummary(
          messages.filter((message) => message.deal_id === deal.id),
        ),
      };
    });
  };

  const views: Record<string, () => Promise<any[]>> = {
    patients: patientsSummary,
    deals: dealsSummary,
    ...mailingDemo.views,
  };
  const viewProvider = async (resource: string) =>
    fakeRestDataProvider({ [resource]: await views[resource]() }, false, 0);

  // --- custom methods ---------------------------------------------------

  const custom = {
    ...baseDataProvider,
    ...mailingDemo.methods,
    async getList(resource: string, params: GetListParams) {
      if (["automessages", "tasks", "messages"].includes(resource)) {
        await dispatchDueAutomessages();
      }
      if (resource === "activity_log") {
        const activities = await getActivityLog(
          withSupabaseFilterAdapter(baseDataProvider),
        );
        const { page, perPage } = params.pagination ?? { page: 1, perPage: 20 };
        const start = (page - 1) * perPage;
        return {
          data: activities.slice(start, start + perPage),
          total: activities.length,
        };
      }
      if (views[resource]) {
        return (await viewProvider(resource)).getList(resource, params);
      }
      return baseDataProvider.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (views[resource]) {
        return (await viewProvider(resource)).getOne(resource, params);
      }
      return baseDataProvider.getOne(resource, params);
    },
    async getMany(resource: string, params: any) {
      if (views[resource]) {
        return (await viewProvider(resource)).getMany(resource, params);
      }
      return baseDataProvider.getMany(resource, params);
    },
    async getManyReference(resource: string, params: any) {
      if (views[resource]) {
        return (await viewProvider(resource)).getManyReference(
          resource,
          params,
        );
      }
      return baseDataProvider.getManyReference(resource, params);
    },
    unarchiveDeal: async (deal: Deal) => {
      const deals = (await all<Deal>("deals")).filter(
        (d) => d.stage_id === deal.stage_id && !d.archived_at,
      );
      await Promise.all(
        deals.map((d) =>
          baseDataProvider.update("deals", {
            id: d.id,
            data: { index: d.index + 1 },
            previousData: d,
          }),
        ),
      );
      return dataProvider.update("deals", {
        id: deal.id,
        data: { index: 0, archived_at: null },
        previousData: deal,
      });
    },
    findPatientsByPhone: async (phone: string): Promise<Patient[]> => {
      const number = normalizePhone(phone);
      if (!number) return [];
      return (await all<Patient>("patients")).filter((patient) =>
        patient.phones?.includes(number),
      );
    },
    createPipeline: async (name: string): Promise<Identifier> => {
      const pipelines = await all<Pipeline>("pipelines");
      const { data: pipeline } = await baseDataProvider.create("pipelines", {
        data: {
          name,
          position: Math.max(-1, ...pipelines.map((p) => p.position)) + 1,
          is_default: false,
        },
      });
      for (const [position, [stageName, kind, color]] of [
        ["Новый лид", "open", "#83A2DB"],
        ["Успешно", "won", "#8CC9A7"],
        ["Отказ", "lost", "#FD8E8C"],
      ].entries()) {
        await baseDataProvider.create("stages", {
          data: {
            pipeline_id: pipeline.id,
            name: stageName,
            position,
            kind,
            color,
          },
        });
      }
      return pipeline.id;
    },
    // Demo: messages are "sent" without Wazzup24
    sendMessage: async (
      dealId: Identifier,
      text: string,
      automessageId?: Identifier | null,
    ): Promise<Message> => {
      const { data: deal } = await baseDataProvider.getOne<Deal>("deals", {
        id: dealId,
      });
      if (automessageId != null) {
        const row = (await all<Automessage>("automessages")).find(
          (a) => a.id === automessageId && a.deal_id === deal.id,
        );
        if (!row || !["pending", "awaiting", "failed"].includes(row.status)) {
          throw new Error("automessages.errors.closed");
        }
      }
      const data = await storeOutgoing(
        deal,
        text,
        await currentSalesId(),
        automessageId ?? null,
      );
      const [settings] = await all<OrganizationSettings>(
        "organization_settings",
      );
      const takesLead =
        deal.sales_id == null &&
        settings?.lead_distribution === "first_response" &&
        (!settings.lead_distribution_sales_ids.length ||
          settings.lead_distribution_sales_ids.some(
            (id) => String(id) === String(data.sales_id),
          ));
      if (!deal.first_response_at || takesLead) {
        await dataProvider.update("deals", {
          id: deal.id,
          data: {
            ...(deal.first_response_at
              ? {}
              : { first_response_at: data.sent_at }),
            ...(takesLead ? { sales_id: data.sales_id } : {}),
          },
          previousData: deal,
        });
      }
      return data;
    },
    markDealMessagesRead: async (dealId: Identifier): Promise<number> => {
      const unread = (await all<Message>("messages")).filter(
        (message) =>
          message.deal_id === dealId &&
          message.direction === "in" &&
          !message.read_at,
      );
      await Promise.all(
        unread.map((message) =>
          baseDataProvider.update("messages", {
            id: message.id,
            data: { read_at: new Date().toISOString() },
            previousData: message,
          }),
        ),
      );
      return unread.length;
    },
    getMessengerStatus: async (): Promise<MessengerStatus | null> =>
      messengerConnected
        ? {
            connected: true,
            connected_at: new Date().toISOString(),
            last_error: null,
          }
        : null,
    connectMessenger: async (_apiKey: string): Promise<void> => {
      messengerConnected = true;
    },
    disconnectMessenger: async (): Promise<void> => {
      messengerConnected = false;
    },
    getOrganizationSettings: async (): Promise<OrganizationSettings> => {
      const [settings] = await all<OrganizationSettings & { id: number }>(
        "organization_settings",
      );
      return settings;
    },
    updateOrganizationSettings: async (
      data: Partial<Omit<OrganizationSettings, "organization_id">>,
    ): Promise<OrganizationSettings> => {
      const [settings] = await all<OrganizationSettings & { id: number }>(
        "organization_settings",
      );
      const { data: updated } = await baseDataProvider.update(
        "organization_settings",
        { id: settings.id, data, previousData: settings },
      );
      return updated as OrganizationSettings;
    },
    signUp: async ({
      email,
      password,
      first_name,
      last_name,
    }: SignUpData): Promise<{
      id: string;
      email: string;
      password: string;
    }> => {
      const user = await baseDataProvider.create("sales", {
        data: { email, first_name, last_name, role: "owner" },
      });
      return { ...user.data, password };
    },
    salesCreate: async ({ ...data }: SalesFormData): Promise<Sale> => {
      const response = await dataProvider.create("sales", {
        data: { ...data, password: "new_password" },
      });
      return response.data;
    },
    salesUpdate: async (
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ): Promise<Sale> => {
      const { data: previousData } = await dataProvider.getOne<Sale>("sales", {
        id,
      });
      if (!previousData) throw new Error("User not found");
      const { data: sale } = await dataProvider.update<Sale>("sales", {
        id,
        data,
        previousData,
      });
      return { ...sale, user_id: sale.id.toString() };
    },
    isInitialized: async (): Promise<boolean> =>
      (await all<Sale>("sales")).length > 0,
    updatePassword: async (): Promise<true> => true,
    // Same computations as the public.report_* functions of the database
    getReport: async <Name extends ReportName>(
      name: Name,
      filters: ReportFilters,
    ): Promise<ReportResult[Name]> => {
      const salesId = await currentSalesId();
      const me = (await all<Sale>("sales")).find(
        (sale) => String(sale.id) === String(salesId),
      );
      if (me?.role !== "owner" && me?.role !== "head") {
        throw new Error("reports.forbidden");
      }
      const resources = [
        "deals",
        "stages",
        "pipelines",
        "deal_events",
        "deal_payments",
        "tasks",
        "messages",
        "sales",
        "lead_sources",
        "services",
        "lost_reasons",
      ] as const;
      const rows = await Promise.all(resources.map((r) => all<any>(r)));
      return computeReport(
        name,
        Object.fromEntries(
          resources.map((resource, index) => [resource, rows[index]]),
        ) as any,
        filters,
      );
    },
    getConfiguration: async (): Promise<ConfigurationContextValue> => {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    updateConfiguration: async (
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> => {
      const { data: prev } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      await baseDataProvider.update("configuration", {
        id: 1,
        data: { config },
        previousData: prev,
      });
      return config;
    },
  };

  // --- triggers -----------------------------------------------------------

  const currentSalesId = async () => (await getIdentity())?.id;

  const logDealEvent = async (event: Omit<DealEvent, "id" | "created_at">) =>
    baseDataProvider.create("deal_events", {
      data: {
        ...event,
        sales_id: event.sales_id ?? (await currentSalesId()) ?? null,
        created_at: new Date().toISOString(),
      },
    });

  // Same as handle_deal_payment_changed: deals.paid_amount = sum of payments
  const syncPaidAmount = async (dealId: Identifier) => {
    const payments = (await all<DealPayment>("deal_payments")).filter(
      (payment) => payment.deal_id === dealId,
    );
    const { data: deal } = await baseDataProvider.getOne<Deal>("deals", {
      id: dealId,
    });
    const paid_amount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (paid_amount === deal.paid_amount) return;
    await baseDataProvider.update("deals", {
      id: dealId,
      data: { paid_amount, updated_at: new Date().toISOString() },
      previousData: deal,
    });
    await logDealEvent({
      deal_id: dealId,
      type: "updated",
      changes: { paid_amount: [deal.paid_amount, paid_amount] },
    });
  };

  // Previous state of the deals being updated, for the log
  const previousDeals = new Map<Identifier, Deal>();

  const dataProvider = withLifecycleCallbacks(
    withSupabaseFilterAdapter(custom as DataProvider),
    [
      ...mailingDemo.callbacks,
      {
        resource: "configuration",
        beforeUpdate: async (params) => {
          const config = params.data.config;
          if (config) {
            config.lightModeLogo = await processConfigLogo(
              config.lightModeLogo,
            );
            config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
          }
          return params;
        },
      },
      {
        resource: "sales",
        beforeCreate: async (params) => {
          const { data } = params;
          // New employees are managers unless stated otherwise
          if (data.role == null) data.role = "manager";
          data.administrator = data.role === "owner" || data.role === "head";
          return params;
        },
        afterSave: async (data) => {
          // The fakerest auth provider keeps the current user in localStorage
          const currentUser = await getIdentity();
          if (currentUser?.id === data.id) {
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
          }
          return data;
        },
      } satisfies ResourceCallbacks<Sale>,
      {
        resource: "patients",
        beforeCreate: async (params) => ({
          ...params,
          data: normalizePatient({
            ...withoutKeys(params.data, PATIENT_VIEW_COLUMNS),
            tags: params.data.tags ?? [],
            sales_id: params.data.sales_id ?? (await currentSalesId()),
            first_seen: params.data.first_seen ?? new Date().toISOString(),
            last_seen: params.data.last_seen ?? new Date().toISOString(),
          }),
        }),
        beforeUpdate: async (params) => ({
          ...params,
          data: normalizePatient(
            withoutKeys(params.data, PATIENT_VIEW_COLUMNS),
          ),
        }),
      } satisfies ResourceCallbacks<Patient>,
      {
        resource: "deals",
        beforeCreate: async (params) => {
          const [pipelines, stages] = await Promise.all([
            all<Pipeline>("pipelines"),
            all<Stage>("stages"),
          ]);
          const data = withoutKeys(params.data, DEAL_VIEW_COLUMNS);
          const pipeline_id =
            data.pipeline_id ??
            (pipelines.find((p) => p.is_default) ?? pipelines[0])?.id;
          const stage_id =
            data.stage_id ??
            stages
              .filter((s) => s.pipeline_id === pipeline_id)
              .sort((a, b) => a.position - b.position)[0]?.id;
          const { kind } = checkDealStageChange({
            next: {
              pipeline_id,
              stage_id,
              lost_reason_id: data.lost_reason_id,
            },
            stages,
          });
          const now = new Date().toISOString();
          return {
            ...params,
            data: {
              ...data,
              pipeline_id,
              stage_id,
              plan_amount: Number(data.plan_amount ?? 0),
              paid_amount: 0,
              tags: data.tags ?? [],
              index: data.index ?? 0,
              sales_id:
                data.sales_id === undefined
                  ? await currentSalesId()
                  : data.sales_id,
              created_at: now,
              updated_at: now,
              stage_changed_at: now,
              closed_at: kind === "open" ? null : now,
            },
          };
        },
        afterCreate: async (result) => {
          const deal = result.data as Deal;
          await logDealEvent({
            deal_id: deal.id,
            type: "created",
            to_stage_id: deal.stage_id,
            changes: {},
          });
          // Same as the database: the first deal gives the patient its source
          if (deal.source_id != null) {
            const { data: patient } = await baseDataProvider.getOne<Patient>(
              "patients",
              { id: deal.patient_id },
            );
            if (patient && patient.source_id == null) {
              await baseDataProvider.update("patients", {
                id: patient.id,
                data: { source_id: deal.source_id },
                previousData: patient,
              });
            }
          }
          await createRuleTasks(deal, "deal_created");
          await createRuleTasks(deal, "stage_entered", deal.stage_id);
          await scheduleDealAutomessages(deal);
          return result;
        },
        beforeUpdate: async (params) => {
          const { data: previous } = await baseDataProvider.getOne<Deal>(
            "deals",
            { id: params.id },
          );
          const data = withoutKeys(params.data, [
            ...DEAL_VIEW_COLUMNS,
            "paid_amount",
            "created_at",
          ]);
          const stages = await all<Stage>("stages");
          const [settings] = await all<OrganizationSettings>(
            "organization_settings",
          );
          const next = applyPipelineMove({
            previous,
            next: { ...previous, ...data } as Deal,
            stages,
            mode: settings?.pipeline_move_mode,
          });
          if (next.stage_id !== previous.stage_id) {
            data.stage_id = next.stage_id;
          }
          const { changed, kind } = checkDealStageChange({
            previous,
            next,
            stages,
          });
          checkStageChecklist({
            previous,
            next,
            stages,
            items: await all<StageChecklistItem>("stage_checklist_items"),
            checks: await all<DealChecklistCheck>("deal_checklist_checks"),
          });
          previousDeals.set(params.id, previous);
          const now = new Date().toISOString();
          const onlyIndex = Object.keys(data).every((key) =>
            ["index", "id"].includes(key),
          );
          return {
            ...params,
            data: {
              ...data,
              ...(onlyIndex ? {} : { updated_at: now }),
              ...(changed
                ? {
                    stage_changed_at: now,
                    closed_at: kind === "open" ? null : now,
                  }
                : {}),
            },
          };
        },
        afterUpdate: async (result) => {
          const deal = result.data as Deal;
          const previous = previousDeals.get(deal.id);
          previousDeals.delete(deal.id);
          if (!previous) return result;
          const changes = dealChanges(previous, deal);
          // A responsible assigned later takes the unassigned open tasks
          if (previous.sales_id == null && deal.sales_id != null) {
            const tasks = (await all<Task>("tasks")).filter(
              (task) =>
                task.deal_id === deal.id &&
                task.sales_id == null &&
                !task.done_date,
            );
            for (const task of tasks) {
              await baseDataProvider.update("tasks", {
                id: task.id,
                data: { sales_id: deal.sales_id },
                previousData: task,
              });
            }
          }
          if (previous.stage_id !== deal.stage_id) {
            await logDealEvent({
              deal_id: deal.id,
              type: "stage_changed",
              from_stage_id: previous.stage_id,
              to_stage_id: deal.stage_id,
              changes,
            });
            await createRuleTasks(deal, "stage_entered", deal.stage_id);
          } else if (Object.keys(changes).length) {
            await logDealEvent({ deal_id: deal.id, type: "updated", changes });
          }
          // Same as private.handle_deal_automessages
          if (previous.stage_id !== deal.stage_id) {
            await cancelDealAutomessages(
              deal.id,
              ["pending", "awaiting"],
              "Сделка ушла с этапа",
            );
            await scheduleDealAutomessages(deal);
          } else if (deal.archived_at && !previous.archived_at) {
            await cancelDealAutomessages(
              deal.id,
              ["pending", "awaiting"],
              "Сделка в архиве",
            );
          } else if (
            (deal.appointment_at ?? null) !== (previous.appointment_at ?? null)
          ) {
            await cancelDealAutomessages(
              deal.id,
              ["pending"],
              "Дата визита изменилась",
              "before_visit",
            );
            await scheduleDealAutomessages(deal, "before_visit");
          }
          return result;
        },
      } satisfies ResourceCallbacks<Deal>,
      {
        resource: "deal_payments",
        beforeCreate: async (params) => {
          if (!(Number(params.data.amount) > 0)) {
            throw new Error("Сумма оплаты должна быть больше нуля");
          }
          return {
            ...params,
            data: {
              ...params.data,
              amount: Number(params.data.amount),
              paid_at:
                params.data.paid_at ?? new Date().toISOString().slice(0, 10),
              sales_id: await currentSalesId(),
              created_at: new Date().toISOString(),
            },
          };
        },
        afterCreate: async (result) => {
          await syncPaidAmount(result.data.deal_id);
          return result;
        },
        afterUpdate: async (result) => {
          await syncPaidAmount(result.data.deal_id);
          return result;
        },
        afterDelete: async (result) => {
          await syncPaidAmount(result.data.deal_id);
          return result;
        },
      } satisfies ResourceCallbacks<DealPayment>,
      {
        resource: "stages",
        beforeUpdate: async (params) => {
          if (params.data.kind != null) {
            const { data: stage } = await baseDataProvider.getOne<Stage>(
              "stages",
              { id: params.id },
            );
            const siblings = (await all<Stage>("stages"))
              .filter((s) => s.pipeline_id === stage.pipeline_id)
              .map((s) => (s.id === stage.id ? { ...s, ...params.data } : s));
            if (!pipelineHasClosingStages(siblings)) {
              throw new Error(
                "В воронке должна быть хотя бы одна стадия «Успешно» и одна «Отказ»",
              );
            }
          }
          return params;
        },
        beforeDelete: async (params) => {
          const deals = await all<Deal>("deals");
          if (deals.some((deal) => deal.stage_id === params.id)) {
            throw new Error("crm.settings.errors.in_use");
          }
          const { data: stage } = await baseDataProvider.getOne<Stage>(
            "stages",
            { id: params.id },
          );
          const remaining = (await all<Stage>("stages")).filter(
            (s) => s.pipeline_id === stage.pipeline_id && s.id !== stage.id,
          );
          if (!pipelineHasClosingStages(remaining)) {
            throw new Error(
              "В воронке должна быть хотя бы одна стадия «Успешно» и одна «Отказ»",
            );
          }
          return params;
        },
      } satisfies ResourceCallbacks<Stage>,
      {
        resource: "pipelines",
        beforeDelete: async (params) => {
          const deals = await all<Deal>("deals");
          if (deals.some((deal) => deal.pipeline_id === params.id)) {
            throw new Error("crm.settings.errors.in_use");
          }
          return params;
        },
        afterDelete: async (result) => {
          const stages = (await all<Stage>("stages")).filter(
            (stage) => stage.pipeline_id === result.data.id,
          );
          await Promise.all(
            stages.map((stage) =>
              baseDataProvider.delete("stages", {
                id: stage.id,
                previousData: stage,
              }),
            ),
          );
          return result;
        },
      } satisfies ResourceCallbacks<Pipeline>,
      {
        resource: "lead_sources",
        beforeDelete: async (params) => {
          if (params.previousData?.is_system) {
            throw new Error("Системный источник нельзя удалить");
          }
          return params;
        },
      },
      {
        resource: "tasks",
        beforeCreate: async (params) => ({
          ...params,
          data: {
            ...params.data,
            done_date: params.data.done_date ?? null,
            created_at: params.data.created_at ?? new Date().toISOString(),
            sales_id: params.data.sales_id ?? (await currentSalesId()),
          },
        }),
      } satisfies ResourceCallbacks<Task>,
      {
        // Same as private.handle_automessage_update: employees only cancel
        resource: "automessages",
        beforeUpdate: async (params) => {
          const { data: previous } = await baseDataProvider.getOne<Automessage>(
            "automessages",
            { id: params.id },
          );
          if (
            params.data.status !== "cancelled" ||
            !isAutomessageOpen(previous)
          ) {
            throw new Error(
              "Можно только отменить сообщение, которое ещё не отправлено",
            );
          }
          return {
            ...params,
            data: {
              status: "cancelled",
              error: "Отменено сотрудником",
              processed_at: new Date().toISOString(),
            },
          };
        },
        afterUpdate: async (result) => {
          await dropAutomessageTasks(result.data.id);
          return result;
        },
      } satisfies ResourceCallbacks<Automessage>,
      {
        resource: "calls",
        beforeCreate: async (params) => ({
          ...params,
          data: {
            ...params.data,
            sales_id: params.data.sales_id ?? (await currentSalesId()),
          },
        }),
      },
      {
        resource: "patient_notes",
        beforeSave: async (params) => preserveAttachmentMimeType(params),
      } satisfies ResourceCallbacks<PatientNote>,
      {
        resource: "deal_notes",
        beforeSave: async (params) => preserveAttachmentMimeType(params),
      } satisfies ResourceCallbacks<DealNote>,
    ],
  ) as CrmDataProvider;

  return dataProvider;
};

export const dataProvider = createDataProvider();

/**
 * Convert a `File` object returned by the upload input into a base 64 string.
 * That's not the most optimized way to store images in production, but it's
 * enough to illustrate the idea of dataprovider decoration.
 */
const convertFileToBase64 = (file: { rawFile: Blob }): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    // We know result is a string as we used readAsDataURL
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file.rawFile);
  });

/** Same as the message columns of deals_summary */
const messageSummary = (messages: Message[]) => {
  const last = [...messages].sort(
    (a, b) => b.sent_at.localeCompare(a.sent_at) || Number(b.id) - Number(a.id),
  )[0];
  return {
    nb_unread_messages: messages.filter(
      (message) => message.direction === "in" && !message.read_at,
    ).length,
    last_message_at: last?.sent_at ?? null,
    last_message_text: last?.text ?? null,
  };
};
