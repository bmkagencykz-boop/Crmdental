import type { AdSpend } from "../../../marketing/types";
import type { Branch, SalesBranch } from "../../../branches/branches";
import type { Identifier } from "ra-core";
import type {
  PriceHistoryRow,
  ServiceCategory,
  ServiceCost,
} from "../../../price-list/types";
import type { AccountOperation, CashShift } from "../../../payments/types";
import type {
  ConsentTemplate,
  PatientConsent,
  PatientFile,
  PatientQuestionnaire,
  PatientTooth,
  ToothHistoryRow,
  VisitRecord,
  VisitRecordTemplate,
} from "../../../patient-card/types";
import type { DeveloperApp } from "../../../integrations/types";
import type { WaitingEntry } from "../../../waiting-list/types";
import type { AccessRightsRow } from "../../../access-rights/accessRights";
import type {
  AuditLogEntry,
  Call,
  Deal,
  DealEvent,
  CustomField,
  Doctor,
  DealNote,
  DealPayment,
  LeadSource,
  DealChecklistCheck,
  LostReason,
  Message,
  MessengerChannel,
  Organization,
  OnboardingProgress,
  OrganizationSettings,
  Patient,
  PatientNote,
  Pipeline,
  Sale,
  Service,
  Stage,
  StageChecklistItem,
  Tag,
  Task,
  TaskRule,
  MessageTemplate,
  AutomessageRule,
  Automessage,
  QuickReply,
  ExternalRef,
  IntegrationStatus,
  CrmNotification,
  DealFile,
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";
import type { SavedFilter } from "../../../deals/list/dealFilters";
import type { SalesPlan } from "../../../reports/salesPlan";
import type {
  Mailing,
  MailingMessage,
  MailingSettings,
  Recall,
  RecallRule,
} from "../../../mailings/types";
import type {
  ApiKey,
  StageTrigger,
  StageTriggerRun,
  Webhook,
  WebhookDelivery,
} from "../../../pipeline-automation/types";
import type {
  MisAppointment,
  MisConnection,
  MisDoctor,
  MisSyncLogEntry,
} from "../../../mis/types";
import type {
  Chair,
  DoctorException,
  ScheduleSettings,
  Visit,
} from "../../../schedule/types";
import type {
  Salesbot,
  SalesbotLog,
  SalesbotSession,
} from "../../../salesbot/types";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
  TreatmentStageTemplate,
  PlanDictionaryItem,
} from "../../../treatment/types";

export interface Db {
  sales: Sale[];
  tags: Tag[];
  pipelines: Pipeline[];
  stages: Stage[];
  services: Service[];
  lead_sources: LeadSource[];
  lost_reasons: LostReason[];
  doctors: Doctor[];
  custom_fields: CustomField[];
  patients: Patient[];
  patient_notes: PatientNote[];
  deals: Deal[];
  deal_notes: DealNote[];
  deal_payments: DealPayment[];
  deal_events: DealEvent[];
  tasks: Task[];
  calls: Call[];
  messages: Message[];
  messenger_channels: MessengerChannel[];
  task_rules: TaskRule[];
  stage_checklist_items: StageChecklistItem[];
  deal_checklist_checks: DealChecklistCheck[];
  message_templates: MessageTemplate[];
  automessage_rules: AutomessageRule[];
  automessages: Automessage[];
  quick_replies: QuickReply[];
  notifications: CrmNotification[];
  organization_settings: Array<OrganizationSettings & { id: number }>;
  /** The demo clinic (its time zone: task calendar) */
  organizations: Organization[];
  external_refs: Array<ExternalRef & { id: number }>;
  integrations: Array<IntegrationStatus & { id: number }>;
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
  audit_log: AuditLogEntry[];
  // Repeat sales and mailings (stage 17)
  recall_rules: RecallRule[];
  recalls: Recall[];
  mailings: Mailing[];
  mailing_messages: MailingMessage[];
  mailing_settings: Array<MailingSettings & { id: number }>;
  // Files of the deals (stage 22)
  deal_files: DealFile[];
  // Deal list and sales plan (stage 21)
  saved_filters: SavedFilter[];
  sales_plans: SalesPlan[];
  // Digital pipeline, webhooks and API keys (stage 20)
  stage_triggers: StageTrigger[];
  stage_trigger_runs: StageTriggerRun[];
  webhooks: Webhook[];
  webhook_deliveries: WebhookDelivery[];
  api_keys: ApiKey[];
  // «Салесбот» (stage 26)
  salesbots: Salesbot[];
  salesbot_sessions: SalesbotSession[];
  salesbot_logs: SalesbotLog[];
  // Setup wizard (stage 24)
  onboarding_progress: Array<OnboardingProgress & { id: number }>;
  // MIS connectors (stage 27)
  mis_connections: MisConnection[];
  mis_doctors: MisDoctor[];
  mis_appointments: MisAppointment[];
  mis_sync_log: MisSyncLogEntry[];
  // Access rights (stage 30): one row per employee with changed rights
  access_rights: Array<AccessRightsRow & { id: Identifier }>;
  // Marketplace: developer apps (stage 25)
  developer_apps: DeveloperApp[];
  // Schedule (stage 28)
  chairs: Chair[];
  doctor_exceptions: DoctorException[];
  schedule_settings: Array<Omit<ScheduleSettings, "mis_kind"> & { id: number }>;
  visits: Visit[];
  // Treatment plans with an estimate (stage 29)
  treatment_plans: TreatmentPlan[];
  treatment_plan_items: TreatmentPlanItem[];
  // The plan editor (stage 34): stages, templates, dictionaries
  treatment_stages: TreatmentStage[];
  treatment_stage_templates: TreatmentStageTemplate[];
  treatment_plan_types: PlanDictionaryItem[];
  treatment_directions: PlanDictionaryItem[];
  // Marketing analytics (stage 32)
  ad_spend: AdSpend[];
  // Branches (stage 33)
  branches: Branch[];
  sales_branches: SalesBranch[];
  // The price list page (stage 35)
  service_categories: ServiceCategory[];
  service_costs: ServiceCost[];
  service_price_history: PriceHistoryRow[];
  // Payments, deposits and the cash desk (stage 36)
  account_operations: AccountOperation[];
  cash_shifts: CashShift[];
  // The full patient card (stage 37)
  patient_teeth: PatientTooth[];
  patient_tooth_history: ToothHistoryRow[];
  visit_records: VisitRecord[];
  visit_record_templates: VisitRecordTemplate[];
  patient_questionnaires: PatientQuestionnaire[];
  consent_templates: ConsentTemplate[];
  patient_consents: PatientConsent[];
  patient_files: PatientFile[];
  // The waiting list (stage 38)
  waiting_list: WaitingEntry[];
}
