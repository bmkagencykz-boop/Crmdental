import type { Identifier, RaRecord } from "ra-core";
import type { ComponentType } from "react";

import type {
  PATIENT_CREATED,
  PATIENT_NOTE_CREATED,
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
} from "./consts";

export type SignUpData = {
  organization_name: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
};

export type SalesFormData = {
  avatar?: string;
  email: string;
  secondary_emails?: string[];
  password?: string;
  first_name: string;
  last_name: string;
  role: AssignableSaleRole;
  disabled: boolean;
  phone_extension?: string | null;
};

/**
 * owner: the person who signed the clinic up (everything, billing, staff)
 * head: reports, settings, all deals
 * manager: day-to-day work (administrators and curators of the clinic)
 */
export type SaleRole = "owner" | "head" | "manager";
export type AssignableSaleRole = Exclude<SaleRole, "owner">;

export type Sale = {
  organization_id: Identifier;
  first_name: string;
  last_name: string;
  role: SaleRole;
  /** Derived from the role (owner or head), read-only */
  administrator: boolean;
  avatar?: RAFile;
  disabled?: boolean;
  user_id: string;

  /**
   * This is a copy of the user's email, to make it easier to handle by react admin
   * DO NOT UPDATE this field directly, it should be updated by the backend
   */
  email: string;

  secondary_emails?: string[];

  /** Internal number in the clinic's PBX: maps calls to the employee */
  phone_extension?: string | null;

  /**
   * This is used by the fake rest provider to store the password
   * DO NOT USE this field in your code besides the fake rest provider
   * @deprecated
   */
  password?: string;
} & Pick<RaRecord, "id">;

export type PhoneNumberAndType = {
  number: string;
  type?: string;
};

export type Patient = {
  organization_id?: Identifier;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  phone_jsonb: PhoneNumberAndType[];
  /** Normalized numbers (+7XXXXXXXXXX), maintained by the database */
  phones?: string[];
  birth_date?: string | null;
  city?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  telegram?: string | null;
  /** Source of the first request */
  source_id?: Identifier | null;
  tags: number[];
  sales_id?: Identifier | null;
  gender?: string | null;
  avatar?: Partial<RAFile>;
  background?: string | null;
  status?: string | null;
  first_seen: string;
  last_seen: string;
  /** No mailings nor recall messages (stage 17) */
  messaging_opt_out?: boolean;
  messaging_opt_out_at?: string | null;
  // patients_summary
  nb_deals?: number;
  nb_open_deals?: number;
  nb_tasks?: number;
} & Pick<RaRecord, "id">;

export type PatientNote = {
  patient_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  status: string;
  attachments?: AttachmentNote[];
} & Pick<RaRecord, "id">;

export type StageKind = "open" | "won" | "lost";

export type Pipeline = {
  name: string;
  position: number;
  is_default: boolean;
} & Pick<RaRecord, "id">;

export type Stage = {
  pipeline_id: Identifier;
  name: string;
  position: number;
  color: string;
  kind: StageKind;
  /** What the employee says at this stage (shown on the deal page) */
  script?: string | null;
} & Pick<RaRecord, "id">;

/** A clinic dictionary entry: services, lost reasons */
export type DictionaryItem = {
  name: string;
  position: number;
  is_archived: boolean;
} & Pick<RaRecord, "id">;

export type Service = DictionaryItem;
export type LostReason = DictionaryItem;
export type LeadSource = DictionaryItem & {
  /** whatsapp, instagram, telegram, call, website, 2gis, referral, other */
  code?: string | null;
  is_system: boolean;
};

/**
 * A doctor of the clinic (stage 13): a dictionary entry, not a CRM user. An
 * inactive doctor is hidden from the pickers and stays on the old deals.
 */
export type Doctor = {
  name: string;
  specialty?: string | null;
  is_active: boolean;
  position: number;
} & Pick<RaRecord, "id">;

