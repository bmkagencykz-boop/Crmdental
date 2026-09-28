import { supabaseDataProvider } from "ra-supabase-core";
import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import type {
  Deal,
  DealNote,
  OrganizationSettings,
  Patient,
  PatientNote,
  RAFile,
  Sale,
  SalesFormData,
  SignUpData,
  Message,
  MessengerStatus,
  LeadWebhook,
  TelegramBotStatus,
  NotificationPreferences,
} from "../../types";
import {
  functionsBaseUrl,
  leadWebhookUrl,
  TEST_LEAD,
} from "../../leads/leadWebhook";
import type {
  ImportBatchResult,
  IntegrationKind,
  IntegrationStatus,
} from "../../types";
import type { BatchRow, ImportMode } from "../../import/importMapping";
import { applySearch } from "../commons/search";
import { telephonyWebhookUrl } from "../../telephony/telephony";
import type { TelephonyProvider, TelephonyStatus } from "../../types";
import { applyWaitingFilter, WAITING_FILTER } from "../commons/responseTime";
import type {
  ReportFilters,
  ReportName,
  ReportResult,
} from "../../reports/reportMath";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { getCurrentOrganizationId, getIsInitialized } from "./authProvider";
import { getSupabaseClient } from "./supabase";
import { getMailingMethods } from "./mailingMethods";
import { getFileMethods, uploadToDealFolder } from "./fileMethods";
import { getUnsortedMethods } from "./unsortedMethods";
import { getListPlanMethods } from "./listPlanMethods";
import { applyTaskStateFilter } from "../../deals/list/dealFilters";
import { getPipelineAutomationMethods } from "./pipelineAutomationMethods";
import { getOnboardingMethods } from "./onboardingMethods";
import { getMisMethods } from "./misMethods";
import { getSalesbotMethods } from "./salesbotMethods";
import { getMarketplaceMethods } from "./marketplaceMethods";

const getBaseDataProvider = () =>
  supabaseDataProvider({
    instanceUrl: import.meta.env.VITE_SUPABASE_URL,
    apiKey: import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    supabaseClient: getSupabaseClient(),
    sortOrder: "asc,desc.nullslast" as any,
  });

// The public address of the edge functions, given to websites and Tilda
const toLeadWebhook = (token: string): LeadWebhook => ({
  token,
  url: leadWebhookUrl(
    functionsBaseUrl(
      import.meta.env.VITE_SUPABASE_URL ?? "",
      import.meta.env.VITE_WEBHOOK_BASE_URL,
    ),
    token,
  ),
});
// Deals whose patient waits for an answer longer than the clinic's limit
const getOverdueDealIds = async (): Promise<Identifier[]> => {
  const { data, error } = await getSupabaseClient()
    .from("deals_waiting")
    .select("id")
    .eq("overdue", true);
  if (error) throw error;
  return (data ?? []).map((row) => row.id as Identifier);
};

// One row per organization, RLS returns the current one
const getOrganizationSettings = async (): Promise<OrganizationSettings> => {
  const { data, error } = await getSupabaseClient()
    .from("organization_settings")
    .select("*")
    .single();
  if (error) throw error;
  return data as OrganizationSettings;
};

