import type {
  Call,
  Deal,
  DealEvent,
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
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";
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
  organization_settings: Array<OrganizationSettings & { id: number }>;
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
  // Repeat sales and mailings (stage 17)
  recall_rules: RecallRule[];
  recalls: Recall[];
  mailings: Mailing[];
  mailing_messages: MailingMessage[];
  mailing_settings: Array<MailingSettings & { id: number }>;
}
