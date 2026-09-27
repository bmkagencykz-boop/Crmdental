import type {
  AuditLogEntry,
  Call,
  Deal,
  DealEvent,
  Doctor,
  DealNote,
  DealPayment,
  LeadSource,
  DealChecklistCheck,
  LostReason,
  Message,
  MessengerChannel,
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

export interface Db {
  sales: Sale[];
  tags: Tag[];
  pipelines: Pipeline[];
  stages: Stage[];
  services: Service[];
  lead_sources: LeadSource[];
  lost_reasons: LostReason[];
  doctors: Doctor[];
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
  // Deal list and sales plan (stage 21)
  saved_filters: SavedFilter[];
  sales_plans: SalesPlan[];
}