const getDataProviderWithCustomMethods = () => {
  const baseDataProvider = getBaseDataProvider();

  return {
    ...baseDataProvider,
    // Repeat sales and mailings (stage 17)
    ...getMailingMethods(),
    // Files of the deals (stage 22)
    ...getFileMethods(),
    // «Неразобранное» and duplicate patients (stage 18)
    ...getUnsortedMethods(),
    // Deal list and sales plan (stage 21)
    ...getListPlanMethods(),
    // Webhooks and API keys (stage 20)
    ...getPipelineAutomationMethods(),
    // Setup wizard (stage 24)
    ...getOnboardingMethods(),
    // MIS connectors (stage 27)
    ...getMisMethods(),
    // «Салесбот» (stage 26)
    ...getSalesbotMethods(),
    // Marketplace: developer apps, integrator access (stage 25)
    ...getMarketplaceMethods(),
    async getList(resource: string, params: GetListParams) {
      // Lists read the summary views (counters, patient of a deal...)
      if (resource === "patients") {
        return baseDataProvider.getList("patients_summary", params);
      }
      if (resource === "deals") {
        // Quick filter «Ждут ответа»: the overdue deals of deals_waiting
        const waiting = params.filter?.[WAITING_FILTER]
          ? await getOverdueDealIds()
          : [];
        return baseDataProvider.getList(
          "deals_summary",
          applyWaitingFilter(applyTaskStateFilter(params), waiting),
        );
      }
      // Audit log with the deal and patient names (owner and head only, RLS)
      if (resource === "audit_log") {
        return baseDataProvider.getList("audit_log_summary", params);
      }
      if (resource === "activity_log") {
        const { data, total } = await baseDataProvider.getList(
          "activity_log",
          params,
        );
        // Rename snake_case view columns to camelCase to match Activity type
        return {
          data: data.map((row: any) => ({
            ...row,
            patientNote: row.patient_note ?? undefined,
            dealNote: row.deal_note ?? undefined,
            patient_note: undefined,
            deal_note: undefined,
          })),
          total,
        };
      }

      return baseDataProvider.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "patients") {
        return baseDataProvider.getOne("patients_summary", params);
      }
      if (resource === "deals") {
        return baseDataProvider.getOne("deals_summary", params);
      }
      return baseDataProvider.getOne(resource, params);
    },
    async getMany(resource: string, params: any) {
      if (resource === "deals") {
        return baseDataProvider.getMany("deals_summary", params);
      }
      return baseDataProvider.getMany(resource, params);
    },

    async signUp({
      organization_name,
      email,
      password,
      first_name,
      last_name,
    }: SignUpData) {
      // The handle_new_user trigger creates the clinic and makes the user its owner
      const response = await getSupabaseClient().auth.signUp({
        email,
        password,
        options: {
          data: {
            organization_name,
            first_name,
            last_name,
          },
        },
      });

      if (!response.data?.user || response.error) {
        console.error("signUp.error", response.error);
        throw new Error(response?.error?.message || "Failed to create account");
      }

      return {
        id: response.data.user.id,
        email,
        password,
      };
    },
    async salesCreate(body: SalesFormData) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: Sale;
      }>("users", {
        method: "POST",
        body,
      });

      if (!data || error) {
        console.error("salesCreate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw Object.assign(
          new Error(errorDetails?.message || "Failed to create the user"),
          { code: errorDetails?.code, email: errorDetails?.email },
        );
      }

      return data.data;
    },
    async salesUpdate(
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ) {
      const {
        email,
        secondary_emails,
        first_name,
        last_name,
        role,
        avatar,
        disabled,
      } = data;

      const { data: updatedData, error } =
        await getSupabaseClient().functions.invoke<{
          data: Sale;
        }>("users", {
          method: "PATCH",
          body: {
            sales_id: id,
            email,
            secondary_emails,
            first_name,
            last_name,
            role,
            disabled,
            avatar,
          },
        });

      if (!updatedData || error) {
        console.error("salesUpdate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw Object.assign(
          new Error(
            errorDetails?.message || "Failed to update account manager",
          ),
          { code: errorDetails?.code, email: errorDetails?.email },
        );
      }

      return updatedData.data;
    },
    async updatePassword(id: Identifier) {
      const { data: passwordUpdated, error } =
        await getSupabaseClient().functions.invoke<boolean>("update_password", {
          method: "PATCH",
          body: {
            sales_id: id,
          },
        });

      if (!passwordUpdated || error) {
        console.error("update_password.error", error);
        throw new Error("Failed to update password");
      }

      return passwordUpdated;
    },
    async unarchiveDeal(deal: Deal) {
      // Put the deal back at the top of its column
      const { data: deals } = await baseDataProvider.getList<Deal>("deals", {
        filter: { stage_id: deal.stage_id, "archived_at@is": null },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "index", order: "ASC" },
      });
      await Promise.all(
        deals.map((d, index) =>
          baseDataProvider.update("deals", {
            id: d.id,
            data: { index: index + 1 },
            previousData: d,
          }),
        ),
      );
      return baseDataProvider.update("deals", {
        id: deal.id,
        data: { index: 0, archived_at: null },
        previousData: deal,
      });
    },
    async isInitialized() {
      return getIsInitialized();
    },
    /** Patients whose numbers include this phone, whatever its format */
    async findPatientsByPhone(phone: string): Promise<Patient[]> {
      const { data, error } = await getSupabaseClient().rpc(
        "find_patients_by_phone",
        { phone },
      );
      if (error) throw error;
      return (data ?? []) as Patient[];
    },
    /** Creates a pipeline with a new, a won and a lost stage */
    async createPipeline(name: string): Promise<Identifier> {
      const { data, error } = await getSupabaseClient().rpc("create_pipeline", {
        pipeline_name: name,
      });
      if (error) throw error;
      return data as Identifier;
    },
    getOrganizationSettings,
    /**
     * Sends a message of a deal through Wazzup24 (edge function
     * messenger_send). With automessageId: the «Отправить» button of a "show
     * to the employee first" automatic message. With a file: uploaded to the
     * deal folder first, then sent as a link with the text as its caption.
     */
    async sendMessage(
      dealId: Identifier,
      text: string,
      automessageId?: Identifier | null,
      file?: File | null,
    ): Promise<Message> {
      const uploaded = file ? await uploadToDealFolder(dealId, file) : null;
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: Message;
      }>("messenger_send", {
        method: "POST",
        body: {
          deal_id: dealId,
          text,
          ...(automessageId != null ? { automessage_id: automessageId } : {}),
          ...(uploaded ? { file: uploaded } : {}),
        },
      });
      if (!data || error) {
        throw new Error(
          await functionErrorMessage(error, "crm.messages.send_error"),
        );
      }
      return data.data;
    },
    /** The employee opened the conversation: its messages are read */
    async markDealMessagesRead(dealId: Identifier): Promise<number> {
      const { data, error } = await getSupabaseClient().rpc(
        "mark_deal_messages_read",
        { deal_id: dealId },
      );
      if (error) throw error;
      return data as number;
    },
    async getMessengerStatus(): Promise<MessengerStatus | null> {
      const { data, error } = await getSupabaseClient().rpc("messenger_status");
      if (error) throw error;
      return ((data as MessengerStatus[]) ?? [])[0] ?? null;
    },
    /** Saves the Wazzup24 key, imports the channels, registers the webhook */
    async connectMessenger(apiKey: string): Promise<void> {
      const { error } = await getSupabaseClient().functions.invoke(
        "messenger_connect",
        { method: "POST", body: { api_key: apiKey } },
      );
      if (error) {
        throw new Error(
          await functionErrorMessage(
            error,
            "crm.settings.messengers.connect_error",
          ),
        );
      }
    },
    async disconnectMessenger(): Promise<void> {
      const { error } = await getSupabaseClient().functions.invoke(
        "messenger_connect",
        { method: "POST", body: { disconnect: true } },
      );
      if (error) throw error;
    },
    /** Address of the lead webhook (owner and head) */
    async getLeadWebhook(): Promise<LeadWebhook> {
      const { data, error } =
        await getSupabaseClient().rpc("lead_webhook_token");
      if (error) throw error;
      return toLeadWebhook(data as string);
    },
    /** A new token: forms using the old address are refused */
    async regenerateLeadWebhook(): Promise<LeadWebhook> {
      const { data, error } = await getSupabaseClient().rpc(
        "regenerate_lead_webhook_token",
      );
      if (error) throw error;
      return toLeadWebhook(data as string);
    },
    /** Posts a test request to the webhook, like a website form */
    async sendTestLead(url: string): Promise<void> {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(TEST_LEAD),
      }).catch(() => null);
      if (!response?.ok) throw new Error("leads.test_error");
    },
    async getTelegramBotStatus(): Promise<TelegramBotStatus | null> {
      const { data, error } = await getSupabaseClient().rpc(
        "telegram_bot_status",
      );
      if (error) throw error;
      return ((data as TelegramBotStatus[]) ?? [])[0] ?? null;
    },
    /** Checks the BotFather token and registers the bot's webhook */
    async connectTelegramBot(botToken: string): Promise<void> {
      const { error } = await getSupabaseClient().functions.invoke(
        "telegram_connect",
        { method: "POST", body: { bot_token: botToken } },
      );
      if (error) {
        throw new Error(
          await functionErrorMessage(
            error,
            "telegram.connect_error",
            "telegram.errors",
          ),
        );
      }
    },
    async disconnectTelegramBot(): Promise<void> {
      const { error } = await getSupabaseClient().functions.invoke(
        "telegram_connect",
        { method: "POST", body: { disconnect: true } },
      );
      if (error) throw error;
    },
    /** Telephony connection of the clinic, with the address for the PBX */
    async getTelephonyStatus(): Promise<TelephonyStatus | null> {
      const { data, error } = await getSupabaseClient().rpc("telephony_status");
      if (error) throw error;
      const row = ((data as Omit<TelephonyStatus, "webhook_url">[]) ?? [])[0];
      if (!row) return null;
      return {
        ...row,
        webhook_url: telephonyWebhookUrl(
          import.meta.env.VITE_SUPABASE_URL,
          row.provider,
          row.webhook_token,
        ),
      };
    },
    /** Connects the PBX; a null secret or key keeps the stored one */
    async saveTelephony({
      provider,
      secret,
      apiKey,
    }: {
      provider: TelephonyProvider;
      secret?: string | null;
      apiKey?: string | null;
    }): Promise<void> {
      const { error } = await getSupabaseClient().rpc("save_telephony", {
        telephony_provider: provider,
        new_secret: secret ?? null,
        new_api_key: apiKey ?? null,
      });
      if (error) throw error;
    },
    async regenerateTelephonyToken(): Promise<string> {
      const { data, error } = await getSupabaseClient().rpc(
        "regenerate_telephony_token",
      );
      if (error) throw error;
      return data as string;
    },
    async disconnectTelephony(): Promise<void> {
      const { error } = await getSupabaseClient().rpc("disconnect_telephony");
      if (error) throw error;
    },
    /** «Тестовый звонок»: a missed call from a test number */
    async simulateTelephonyCall(): Promise<{ deal_id: Identifier }> {
      const { data, error } = await getSupabaseClient().rpc(
        "telephony_test_call",
      );
      if (error) throw error;
      return data as { deal_id: Identifier };
    },
    /** Internal number of an employee in the PBX (owner and head) */
    async setSalesPhoneExtension(
      salesId: Identifier,
      extension: string | null,
    ): Promise<void> {
      const { error } = await getSupabaseClient().rpc(
        "set_sales_phone_extension",
        { target_sales_id: salesId, extension: extension ?? "" },
      );
      if (error) throw error;
    },
    async updateOrganizationSettings(
      settings: Partial<Omit<OrganizationSettings, "organization_id">>,
    ): Promise<OrganizationSettings> {
      const current = await getOrganizationSettings();
      const { data, error } = await getSupabaseClient()
        .from("organization_settings")
        .update(settings)
        .eq("organization_id", current.organization_id)
        .select("*")
        .single();
      if (error) throw error;
      return data as OrganizationSettings;
    },
    /** A report of the reports screen (public.report_*, owner and head only) */
    async getReport<Name extends ReportName>(
      name: Name,
      filters: ReportFilters,
    ): Promise<ReportResult[Name]> {
      const { data, error } = await getSupabaseClient().rpc(`report_${name}`, {
        period_from: filters.from ?? null,
        period_to: filters.to ?? null,
        filter_pipeline_id: filters.pipeline_id ?? null,
        filter_sales_id: filters.sales_id ?? null,
        filter_source_id: filters.source_id ?? null,
        filter_doctor_id: filters.doctor_id ?? null,
      });
      if (error) throw error;
      return data as ReportResult[Name];
    },
    /** Imports a batch of rows of the import wizard (public.import_batch) */
    async importBatch(
      kind: ImportMode,
      rows: BatchRow[],
    ): Promise<ImportBatchResult> {
      const { data, error } = await getSupabaseClient().rpc("import_batch", {
        kind,
        rows,
      });
      if (error) throw error;
      return data as ImportBatchResult;
    },
    async getIntegrationStatus(): Promise<IntegrationStatus[]> {
      const { data, error } =
        await getSupabaseClient().rpc("integration_status");
      if (error) throw error;
      return (data ?? []) as IntegrationStatus[];
    },
    /** The clinic asks for a MIS connector */
    async requestIntegration(kind: IntegrationKind): Promise<void> {
      const { error } = await getSupabaseClient().rpc("request_integration", {
        integration_kind: kind,
      });
      if (error) throw error;
    },
    // --- notifications (stage 16) ---
    async getNotificationPreferences(): Promise<NotificationPreferences> {
      const { data, error } = await getSupabaseClient().rpc(
        "get_notification_preferences",
      );
      if (error) throw error;
      return data as NotificationPreferences;
    },
    async saveNotificationPreferences(
      preferences: Pick<
        NotificationPreferences,
        "kinds" | "browser_enabled" | "telegram_enabled"
      >,
    ): Promise<NotificationPreferences> {
      const { data, error } = await getSupabaseClient().rpc(
        "save_notification_preferences",
        {
          kinds: preferences.kinds,
          browser_enabled: preferences.browser_enabled,
          telegram_enabled: preferences.telegram_enabled,
        },
      );
      if (error) throw error;
      return data as NotificationPreferences;
    },
    /** «Подключить Telegram»: a one-time code for t.me/<bot>?start=<code> */
    async createTelegramLinkCode(): Promise<string> {
      const { data, error } = await getSupabaseClient().rpc(
        "create_telegram_link_code",
      );
      if (error) throw error;
      return data as string;
    },
    async unlinkTelegram(): Promise<void> {
      const { error } = await getSupabaseClient().rpc("unlink_telegram");
      if (error) throw error;
    },
    async markAllNotificationsRead(): Promise<number> {
      const { data, error } = await getSupabaseClient().rpc(
        "mark_all_notifications_read",
      );
      if (error) throw error;
      return data as number;
    },
    // One configuration row per organization; RLS returns the current one
    async getConfiguration(): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.getList("configuration", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
        filter: {},
      });
      return (data[0]?.config as ConfigurationContextValue) ?? {};
    },
    async updateConfiguration(
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> {
      const { data: rows } = await baseDataProvider.getList("configuration", {
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
        filter: {},
      });
      const current = rows[0];
      if (!current) {
        throw new Error("No configuration for the current organization");
      }
      const { data } = await baseDataProvider.update("configuration", {
        id: current.id,
        data: { config },
        previousData: current,
      });
      return data.config as ConfigurationContextValue;
    },
  } satisfies DataProvider;
};

