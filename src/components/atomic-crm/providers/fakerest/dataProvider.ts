import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import type {
  AuditLogEntry,
  Deal,
  DealEvent,
  DealNote,
  DealPayment,
  Doctor,
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
  Call,
  LeadSource,
  TelephonyProvider,
  TelephonyStatus,
  DealChecklistCheck,
  StageChecklistItem,
  TaskRule,
  Automessage,
  AutomessageRule,
  MessageTemplate,
  Service,
  QuickReply,
  LeadWebhook,
  TelegramBotStatus,
  CrmNotification,
  NotificationPreferences,
  DealFile,
  CustomField,
  CustomFieldEntity,
  CustomValues,
} from "../../types";
import { resolveMime, validateFile } from "../../files/fileTypes";
import {
  checkRequiredFields,
  customValuesDiff,
  dealChecksRequired,
  MAX_CARD_FIELDS,
  normalizeDefinition,
  sanitizeCustomValues,
} from "../../custom-fields/customFields";
import {
  leadNoteText,
  leadWebhookUrl,
  TEST_LEAD,
} from "../../leads/leadWebhook";
import type {
  ImportBatchResult,
  IntegrationKind,
  IntegrationStatus,
} from "../../types";
import type { BatchRow, ImportMode } from "../../import/importMapping";
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
  applyWaitingFilter,
  dealsWaiting,
  WAITING_FILTER,
} from "../commons/responseTime";
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
import { importBatchInMemory } from "./importBatch";
import type { Db } from "./dataGenerator/types";
import { withSupabaseFilterAdapter } from "./internal/supabaseAdapter";
import { telephonyWebhookUrl } from "../../telephony/telephony";
import { createMailingDemo } from "./mailings";
import { createUnsortedDemo } from "./unsorted";
import { unsortedIntake } from "../../unsorted/unsorted";
import { createListPlanDemo } from "./listsPlans";
import { applyTaskStateFilter } from "../../deals/list/dealFilters";
import { createDigitalPipelineDemo } from "./digitalPipeline";
import { createOnboardingDemo } from "./onboarding";
import { createMarketplaceDemo } from "./marketplace";

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
  "doctor_name",
  "prepayment_amount",
  "last_activity_at",
  "next_task_text",
];

