import type { Identifier } from "ra-core";

import type { TaskType } from "../types";

/** When a trigger of the digital pipeline runs (stage 20) */
export type StageTriggerEvent =
  | "stage_entered"
  | "message_in"
  | "message_out"
  | "call_missed"
  | "idle"
  | "payment_added"
  | "appointment_set"
  | "visit_passed";

export type StageTriggerAction =
  | "move_stage"
  | "set_responsible"
  | "add_tag"
  | "remove_tag"
  | "create_task"
  | "send_template"
  | "send_webhook"
  | "set_field"
  | "start_salesbot";

export type StageTriggerField = "plan_amount" | "doctor_id" | "service_id";

/** A trigger: stage + event (+ conditions) → action (public.stage_triggers) */
export type StageTrigger = {
  id: Identifier;
  pipeline_id?: Identifier;
  stage_id: Identifier;
  name?: string | null;
  event: StageTriggerEvent;
  /** idle: minutes without activity; visit_passed: minutes after the visit */
  delay_minutes: number;
  source_ids: Identifier[];
  service_ids: Identifier[];
  doctor_ids: Identifier[];
  /** Responsible */
  sales_ids: Identifier[];
  tags_present: Identifier[];
  tags_absent: Identifier[];
  action: StageTriggerAction;
  target_stage_id?: Identifier | null;
  /** set_responsible: null = the next one of the round robin */
  target_sales_id?: Identifier | null;
  tag_id?: Identifier | null;
  task_type?: TaskType | null;
  task_text?: string | null;
  task_due_minutes?: number | null;
  template_id?: Identifier | null;
  message_mode?: "auto" | "confirm" | null;
  webhook_id?: Identifier | null;
  field_name?: StageTriggerField | null;
  plan_amount?: number | null;
  doctor_id?: Identifier | null;
  service_id?: Identifier | null;
  /** start_salesbot (stage 26) */
  salesbot_id?: Identifier | null;
  is_active: boolean;
  position: number;
  created_at?: string;
};

/** What a trigger did to a deal (public.stage_trigger_runs), deal feed */
export type StageTriggerRun = {
  id: Identifier;
  deal_id: Identifier;
  trigger_id?: Identifier | null;
  trigger_name?: string | null;
  event: StageTriggerEvent;
  event_key: string;
  action: StageTriggerAction;
  status: "done" | "skipped" | "failed";
  details: {
    from_stage_id?: Identifier;
    to_stage_id?: Identifier;
    from_sales_id?: Identifier | null;
    to_sales_id?: Identifier;
    tag_id?: Identifier;
    task_id?: Identifier;
    automessage_id?: Identifier;
    template_id?: Identifier;
    mode?: "auto" | "confirm";
    webhook_id?: Identifier;
    field?: StageTriggerField;
    from?: unknown;
    to?: unknown;
    unchanged?: boolean;
    salesbot_id?: Identifier;
    session_id?: Identifier;
  };
  error?: string | null;
  created_at: string;
};

export const WEBHOOK_EVENTS = [
  "deal.created",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "patient.created",
  "message.received",
  "payment.added",
  "task.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** An outgoing webhook of the clinic (owner and head) */
export type Webhook = {
  id: Identifier;
  name?: string | null;
  url: string;
  events: WebhookEvent[];
  secret: string;
  is_active: boolean;
  failure_count: number;
  last_error?: string | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  /** Switched off by the dispatcher after too many failures */
  disabled_at?: string | null;
  created_at: string;
};

export type WebhookDeliveryStatus =
  | "pending"
  | "sending"
  | "delivered"
  | "failed"
  | "cancelled";

export type WebhookDelivery = {
  id: Identifier;
  webhook_id: Identifier;
  /** A webhook event, 'automation' (stage trigger) or 'ping' (test) */
  event: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  next_attempt_at: string;
  response_status?: number | null;
  error?: string | null;
  delivered_at?: string | null;
  created_at: string;
};

export type ApiKeyScope = "read" | "write";

/** An API key as listed (the key itself is shown once, never stored) */
export type ApiKey = {
  id: Identifier;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  created_by?: Identifier | null;
  created_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
};

/** public.create_api_key: the key, once */
export type CreatedApiKey = ApiKey & { key: string };
