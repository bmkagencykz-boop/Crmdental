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
} from "../../types";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { getActivityLog } from "../commons/activity";
import {
  applyPipelineMove,
  checkDealStageChange,
  dealChanges,
  normalizePatient,
  normalizePhone,
  pipelineHasClosingStages,
} from "../commons/domain";
import type { CrmDataProvider } from "../types";
import {
  authProvider as defaultAuthProvider,
  USER_STORAGE_KEY,
} from "./authProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";
import { withSupabaseFilterAdapter } from "./internal/supabaseAdapter";

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
  };
  const viewProvider = async (resource: string) =>
    fakeRestDataProvider({ [resource]: await views[resource]() }, false, 0);

  // --- custom methods ---------------------------------------------------

  const custom = {
    ...baseDataProvider,
    async getList(resource: string, params: GetListParams) {
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
    sendMessage: async (dealId: Identifier, text: string): Promise<Message> => {
      const { data: deal } = await baseDataProvider.getOne<Deal>("deals", {
        id: dealId,
      });
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
          sales_id: await currentSalesId(),
          text,
          content_type: "text",
          status: "sent",
          sent_at: new Date().toISOString(),
        },
      });
      if (!deal.first_response_at) {
        await baseDataProvider.update("deals", {
          id: deal.id,
          data: { first_response_at: data.sent_at },
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
            sales_id: params.data.sales_id ?? (await currentSalesId()),
          },
        }),
      } satisfies ResourceCallbacks<Task>,
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