// Demo lead webhook and Telegram bot (nothing is really reachable)
const DEMO_FUNCTIONS_URL = "https://demo.dentalcrm.kz/functions/v1";
const DEMO_BOT = { username: "zhemchug_dental_bot", name: "Жемчуг Дентал" };

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
  // The latency is paid once per call of the app (withLatency below), not
  // by every read of the demo's own "triggers": bulk actions stay fast
  const baseDataProvider = fakeRestDataProvider(db, !silent, 0);
  let messengerConnected = true;
  // Demo: the clinic is connected to Zadarma, the last event is the latest call
  const demoTelephony = (
    provider: TelephonyProvider,
    token = "demo-telephony-token",
  ): TelephonyStatus => ({
    provider,
    webhook_token: token,
    webhook_url: telephonyWebhookUrl(
      "https://demo.supabase.co",
      provider,
      token,
    ),
    has_secret: true,
    has_api_key: true,
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    last_event_at:
      db.calls
        .filter((call) => call.provider)
        .map((call) => call.called_at)
        .sort()
        .at(-1) ?? null,
  });
  let telephony: TelephonyStatus | null = demoTelephony("zadarma");
  let telegramBotConnected = true;
  let leadToken = "demo-token";
  let notificationPreferences: NotificationPreferences = {
    kinds: [
      "lead_assigned",
      "patient_message",
      "response_overdue",
      "task_overdue",
    ],
    browser_enabled: false,
    telegram_enabled: true,
    telegram_linked: false,
  };
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
  // «Неразобранное» and duplicate patients (stage 18)
  const unsortedDemo = createUnsortedDemo({
    baseDataProvider,
    all,
    currentSalesId: () => currentSalesId(),
    getDataProvider: () => dataProvider,
  });
  // Digital pipeline, webhooks and API keys (stage 20)
  const pipelineDemo = createDigitalPipelineDemo({
    baseDataProvider,
    all,
    currentSalesId: () => currentSalesId(),
    getDataProvider: () => dataProvider,
    renderTemplate: async (deal, templateId) => {
      const template = (await all<MessageTemplate>("message_templates")).find(
        (t) => String(t.id) === String(templateId),
      );
      return template ? renderAutomessage(deal, template) : "";
    },
  });
  // Deal list and sales plan (stage 21)
  const listPlanDemo = createListPlanDemo({
    baseDataProvider,
    all,
    currentSalesId: () => currentSalesId(),
    getDataProvider: () => dataProvider,
  });
  // Setup wizard (stage 24)
  const onboardingDemo = createOnboardingDemo({
    baseDataProvider,
    all,
    currentSalesId: () => currentSalesId(),
  });
  // Marketplace: developer apps and the integrator (stage 25)
  const marketplaceDemo = createMarketplaceDemo({
    baseDataProvider,
    all,
    currentSalesId: () => currentSalesId(),
  });
  const clinicSettings = async () =>
    (await all<OrganizationSettings>("organization_settings"))[0];

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
    const [patient, services, doctors, configuration, customFields] =
      await Promise.all([
        baseDataProvider
          .getOne<Patient>("patients", { id: deal.patient_id })
          .then((r) => r.data)
          .catch(() => undefined),
        all<Service>("services"),
        all<Doctor>("doctors"),
        baseDataProvider
          .getOne("configuration", { id: 1 })
          .then((r) => r.data)
          .catch(() => undefined),
        all<CustomField>("custom_fields"),
      ]);
    return renderTemplate(
      template.body,
      automessageValues({
        deal,
        patientFirstName: patient?.first_name,
        serviceName: services.find((s) => s.id === deal.service_id)?.name,
        doctorName: doctors.find((d) => d.id === deal.doctor_id)?.name,
        clinicName: configuration?.config?.title || DEMO_CLINIC_NAME,
        customFields,
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
        // A row queued by a stage trigger has its template, no rule
        const template = templates.find(
          (t) => t.id === (row.template_id ?? rule?.template_id),
        );
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
        if ((!row.template_id && !rule?.is_active) || !template) {
          await close({
            status: "cancelled",
            error: "Правило выключено или удалено",
          });
          continue;
        }
        const text = await renderAutomessage(deal, template);
        if (rule?.mode === "confirm") {
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

  /** A file of the demo: kept in memory as a data: URL (no storage) */
  const readDemoFile = async (file: File) => {
    const problem = validateFile(file);
    if (problem) throw new Error(`files.errors.${problem}`);
    const mime = resolveMime(file.type, file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return {
      path: `data:${mime};base64,${btoa(binary)}`,
      name: file.name,
      mime,
      size: file.size,
    };
  };

  /** Same as the deal_files row of messenger_send and of the tab «Файлы» */
  const listDealFile = async (
    deal: Deal,
    file: { path: string; name: string; mime: string; size: number },
    salesId: Identifier | null | undefined,
    messageId: Identifier | null,
  ) => {
    const { data } = await baseDataProvider.create<DealFile>("deal_files", {
      data: {
        deal_id: deal.id,
        patient_id: deal.patient_id,
        ...file,
        sales_id: salesId ?? null,
        message_id: messageId,
        created_at: new Date().toISOString(),
      },
    });
    return data;
  };

  /** An outgoing message of a deal (no Wazzup24 in the demo) */
  const storeOutgoing = async (
    deal: Deal,
    text: string,
    salesId: Identifier | null | undefined,
    automessageId: Identifier | null,
    attachment?: { path: string; name: string; mime: string; size: number },
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
        text: attachment ? text || null : text,
        content_type: attachment
          ? fileContentType(attachment.mime, attachment.name)
          : "text",
        status: "sent",
        sent_at: new Date().toISOString(),
        automessage_id: automessageId,
        ...(attachment
          ? {
              attachment_path: attachment.path,
              attachment_name: attachment.name,
              attachment_mime: attachment.mime,
              attachment_size: attachment.size,
            }
          : {}),
      },
    });
    if (attachment) await listDealFile(deal, attachment, salesId, data.id);
    // Same as the message trigger of the digital pipeline
    await pipelineDemo.onMessage(data);
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
    const [deals, stages, patients, tasks, messages, doctors, payments] =
      await Promise.all([
        all<Deal>("deals"),
        all<Stage>("stages"),
        all<Patient>("patients"),
        all<Task>("tasks"),
        all<Message>("messages"),
        all<Doctor>("doctors"),
        all<DealPayment>("deal_payments"),
      ]);
    const kind = new Map(stages.map((stage) => [stage.id, stage.kind]));
    const patientsById = new Map(patients.map((p) => [p.id, p]));
    const doctorsById = new Map(doctors.map((d) => [d.id, d]));
    return deals.map((deal) => {
      const patient = patientsById.get(deal.patient_id);
      const open = tasks
        .filter((task) => task.deal_id === deal.id && !task.done_date)
        .sort(
          (a, b) =>
            a.due_date.localeCompare(b.due_date) || Number(a.id) - Number(b.id),
        );
      const messageSummaryOfDeal = messageSummary(
        messages.filter((message) => message.deal_id === deal.id),
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
        next_task_due_at: open[0]?.due_date ?? null,
        ...messageSummaryOfDeal,
        doctor_id: deal.doctor_id ?? null,
        doctor_name:
          deal.doctor_id != null
            ? (doctorsById.get(deal.doctor_id)?.name ?? null)
            : null,
        consultation_amount: deal.consultation_amount ?? null,
        prepayment_amount: payments
          .filter((p) => p.deal_id === deal.id && p.kind === "prepayment")
          .reduce((sum, p) => sum + Number(p.amount), 0),
        // Deal list (stage 21)
        last_activity_at:
          [deal.updated_at, messageSummaryOfDeal.last_message_at]
            .filter((value): value is string => !!value)
            .sort()
            .at(-1) ?? deal.updated_at,
        next_task_text: open[0]?.text ?? null,
      };
    });
  };

  // Same as the audit_log_summary view: deal and patient names, search text
  const auditLogSummary = async () => {
    const [rows, deals, patients] = await Promise.all([
      all<AuditLogEntry>("audit_log"),
      all<Deal>("deals"),
      all<Patient>("patients"),
    ]);
    const dealsById = new Map(deals.map((deal) => [deal.id, deal]));
    const patientsById = new Map(patients.map((p) => [p.id, p]));
    return rows.map((row) => {
      const deal = row.deal_id != null ? dealsById.get(row.deal_id) : null;
      const patient =
        row.patient_id != null ? patientsById.get(row.patient_id) : null;
      const patient_name =
        [patient?.last_name, patient?.first_name].filter(Boolean).join(" ") ||
        null;
      return {
        ...row,
        deal_name: deal?.name ?? null,
        patient_name,
        search_text: [
          deal?.name,
          patient?.last_name,
          patient?.first_name,
          patient?.middle_name,
          ...(patient?.phones ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      };
    });
  };

  // Same as the view deals_waiting
  const dealsWaitingView = async () => {
    const [deals, stages, patients, messages, settings] = await Promise.all([
      all<Deal>("deals"),
      all<Stage>("stages"),
      all<Patient>("patients"),
      all<Message>("messages"),
      all<OrganizationSettings>("organization_settings"),
    ]);
    return dealsWaiting({
      deals,
      stages,
      patients,
      messages,
      settings: settings[0],
    });
  };

  const views: Record<string, () => Promise<any[]>> = {
    patients: patientsSummary,
    deals: dealsSummary,
    audit_log: auditLogSummary,
    deals_waiting: dealsWaitingView,
    ...mailingDemo.views,
    ...unsortedDemo.views,
  };
  const viewProvider = async (resource: string) =>
    fakeRestDataProvider({ [resource]: await views[resource]() }, false, 0);

  // --- custom methods ---------------------------------------------------

  const custom = {
    ...baseDataProvider,
    ...mailingDemo.methods,
    ...unsortedDemo.methods,
    ...listPlanDemo.methods,
    ...pipelineDemo.methods,
    ...onboardingDemo.methods,
    ...marketplaceDemo.methods,
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
      if (resource === "saved_filters") {
        return listPlanDemo.listSavedFilters(params);
      }
      if (resource === "quick_replies") {
        // Same as the RLS policy: clinic-wide replies and my own
        const me = await currentSalesId();
        const visible = (await all<QuickReply>("quick_replies")).filter(
          (reply) => reply.sales_id == null || reply.sales_id === me,
        );
        return fakeRestDataProvider(
          { quick_replies: visible },
          false,
          0,
        ).getList(resource, params);
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
      file?: File | null,
    ): Promise<Message> => {
      const attachment = file ? await readDemoFile(file) : undefined;
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
        attachment,
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
    // Files of the deals (stage 22): data: URLs in memory
    uploadDealFile: async (
      dealId: Identifier,
      file: File,
    ): Promise<DealFile> => {
      const content = await readDemoFile(file);
      const { data: deal } = await baseDataProvider.getOne<Deal>("deals", {
        id: dealId,
      });
      const row = await listDealFile(
        deal,
        content,
        await currentSalesId(),
        null,
      );
      await logAudit({
        entity: "file",
        entity_id: row.id,
        action: "create",
        changes: {
          name: [null, row.name],
          size: [null, row.size],
          mime: [null, row.mime],
        },
        deal_id: deal.id,
        patient_id: deal.patient_id,
      });
      return row;
    },
    getFileUrl: async (path: string, _downloadName?: string) => path,
    /** Same rules as the delete policy of deal_files */
    deleteDealFile: async (file: DealFile): Promise<void> => {
      const me = await getIdentity();
      const role = (await all<Sale>("sales")).find(
        (sale) => sale.id === me?.id,
      )?.role;
      if (
        file.message_id != null ||
        (role !== "owner" &&
          role !== "head" &&
          String(file.sales_id) !== String(me?.id))
      ) {
        throw new Error("files.errors.delete");
      }
      await baseDataProvider.delete("deal_files", {
        id: file.id,
        previousData: file,
      });
      await logAudit({
        entity: "file",
        entity_id: file.id,
        action: "delete",
        changes: {
          name: [file.name, null],
          size: [file.size, null],
          mime: [file.mime, null],
        },
        deal_id: file.deal_id,
        patient_id: file.patient_id,
      });
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
    // Demo: a made-up address; the test request runs public.ingest_lead's rules
    getLeadWebhook: async (): Promise<LeadWebhook> => ({
      token: leadToken,
      url: leadWebhookUrl(DEMO_FUNCTIONS_URL, leadToken),
    }),
    regenerateLeadWebhook: async (): Promise<LeadWebhook> => {
      leadToken = `demo-${Math.random().toString(36).slice(2, 12)}`;
      return {
        token: leadToken,
        url: leadWebhookUrl(DEMO_FUNCTIONS_URL, leadToken),
      };
    },
    sendTestLead: async (_url: string): Promise<void> => {
      const phone = normalizePhone(TEST_LEAD.phone)!;
      const [patients, deals, stages, sources] = await Promise.all([
        all<Patient>("patients"),
        all<Deal>("deals"),
        all<Stage>("stages"),
        all<LeadSource>("lead_sources"),
      ]);
      const source = sources.find((s) => s.code === TEST_LEAD.source);
      let patient = patients.find((p) => p.phones?.includes(phone));
      if (!patient) {
        ({ data: patient } = await dataProvider.create<Patient>("patients", {
          data: {
            first_name: TEST_LEAD.name,
            phone_jsonb: [{ number: phone, type: "mobile" }],
            source_id: source?.id ?? null,
          },
        }));
      }
      const open = new Set(
        stages.filter((s) => s.kind === "open").map((s) => s.id),
      );
      let deal = deals
        .filter(
          (d) =>
            d.patient_id === patient!.id &&
            open.has(d.stage_id) &&
            !d.archived_at,
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      const repeat = !!deal;
      if (!deal) {
        ({ data: deal } = await dataProvider.create<Deal>("deals", {
          data: {
            patient_id: patient.id,
            source_id: source?.id ?? null,
            sales_id: null,
            unsorted_at: unsortedIntake(await clinicSettings(), source?.id),
          },
        }));
      }
      await baseDataProvider.create("deal_notes", {
        data: {
          deal_id: deal.id,
          type: "lead",
          text: leadNoteText({
            repeat,
            sourceName: source?.name ?? "Сайт",
            name: TEST_LEAD.name,
            phone,
            comment: TEST_LEAD.comment,
          }),
          date: new Date().toISOString(),
          sales_id: null,
        },
      });
    },
    getTelegramBotStatus: async (): Promise<TelegramBotStatus | null> =>
      telegramBotConnected
        ? {
            connected: true,
            username: DEMO_BOT.username,
            name: DEMO_BOT.name,
            connected_at: new Date().toISOString(),
            last_error: null,
          }
        : null,
    connectTelegramBot: async (_botToken: string): Promise<void> => {
      telegramBotConnected = true;
    },
    disconnectTelegramBot: async (): Promise<void> => {
      telegramBotConnected = false;
    },
    getTelephonyStatus: async (): Promise<TelephonyStatus | null> => telephony,
    saveTelephony: async ({
      provider,
      secret,
      apiKey,
    }: {
      provider: TelephonyProvider;
      secret?: string | null;
      apiKey?: string | null;
    }): Promise<void> => {
      const current = telephony ?? {
        ...demoTelephony(provider),
        has_secret: false,
        has_api_key: false,
        last_event_at: null,
      };
      telephony = {
        ...current,
        provider,
        webhook_url: telephonyWebhookUrl(
          "https://demo.supabase.co",
          provider,
          current.webhook_token,
        ),
        has_secret: secret == null ? current.has_secret : !!secret.trim(),
        has_api_key: apiKey == null ? current.has_api_key : !!apiKey.trim(),
      };
    },
    regenerateTelephonyToken: async (): Promise<string> => {
      if (!telephony) throw new Error("Telephony is not connected");
      const token = `demo-${Math.random().toString(36).slice(2, 12)}`;
      telephony = {
        ...telephony,
        webhook_token: token,
        webhook_url: telephonyWebhookUrl(
          "https://demo.supabase.co",
          telephony.provider,
          token,
        ),
      };
      return token;
    },
    disconnectTelephony: async (): Promise<void> => {
      telephony = null;
    },
    // Same as public.telephony_test_call: a missed call from a test number
    simulateTelephonyCall: async (): Promise<{ deal_id: Identifier }> => {
      if (!telephony) throw new Error("Telephony is not connected");
      const phone = "+77000000000";
      const source = (await all<LeadSource>("lead_sources")).find(
        (item) => item.code === "call",
      );
      let patient = (await all<Patient>("patients")).find((item) =>
        item.phones?.includes(phone),
      );
      if (!patient) {
        ({ data: patient } = await dataProvider.create<Patient>("patients", {
          data: {
            first_name: "Тестовый звонок",
            last_name: "",
            phone_jsonb: [{ number: phone, type: "mobile" }],
            source_id: source?.id ?? null,
            sales_id: null,
          } as Partial<Patient>,
        }));
      }
      const openStages = new Set(
        (await all<Stage>("stages"))
          .filter((stage) => stage.kind === "open")
          .map((stage) => stage.id),
      );
      let deal = (await all<Deal>("deals"))
        .filter(
          (item) =>
            item.patient_id === patient.id &&
            openStages.has(item.stage_id) &&
            !item.archived_at,
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (!deal) {
        ({ data: deal } = await dataProvider.create<Deal>("deals", {
          data: {
            patient_id: patient.id,
            source_id: source?.id ?? null,
            sales_id: null,
            unsorted_at: unsortedIntake(await clinicSettings(), source?.id),
          } as Partial<Deal>,
        }));
      }
      const now = new Date().toISOString();
      const { data: call } = await baseDataProvider.create<Call>("calls", {
        data: {
          patient_id: patient.id,
          deal_id: deal.id,
          direction: "in",
          duration_seconds: 0,
          called_at: now,
          sales_id: null,
          provider: "generic",
          status: "missed",
          external_id: `test-${Date.now()}`,
          phone,
        },
      });
      await baseDataProvider.create<Task>("tasks", {
        data: {
          deal_id: deal.id,
          type: "call",
          text: "Перезвонить",
          due_date: now,
          done_date: null,
          sales_id: deal.sales_id ?? undefined,
        },
      });
      await pipelineDemo.onCall(call);
      telephony = { ...telephony, last_event_at: now };
      return { deal_id: deal.id };
    },
    setSalesPhoneExtension: async (
      salesId: Identifier,
      extension: string | null,
    ): Promise<void> => {
      const value = extension?.trim() || null;
      const sales = await all<Sale>("sales");
      if (
        value &&
        sales.some(
          (sale) => sale.id !== salesId && sale.phone_extension === value,
        )
      ) {
        throw Object.assign(new Error("telephony.extensions.taken"), {
          code: "23505",
        });
      }
      const previousData = sales.find((sale) => sale.id === salesId);
      if (!previousData) throw new Error("User not found");
      await baseDataProvider.update("sales", {
        id: salesId,
        data: { phone_extension: value },
        previousData,
      });
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
    // Same as public.import_batch (import wizard)
    importBatch: async (
      kind: ImportMode,
      rows: BatchRow[],
    ): Promise<ImportBatchResult> => {
      const salesId = await currentSalesId();
      const sale = (await all<Sale>("sales")).find(
        (s) => String(s.id) === String(salesId),
      );
      return importBatchInMemory({
        base: baseDataProvider,
        kind,
        rows,
        // The demo user is the owner of the clinic
        role: sale?.role ?? "owner",
      });
    },
    getIntegrationStatus: async (): Promise<IntegrationStatus[]> =>
      all<IntegrationStatus>("integrations").catch(() => []),
    requestIntegration: async (kind: IntegrationKind): Promise<void> => {
      const existing = (
        await all<IntegrationStatus & { id: Identifier }>("integrations").catch(
          () => [],
        )
      ).find((integration) => integration.kind === kind);
      if (existing) return;
      await baseDataProvider.create("integrations", {
        data: {
          kind,
          status: "requested",
          last_sync_at: null,
          last_error: null,
        },
      });
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
      // The internal number goes through setSalesPhoneExtension, as in the database
      const { phone_extension: _extension, ...fields } = data;
      const { data: sale } = await dataProvider.update<Sale>("sales", {
        id,
        data: fields,
        previousData,
      });
      return { ...sale, user_id: sale.id.toString() };
    },
    isInitialized: async (): Promise<boolean> =>
      (await all<Sale>("sales")).length > 0,
    updatePassword: async (): Promise<true> => true,
    // --- notifications (stage 16), kept in memory in the demo ---
    getNotificationPreferences: async (): Promise<NotificationPreferences> => ({
      ...notificationPreferences,
    }),
    saveNotificationPreferences: async (
      preferences: Pick<
        NotificationPreferences,
        "kinds" | "browser_enabled" | "telegram_enabled"
      >,
    ): Promise<NotificationPreferences> => {
      notificationPreferences = {
        ...notificationPreferences,
        kinds: [...new Set(preferences.kinds)].sort(),
        browser_enabled: preferences.browser_enabled,
        telegram_enabled: preferences.telegram_enabled,
      };
      return { ...notificationPreferences };
    },
    // The demo has no bot: the code is shown, nothing links it
    createTelegramLinkCode: async (): Promise<string> => {
      const code = Math.random().toString(16).slice(2, 18).padEnd(16, "0");
      notificationPreferences = {
        ...notificationPreferences,
        telegram_link_code: code,
        telegram_link_expires_at: new Date(
          Date.now() + 30 * 60 * 1000,
        ).toISOString(),
      };
      return code;
    },
    unlinkTelegram: async (): Promise<void> => {
      notificationPreferences = {
        ...notificationPreferences,
        telegram_linked: false,
        telegram_username: null,
        telegram_link_code: null,
        telegram_link_expires_at: null,
      };
    },
    markAllNotificationsRead: async (): Promise<number> => {
      const me = await currentSalesId();
      const unread = (await all<CrmNotification>("notifications")).filter(
        (n) => String(n.sales_id) === String(me) && !n.read_at,
      );
      for (const notification of unread) {
        await baseDataProvider.update("notifications", {
          id: notification.id,
          data: { read_at: new Date().toISOString() },
          previousData: notification,
        });
      }
      return unread.length;
    },
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
        "doctors",
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

  /**
   * Same as private.handle_custom_values: the values a write stores (changed
   * ones normalized, unknown keys dropped, archived fields kept) and the
   * required fields, checked for employees when `checksRequired` says so.
   */
  const writeCustomValues = async (
    entity: CustomFieldEntity,
    provided: CustomValues | null | undefined,
    previous: CustomValues | null | undefined,
    checksRequired: (valuesChanged: boolean) => boolean,
  ) => {
    const before = previous ?? {};
    const fields = await all<CustomField>("custom_fields");
    const values =
      provided === undefined
        ? before
        : sanitizeCustomValues({
            fields,
            entity,
            previous: before,
            next: provided ?? {},
          });
    const valuesChanged =
      Object.keys(customValuesDiff(before, values)).length > 0;
    if ((await currentSalesId()) != null && checksRequired(valuesChanged)) {
      checkRequiredFields(fields, entity, values);
    }
    return values;
  };

  // Same as the audit triggers (supabase/schemas/15_audit.sql)
  const logAudit = async (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => {
    // Changes of the digital pipeline have no author (source automation)
    const automatic = pipelineDemo.isAutomating();
    const salesId = automatic ? null : ((await currentSalesId()) ?? null);
    return baseDataProvider.create("audit_log", {
      data: {
        deal_id: null,
        patient_id: null,
        ...row,
        at: new Date().toISOString(),
        sales_id: salesId,
        source: automatic ? "automation" : salesId == null ? "system" : "user",
      },
    });
  };

  const logDealEvent = async (event: Omit<DealEvent, "id" | "created_at">) => {
    const result = await baseDataProvider.create("deal_events", {
      data: {
        ...event,
        sales_id:
          event.sales_id ??
          (pipelineDemo.isAutomating() ? null : await currentSalesId()) ??
          null,
        created_at: new Date().toISOString(),
      },
    });
    // The audit log copies every deal event
    const { data: deal } = await baseDataProvider.getOne<Deal>("deals", {
      id: event.deal_id,
    });
    const changes = event.changes ?? {};
    await logAudit({
      entity: "deal",
      entity_id: event.deal_id,
      deal_id: event.deal_id,
      patient_id: deal?.patient_id ?? null,
      ...(event.type === "created"
        ? {
            action: "create",
            changes: {
              name: [null, deal?.name ?? null],
              stage_id: [null, deal?.stage_id ?? null],
              ...(deal?.sales_id != null
                ? { sales_id: [null, deal.sales_id] }
                : {}),
              ...(deal?.plan_amount
                ? { plan_amount: [null, deal.plan_amount] }
                : {}),
            },
          }
        : event.type === "stage_changed"
          ? {
              action: "stage_change",
              changes: {
                stage_id: [
                  event.from_stage_id ?? null,
                  event.to_stage_id ?? null,
                ],
                ...changes,
              },
            }
          : {
              action:
                "archived_at" in changes
                  ? changes.archived_at[1]
                    ? "archive"
                    : "unarchive"
                  : "update",
              changes,
            }),
    });
    return result;
  };

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

  const logPayment = async (
    action: "create" | "delete",
    payment: DealPayment,
  ) => {
    const { data: deal } = await baseDataProvider.getOne<Deal>("deals", {
      id: payment.deal_id,
    });
    const values = {
      amount: payment.amount,
      paid_at: payment.paid_at,
      comment: payment.comment ?? null,
    };
    await logAudit({
      entity: "payment",
      entity_id: payment.id,
      action,
      changes: Object.fromEntries(
        Object.entries(values).map(([field, value]) => [
          field,
          action === "create" ? [null, value] : [value, null],
        ]),
      ) as AuditLogEntry["changes"],
      deal_id: payment.deal_id,
      patient_id: deal?.patient_id ?? null,
    });
  };

  // Previous state of the deals being updated, for the log
  const previousDeals = new Map<Identifier, Deal>();
  // Previous custom values of the patients being updated, for the log
  const previousPatientValues = new Map<Identifier, CustomValues>();

  /** Same as the constraints of public.custom_fields and its trigger */
  const checkDefinition = async (
    data: CustomField,
    previous?: CustomField,
    rightsOnly = false,
  ) => {
    const salesId = await currentSalesId();
    const role = (await all<Sale>("sales")).find(
      (sale) => sale.id === salesId,
    )?.role;
    if (role !== "owner" && role !== "head" && role !== "integrator") {
      throw new Error("Поля настраивают владелец и руководитель клиники");
    }
    if (rightsOnly) return;
    if (!data.name) throw new Error("Укажите название поля");
    if (/[{}]/.test(data.name)) {
      throw new Error("Название поля не может содержать фигурные скобки");
    }
    const others = (await all<CustomField>("custom_fields")).filter(
      (field) => field.id !== previous?.id,
    );
    if (
      others.some(
        (field) =>
          field.entity === data.entity &&
          field.name.toLowerCase() === data.name.toLowerCase(),
      )
    ) {
      throw new Error("Поле с таким названием уже есть");
    }
    if (["select", "multiselect"].includes(data.type) && !data.options.length) {
      throw new Error("Добавьте варианты списка");
    }
    if (
      data.show_on_card &&
      !previous?.show_on_card &&
      others.filter((field) => field.show_on_card).length >= MAX_CARD_FIELDS
    ) {
      throw new Error(
        "На карточке канбана можно показать не больше двух полей",
      );
    }
  };

  const dataProvider = withLifecycleCallbacks(
    withSupabaseFilterAdapter(custom as DataProvider),
    [
      // First: the integrator only reads the deals (stage 25)
      ...marketplaceDemo.callbacks,
      ...mailingDemo.callbacks,
      ...listPlanDemo.callbacks,
      ...onboardingDemo.callbacks,
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
            custom_values: await writeCustomValues(
              "patient",
              params.data.custom_values ?? {},
              {},
              (changed) => changed,
            ),
          }),
        }),
        beforeUpdate: async (params) => {
          const data = withoutKeys(params.data, PATIENT_VIEW_COLUMNS);
          if (data.custom_values !== undefined) {
            const { data: previous } = await baseDataProvider.getOne<Patient>(
              "patients",
              { id: params.id },
            );
            data.custom_values = await writeCustomValues(
              "patient",
              data.custom_values,
              previous.custom_values,
              (changed) => changed,
            );
            previousPatientValues.set(params.id, previous.custom_values ?? {});
          }
          return { ...params, data: normalizePatient(data) };
        },
        // Same as the audit trigger of patients: one line per custom field
        afterUpdate: async (result) => {
          const patient = result.data as Patient;
          const before = previousPatientValues.get(patient.id);
          previousPatientValues.delete(patient.id);
          if (!before) return result;
          const changes = customValuesDiff(before, patient.custom_values);
          if (Object.keys(changes).length) {
            await logAudit({
              entity: "patient",
              entity_id: patient.id,
              action: "update",
              changes: changes as AuditLogEntry["changes"],
              patient_id: patient.id,
            });
          }
          return result;
        },
      } satisfies ResourceCallbacks<Patient>,
      {
        // Same as private.handle_custom_field_write and the RLS policies
        resource: "custom_fields",
        beforeCreate: async (params) => {
          const data = normalizeDefinition({
            is_active: true,
            show_on_card: false,
            required: false,
            options: [],
            position: 0,
            ...params.data,
          } as CustomField);
          await checkDefinition(data);
          return {
            ...params,
            data: { ...data, created_at: new Date().toISOString() },
          };
        },
        beforeUpdate: async (params) => {
          const { data: previous } = await baseDataProvider.getOne<CustomField>(
            "custom_fields",
            {
              id: params.id,
            },
          );
          if (
            (params.data.type != null && params.data.type !== previous.type) ||
            (params.data.entity != null &&
              params.data.entity !== previous.entity)
          ) {
            throw new Error("Тип поля изменить нельзя: создайте новое поле");
          }
          const data = normalizeDefinition({
            ...previous,
            ...params.data,
          } as CustomField);
          await checkDefinition(data, previous);
          return { ...params, data };
        },
        beforeDelete: async (params) => {
          await checkDefinition(
            params.previousData as CustomField,
            params.previousData as CustomField,
            true,
          );
          return params;
        },
      } satisfies ResourceCallbacks<CustomField>,
      {
        resource: "deals",
        // Quick filter «Ждут ответа»: the overdue deals of deals_waiting
        beforeGetList: async (params) => {
          const filtered = applyTaskStateFilter(params);
          return filtered.filter?.[WAITING_FILTER]
            ? applyWaitingFilter(
                filtered,
                (await dealsWaitingView())
                  .filter((row) => row.overdue)
                  .map((row) => row.id),
              )
            : filtered;
        },
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
          const custom_values = await writeCustomValues(
            "deal",
            data.custom_values ?? {},
            {},
            (valuesChanged) =>
              dealChecksRequired({
                stages,
                deal: { pipeline_id, stage_id },
                isNew: true,
                stageChanged: false,
                valuesChanged,
              }),
          );
          const now = new Date().toISOString();
          return {
            ...params,
            data: {
              ...data,
              custom_values,
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
          // An unsorted lead gets its automations when it is accepted
          if (!deal.unsorted_at) {
            await createRuleTasks(deal, "deal_created");
            await createRuleTasks(deal, "stage_entered", deal.stage_id);
            await scheduleDealAutomessages(deal);
          }
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
          // Same as handle_deal_before_write: a deal never goes back to
          // «Неразобранное», moving an unsorted lead to a stage accepts it
          const unsorted = !!previous.unsorted_at;
          if (
            !unsorted ||
            (data.stage_id != null &&
              String(data.stage_id) !== String(previous.stage_id)) ||
            (data.pipeline_id != null &&
              String(data.pipeline_id) !== String(previous.pipeline_id))
          ) {
            if ("unsorted_at" in data || unsorted) data.unsorted_at = null;
          }
          const next = unsorted
            ? ({ ...previous, ...data } as Deal)
            : applyPipelineMove({
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
          if (!unsorted) {
            checkStageChecklist({
              previous,
              next,
              stages,
              items: await all<StageChecklistItem>("stage_checklist_items"),
              checks: await all<DealChecklistCheck>("deal_checklist_checks"),
            });
          }
          const stageChanged =
            next.stage_id !== previous.stage_id ||
            next.pipeline_id !== previous.pipeline_id;
          if (data.custom_values !== undefined || stageChanged) {
            data.custom_values = await writeCustomValues(
              "deal",
              data.custom_values,
              previous.custom_values,
              (valuesChanged) =>
                dealChecksRequired({
                  stages,
                  deal: next,
                  isNew: false,
                  stageChanged,
                  valuesChanged,
                }),
            );
          }
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
          const changes = {
            ...dealChanges(previous, deal),
            ...customValuesDiff(previous.custom_values, deal.custom_values),
          };
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
          } else if (Object.keys(changes).length) {
            await logDealEvent({ deal_id: deal.id, type: "updated", changes });
          }
          // An unsorted lead gets no automation; accepted into an open
          // stage, the automations of a new deal (handle_deal_after_write,
          // handle_deal_automessages)
          if (previous.unsorted_at) {
            const kind = (await all<Stage>("stages")).find(
              (stage) => stage.id === deal.stage_id,
            )?.kind;
            if (!deal.unsorted_at && kind === "open") {
              await createRuleTasks(deal, "deal_created");
              await createRuleTasks(deal, "stage_entered", deal.stage_id);
              await scheduleDealAutomessages(deal);
            }
            return result;
          }
          if (previous.stage_id !== deal.stage_id) {
            await createRuleTasks(deal, "stage_entered", deal.stage_id);
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
              kind: params.data.kind ?? "payment",
              paid_at:
                params.data.paid_at ?? new Date().toISOString().slice(0, 10),
              sales_id: await currentSalesId(),
              created_at: new Date().toISOString(),
            },
          };
        },
        afterCreate: async (result) => {
          await syncPaidAmount(result.data.deal_id);
          await logPayment("create", result.data);
          return result;
        },
        afterUpdate: async (result) => {
          await syncPaidAmount(result.data.deal_id);
          return result;
        },
        afterDelete: async (result) => {
          await syncPaidAmount(result.data.deal_id);
          await logPayment("delete", result.data);
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
        // Same as the composite foreign key deals.doctor_id: a doctor with
        // deals is switched off, not deleted
        resource: "doctors",
        beforeCreate: async (params) => ({
          ...params,
          data: {
            ...params.data,
            specialty: params.data.specialty ?? null,
            is_active: params.data.is_active ?? true,
            position: params.data.position ?? 0,
          },
        }),
        beforeDelete: async (params) => {
          const deals = await all<Deal>("deals");
          if (deals.some((deal) => deal.doctor_id === params.id)) {
            throw new Error("crm.settings.errors.in_use");
          }
          return params;
        },
      } satisfies ResourceCallbacks<Doctor>,
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
      // After the rules above: the digital pipeline sees the saved deal
      ...pipelineDemo.callbacks,
    ],
  ) as CrmDataProvider;

  return withLatency(dataProvider, latency);
};

/** A network-like delay before every call of the app */
const withLatency = <T extends object>(provider: T, latency: number): T =>
  latency <= 0
    ? provider
    : new Proxy(provider, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function"
            ? async (...args: unknown[]) => {
                await new Promise((resolve) => setTimeout(resolve, latency));
                return value.apply(target, args);
              }
            : value;
        },
      });

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

/** messages.content_type of a file (the Wazzup24 names) */
const fileContentType = (mime: string, name: string) => {
  const type = resolveMime(mime, name);
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "document";
};

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
