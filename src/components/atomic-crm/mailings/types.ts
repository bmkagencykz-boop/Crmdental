import type { Identifier, RaRecord } from "ra-core";

/**
 * Repeat sales and segment mailings (stage 17). Same shapes as the tables of
 * supabase/schemas/17_repeat_mailings.sql.
 */

export type RecallRule = {
  organization_id?: Identifier;
  name: string;
  /** Won deals of this service trigger the rule; null: any won deal */
  service_id: Identifier | null;
  delay_months: number;
  pipeline_id: Identifier;
  stage_id: Identifier;
  /** Service of the new deal; null: the service of the won deal */
  deal_service_id: Identifier | null;
  /** Message to the patient; null: no message */
  template_id: Identifier | null;
  message_mode: "auto" | "confirm";
  is_active: boolean;
  position: number;
  created_at?: string;
} & Pick<RaRecord, "id">;

export type RecallStatus = "created" | "skipped" | "cancelled";

export type Recall = {
  rule_id: Identifier | null;
  /** The won deal */
  deal_id: Identifier;
  patient_id: Identifier;
  due_at: string;
  status: RecallStatus;
  recall_deal_id: Identifier | null;
  reason: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

export type MailingSettings = {
  per_minute: number;
  per_day: number;
  /** "09:00" (the database returns "09:00:00") */
  work_start: string;
  work_end: string;
};

/** Filters of a segment, combined with AND; empty ones do not filter */
export type MailingSegment = {
  tag_ids?: Identifier[];
  tag_mode?: "any" | "all";
  service_ids?: Identifier[];
  /** «давно не был»: the last visit or won deal is older than N months */
  inactive_months?: number | null;
  source_ids?: Identifier[];
  has_open_deal?: boolean | null;
  sales_ids?: Identifier[];
};

export type MailingStatus = "scheduled" | "paused" | "cancelled" | "done";

export type Mailing = {
  organization_id?: Identifier;
  name: string;
  segment: MailingSegment;
  template_id: Identifier | null;
  body: string;
  scheduled_at: string;
  status: MailingStatus;
  recipients_count: number;
  created_by: Identifier | null;
  created_at: string;
  finished_at: string | null;
} & Pick<RaRecord, "id">;

/** mailings_summary: a mailing with its progress */
export type MailingSummary = Mailing & {
  queued_count: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  skipped_count: number;
  cancelled_count: number;
};

export type MailingMessageStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled";

export type MailingMessage = {
  organization_id?: Identifier;
  mailing_id: Identifier | null;
  recall_id: Identifier | null;
  patient_id: Identifier;
  deal_id: Identifier | null;
  body: string;
  send_at: string;
  status: MailingMessageStatus;
  text: string | null;
  error: string | null;
  message_id: Identifier | null;
  external_id?: string | null;
  delivery_status?: string | null;
  claimed_at: string | null;
  processed_at: string | null;
  created_at: string;
} & Pick<RaRecord, "id">;

export type SegmentPatientStatus =
  | "ok"
  | "opted_out"
  | "no_contact"
  | "duplicate";

/** public.mailing_segment_preview */
export type SegmentPreview = {
  count: number;
  matched: number;
  opted_out: number;
  no_contact: number;
  duplicates: number;
  patients: {
    id: Identifier;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
  }[];
};

/** public.report_recalls */
export type RecallReport = {
  upcoming: {
    rule_id: Identifier;
    rule_name: string;
    deal_id: Identifier;
    deal_name: string | null;
    patient_id: Identifier;
    patient_name: string;
    due_at: string;
    opted_out: boolean;
  }[];
  recalls: {
    id: Identifier;
    rule_name: string | null;
    patient_id: Identifier;
    patient_name: string;
    due_at: string;
    created_at: string;
    status: RecallStatus;
    reason: string | null;
    recall_deal_id: Identifier | null;
    recall_deal_name: string | null;
    recall_deal_kind: "open" | "won" | "lost" | null;
  }[];
  totals: {
    created: number;
    skipped: number;
    cancelled: number;
    open: number;
    won: number;
    lost: number;
    upcoming: number;
  };
};
