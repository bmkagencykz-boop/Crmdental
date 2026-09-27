import type {
  Call,
  Deal,
  DealEvent,
  DealNote,
  DealPayment,
  LeadSource,
  LostReason,
  OrganizationSettings,
  Patient,
  PatientNote,
  Pipeline,
  Sale,
  Service,
  Stage,
  Tag,
  Task,
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
  organization_settings: Array<OrganizationSettings & { id: number }>;
  configuration: Array<{ id: number; config: ConfigurationContextValue }>;
}
