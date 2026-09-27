import type {
  AuditLogEntry,
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
} from "../../../types";
import type { ConfigurationContextValue } from "../../../root/ConfigurationContext";

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
  organization_settings: Array<OrganizationSettings & { id: number }>;
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
  audit_log: AuditLogEntry[];
}