export type CrmDataProvider = ReturnType<
  typeof getDataProviderWithCustomMethods
>;

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
    return logo.src;
  }
  return logo?.src ?? "";
};

const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "configuration",
    beforeUpdate: async (params) => {
      const config = params.data.config;
      if (config) {
        config.lightModeLogo = await processConfigLogo(config.lightModeLogo);
        config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
      }
      return params;
    },
  },
  {
    resource: "patient_notes",
    beforeSave: async (data: PatientNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "deal_notes",
    beforeSave: async (data: DealNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "sales",
    beforeGetList: async (params) =>
      applySearch(["first_name", "last_name"])(params),
    beforeSave: async (data: Sale, _, __) => {
      if (data.avatar) {
        await uploadToBucket(data.avatar);
      }
      return data;
    },
  },
  {
    resource: "patients",
    beforeGetList: async (params) =>
      applySearch(
        ["last_name", "first_name", "middle_name"],
        "phone_fts",
      )(params),
    // The view's computed columns cannot be written
    beforeUpdate: async (params) => ({
      ...params,
      data: withoutKeys(params.data, PATIENT_VIEW_COLUMNS),
    }),
  },
  {
    resource: "audit_log",
    beforeGetList: async (params) =>
      applySearch(["search_text"], "search_text")(params),
  },
  {
    resource: "deals",
    beforeGetList: async (params) =>
      applySearch(["search_text"], "search_text")(params),
    beforeUpdate: async (params) => ({
      ...params,
      data: withoutKeys(params.data, DEAL_VIEW_COLUMNS),
    }),
  },
];

const PATIENT_VIEW_COLUMNS = [
  "phone_fts",
  "phones",
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
  "paid_amount",
  "created_at",
  "updated_at",
  "stage_changed_at",
  "closed_at",
  "first_response_at",
  "nb_unread_messages",
  "last_message_at",
  "last_message_text",
  "doctor_name",
  "prepayment_amount",
  "last_activity_at",
  "next_task_text",
];

const withoutKeys = <T extends Record<string, any>>(data: T, keys: string[]) =>
  Object.fromEntries(
    Object.entries(data).filter(([key]) => !keys.includes(key)),
  ) as T;

export const getDataProvider = () => {
  if (import.meta.env.VITE_SUPABASE_URL === undefined) {
    throw new Error("Please set the VITE_SUPABASE_URL environment variable");
  }
  if (import.meta.env.VITE_SB_PUBLISHABLE_KEY === undefined) {
    throw new Error(
      "Please set the VITE_SB_PUBLISHABLE_KEY environment variable",
    );
  }
  return withLifecycleCallbacks(
    getDataProviderWithCustomMethods(),
    lifeCycleCallbacks,
  ) as CrmDataProvider;
};

const uploadToBucket = async (fi: RAFile) => {
  if (!fi.src.startsWith("blob:") && !fi.src.startsWith("data:")) {
    // Sign URL check if path exists in the bucket
    if (fi.path) {
      const { error } = await getSupabaseClient()
        .storage.from(ATTACHMENTS_BUCKET)
        .createSignedUrl(fi.path, 60);

      if (!error) {
        return fi;
      }
    }
  }

  const dataContent = fi.src
    ? await fetch(fi.src)
        .then((res) => {
          if (res.status !== 200) {
            return null;
          }
          return res.blob();
        })
        .catch(() => null)
    : fi.rawFile;

  if (dataContent == null) {
    // We weren't able to download the file from its src (e.g. user must be signed in on another website to access it)
    // or the file has no content (not probable)
    // In that case, just return it as is: when trying to download it, users should be redirected to the other website
    // and see they need to be signed in. It will then be their responsibility to upload the file back to the note.
    return fi;
  }

  const file = fi.rawFile;
  const fileParts = file.name.split(".");
  const fileExt = fileParts.length > 1 ? `.${file.name.split(".").pop()}` : "";
  const fileName = `${Math.random()}${fileExt}`;
  // Storage policies only allow files under the organization folder
  const filePath = `${await getCurrentOrganizationId()}/${fileName}`;
  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(filePath, dataContent);

  if (uploadError) {
    console.error("uploadError", uploadError);
    throw new Error("Failed to upload attachment");
  }

  const { data } = getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .getPublicUrl(filePath);

  fi.path = filePath;
  fi.src = data.publicUrl;

  // save MIME type
  const mimeType = file.type;
  fi.type = mimeType;

  return fi;
};

/** Error code of an edge function turned into a translatable message */
const functionErrorMessage = async (
  error: any,
  fallback: string,
  namespace = "crm.errors",
) => {
  try {
    const body = await error?.context?.json();
    if (body?.code === "automessage_closed")
      return "automessages.errors.closed";
    if (body?.code === "invalid_file" || body?.code === "file_not_found")
      return `files.errors.${body.code}`;
    if (body?.code) return `${namespace}.${body.code}`;
  } catch {
    // not a JSON body
  }
  return fallback;
};