export type Deal = {
  organization_id?: Identifier;
  patient_id: Identifier;
  pipeline_id: Identifier;
  stage_id: Identifier;
  name?: string | null;
  source_id?: Identifier | null;
  service_id?: Identifier | null;
  /** Treatment plan, tenge */
  plan_amount: number;
  /** Sum of the payments, maintained by the database */
  paid_amount: number;
  sales_id?: Identifier | null;
  lost_reason_id?: Identifier | null;
  lost_comment?: string | null;
  appointment_at?: string | null;
  visit_at?: string | null;
  tags: number[];
  description?: string | null;
  index: number;
  created_at: string;
  updated_at: string;
  stage_changed_at?: string;
  closed_at?: string | null;
  first_response_at?: string | null;
  archived_at?: string | null;
  doctor_id?: Identifier | null;
  /** Price of the consultation, tenge */
  consultation_amount?: number | null;
  // deals_summary
  stage_kind?: StageKind;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_phone?: string | null;
  nb_open_tasks?: number;
  next_task_due_at?: string | null;
  nb_unread_messages?: number;
  last_message_at?: string | null;
  last_message_text?: string | null;
  doctor_name?: string | null;
  /** Sum of the prepayment-kind payments */
  prepayment_amount?: number;
} & Pick<RaRecord, "id">;

/** telegram_bot: the clinic's own Telegram bot, next to Wazzup24's Telegram */
export type MessengerTransport =
  | "whatsapp"
  | "instagram"
  | "telegram"
  | "telegram_bot";

/** A message of a deal, received or sent through Wazzup24 */
export type Message = {
  organization_id?: Identifier;
  patient_id: Identifier;
  deal_id: Identifier;
  channel_id?: Identifier | null;
  transport: MessengerTransport;
  chat_id: string;
  direction: "in" | "out";
  sales_id?: Identifier | null;
  text?: string | null;
  content_uri?: string | null;
  content_type: string;
  status: "inbound" | "sent" | "delivered" | "read" | "error";
  error?: string | null;
  external_id?: string | null;
  sent_at: string;
  read_at?: string | null;
  /** Sent by an automatic message rule */
  automessage_id?: Identifier | null;
} & Pick<RaRecord, "id">;

export type MessengerChannel = {
  external_id: string;
  transport: MessengerTransport;
  name?: string | null;
  state?: string | null;
} & Pick<RaRecord, "id">;

export type MessengerStatus = {
  connected: boolean;
  connected_at: string | null;
  last_error: string | null;
};

/** The clinic's own Telegram bot (public.telegram_bot_status) */
export type TelegramBotStatus = {
  connected: boolean;
  username: string | null;
  name: string | null;
  connected_at: string | null;
  last_error: string | null;
};

/** Address of the clinic's lead webhook (website, Tilda, 2GIS) */
export type LeadWebhook = {
  token: string;
  url: string;
};

export type DealPaymentKind = "prepayment" | "payment";

export type DealPayment = {
  deal_id: Identifier;
  amount: number;
  /** A prepayment or a regular payment (default) */
  kind?: DealPaymentKind;
  paid_at: string;
  comment?: string | null;
  sales_id?: Identifier | null;
  created_at: string;
} & Pick<RaRecord, "id">;

export type DealEvent = {
  deal_id: Identifier;
  type: "created" | "stage_changed" | "updated";
  from_stage_id?: Identifier | null;
  to_stage_id?: Identifier | null;
  /** { field: [old, new] } */
  changes: Record<string, [unknown, unknown]>;
  sales_id?: Identifier | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/** A row of the audit log (public.audit_log_summary), stage 15 */
export type AuditLogEntry = {
  at: string;
  /** null: done by the system (see source) */
  sales_id?: Identifier | null;
  /** user, automation, webhook, system, import... */
  source: string;
  entity: string;
  entity_id?: Identifier | null;
  action: string;
  /** { field: [before, after] }, changed fields only */
  changes: Record<string, [unknown, unknown]>;
  deal_id?: Identifier | null;
  patient_id?: Identifier | null;
  deal_name?: string | null;
  patient_name?: string | null;
  search_text?: string | null;
} & Pick<RaRecord, "id">;

export type Call = {
  patient_id: Identifier;
  deal_id?: Identifier | null;
  direction: "in" | "out";
  duration_seconds: number;
  comment?: string | null;
  called_at: string;
  sales_id?: Identifier | null;
  /** Telephony: null for calls logged by hand */
  provider?: TelephonyProvider | null;
  status?: CallStatus;
  /** Provider call id */
  external_id?: string | null;
  recording_url?: string | null;
  /** Patient's number and employee's internal number as the PBX sent them */
  phone?: string | null;
  extension?: string | null;
} & Pick<RaRecord, "id">;

export type CallStatus = "in_progress" | "answered" | "missed";

export type TelephonyProvider = "binotel" | "zadarma" | "mango" | "generic";

/** Telephony connection of the clinic (owner and head; secrets stay hidden) */
export type TelephonyStatus = {
  provider: TelephonyProvider;
  webhook_token: string;
  /** Address to paste in the PBX */
  webhook_url: string;
  has_secret: boolean;
  has_api_key: boolean;
  created_at: string;
  last_event_at: string | null;
};

export type OrganizationSettings = {
  organization_id: Identifier;
  manager_deal_visibility: "all" | "own" | "own_and_unassigned";
  pipeline_move_mode: "first_stage" | "choose_stage";
  lead_distribution: "off" | "round_robin" | "first_response";
  lead_distribution_sales_ids: Identifier[];
  last_distributed_sales_id?: Identifier | null;
  /** Response-time control (stage 16) */
  response_control_enabled: boolean;
  response_limit_minutes: number;
  /** Working hours of the clinic: from hours_start:00 to hours_end:00 */
  response_hours_start: number;
  response_hours_end: number;
  response_alert_responsible: boolean;
  response_alert_managers: boolean;
  response_alert_sales_ids: Identifier[];
};

/** A task created on its own when a deal is created or enters a stage */
export type TaskRule = {
  event: "deal_created" | "stage_entered";
  stage_id?: Identifier | null;
  type: TaskType;
  text: string;
  due_in_minutes: number;
  is_active: boolean;
  position: number;
} & Pick<RaRecord, "id">;

/** Text of the clinic with {имя}, {услуга}, {дата_визита}, {клиника} */
export type MessageTemplate = {
  name: string;
  body: string;
  position: number;
} & Pick<RaRecord, "id">;

/** Stage X -> template Y, after entering the stage or before the visit */
export type AutomessageRule = {
  stage_id: Identifier;
  template_id: Identifier;
  timing: "after_stage" | "before_visit";
  offset_minutes: number;
  /** auto: sent on its own; confirm: a task shows it to the employee first */
  mode: "auto" | "confirm";
  is_active: boolean;
  position: number;
} & Pick<RaRecord, "id">;

export type AutomessageStatus =
  | "pending"
  | "sending"
  | "awaiting"
  | "sent"
  | "cancelled"
  | "failed";

/** A queued automatic message of a deal */
export type Automessage = {
  deal_id: Identifier;
  rule_id?: Identifier | null;
  stage_id: Identifier;
  timing: AutomessageRule["timing"];
  send_at: string;
  status: AutomessageStatus;
  text?: string | null;
  error?: string | null;
  processed_at?: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

/**
 * A ready answer of the chat (typed after "/"). sales_id null: the whole
 * clinic (owner and head edit it); else the personal reply of this employee.
 */
export type QuickReply = {
  organization_id?: Identifier;
  title: string;
  text: string;
  shortcut?: string | null;
  sales_id?: Identifier | null;
  position: number;
  created_at?: string;
} & Pick<RaRecord, "id">;

export type StageChecklistItem = {
  stage_id: Identifier;
  text: string;
  position: number;
} & Pick<RaRecord, "id">;

export type DealChecklistCheck = {
  deal_id: Identifier;
  item_id: Identifier;
  sales_id?: Identifier | null;
  checked_at: string;
} & Pick<RaRecord, "id">;

export type DealNote = {
  deal_id: Identifier;
  text: string;
  date: string;
  sales_id: Identifier;
  attachments?: AttachmentNote[];

  // This is defined for compatibility with `PatientNote`
  status?: undefined;
} & Pick<RaRecord, "id">;

export type Tag = {
  id: number;
  name: string;
  color: string;
};

export type TaskType = "call" | "message" | "reminder" | "other";

export type Task = {
  deal_id: Identifier;
  type: TaskType;
  text: string;
  due_date: string;
  done_date?: string | null;
  sales_id?: Identifier;
  created_at?: string;
  /** "Show to the employee first" automatic message: the task sends it */
  automessage_id?: Identifier | null;
} & Pick<RaRecord, "id">;

export type ActivityPatientCreated = {
  type: typeof PATIENT_CREATED;
  patient_id: Identifier;
  sales_id?: Identifier;
  patient: Patient;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityPatientNoteCreated = {
  type: typeof PATIENT_NOTE_CREATED;
  sales_id?: Identifier;
  patientNote: PatientNote;
  date: string;
} & Pick<RaRecord, "id">;

export type ActivityDealCreated = {
  type: typeof DEAL_CREATED;
  patient_id: Identifier;
  sales_id?: Identifier;
  deal: Deal;
  date: string;
};

export type ActivityDealNoteCreated = {
  type: typeof DEAL_NOTE_CREATED;
  sales_id?: Identifier;
  dealNote: DealNote;
  date: string;
};

export type Activity = RaRecord &
  (
    | ActivityPatientCreated
    | ActivityPatientNoteCreated
    | ActivityDealCreated
    | ActivityDealNoteCreated
  );

export interface RAFile {
  src: string;
  title: string;
  path?: string;
  rawFile: File;
  type?: string;
}

export type AttachmentNote = RAFile;

export interface LabeledValue {
  value: string;
  label: string;
}

export interface NoteStatus extends LabeledValue {
  color: string;
}

export interface PatientGender {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/** What public.import_batch did with a batch of rows */
export type ImportBatchResult = {
  created: number;
  updated: number;
  skipped: number;
  patients_created: number;
  patients_updated: number;
  deals_created: number;
  deals_updated: number;
  /** index: line of the file */
  errors: Array<{ index: number; message: string }>;
};

/** MIS connectors (public.integrations; their settings are not exposed) */
export type IntegrationKind =
  | "ident"
  | "dentalpro"
  | "medelement"
  | "1c_medicine"
  | "other";

export type IntegrationStatus = {
  kind: IntegrationKind;
  status: "requested" | "connected" | "error" | "disabled";
  last_sync_at: string | null;
  last_error: string | null;
};

/** One entry of public.external_refs */
export type ExternalRef = {
  entity: "patient" | "deal" | "sales" | "service";
  entity_id: Identifier;
  system: string;
  external_id: string;
  created_at?: string;
};
/** Employee notifications (stage 16) */
export type NotificationKind =
  | "lead_assigned"
  | "patient_message"
  | "task_overdue"
  | "response_overdue";

export type CrmNotification = {
  organization_id?: Identifier;
  /** The recipient */
  sales_id: Identifier;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  deal_id?: Identifier | null;
  patient_id?: Identifier | null;
  task_id?: Identifier | null;
  /** patient_message: messages coalesced in this notification */
  message_count: number;
  created_at: string;
  updated_at: string;
  read_at?: string | null;
} & Pick<RaRecord, "id">;

/** What an employee receives in the browser and in Telegram */
export type NotificationPreferences = {
  kinds: NotificationKind[];
  browser_enabled: boolean;
  telegram_enabled: boolean;
  telegram_linked: boolean;
  telegram_username?: string | null;
  /** Active link code, for t.me/<bot>?start=<code> */
  telegram_link_code?: string | null;
  telegram_link_expires_at?: string | null;
};

/** An open deal whose patient waits for an answer (view deals_waiting) */
export type DealWaiting = {
  organization_id?: Identifier;
  patient_id: Identifier;
  pipeline_id: Identifier;
  stage_id: Identifier;
  sales_id?: Identifier | null;
  name?: string | null;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_phone?: string | null;
  waiting_since: string;
  /** Working minutes waited */
  waiting_minutes: number;
  limit_minutes: number;
  overdue: boolean;
} & Pick<RaRecord, "id">;
