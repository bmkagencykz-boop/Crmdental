import type { Identifier } from "ra-core";

import type { TaskType } from "../types";

/** Step types of a scenario (supabase/schemas/26_salesbot.sql) */
export const STEP_TYPES = [
  "send_message",
  "wait_reply",
  "condition",
  "set",
  "create_task",
  "handoff",
  "webhook",
  "delay",
  "stop",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const REPLY_MATCHES = ["keywords", "option", "regex", "any"] as const;
export const DEAL_MATCHES = ["stage", "tag", "source", "field"] as const;
export type BranchMatch =
  | (typeof REPLY_MATCHES)[number]
  | (typeof DEAL_MATCHES)[number];

/** A branch of a condition, tried in order */
export type Branch = {
  match: BranchMatch;
  /** keywords (comma separated), option number, regex, field value */
  value?: string | null;
  stage_id?: Identifier | null;
  tag_id?: Identifier | null;
  source_id?: Identifier | null;
  field_id?: Identifier | null;
  next: string | null;
  /** Portable form (export / templates): names instead of ids */
  stage_name?: string | null;
  tag_name?: string | null;
  source_name?: string | null;
  field_name?: string | null;
};

export const SET_KINDS = [
  "stage",
  "responsible",
  "tag_add",
  "tag_remove",
  "field",
  "deal_field",
  "patient_field",
] as const;
export type SetKind = (typeof SET_KINDS)[number];
export const DEAL_FIELDS = [
  "service_id",
  "doctor_id",
  "source_id",
  "plan_amount",
  "name",
] as const;
export const PATIENT_FIELDS = [
  "first_name",
  "last_name",
  "middle_name",
  "city",
] as const;

/** An action of a «set» step */
export type SetAction = {
  kind: SetKind;
  stage_id?: Identifier | null;
  /** responsible: null = the next one of the round robin */
  sales_id?: Identifier | null;
  tag_id?: Identifier | null;
  field_id?: Identifier | null;
  /** deal_field / patient_field */
  field?: string | null;
  /** May contain {ответ}; deal_field ids as text */
  value?: string | null;
  stage_name?: string | null;
  tag_name?: string | null;
  field_name?: string | null;
  /** deal_field service_id / doctor_id / source_id by name */
  value_name?: string | null;
};

export type Step = {
  id: string;
  type: StepType;
  next?: string | null;
  // send_message
  text?: string | null;
  template_id?: Identifier | null;
  template_name?: string | null;
  buttons?: string[];
  // wait_reply
  timeout_minutes?: number;
  timeout_next?: string | null;
  // condition
  branches?: Branch[];
  else_next?: string | null;
  // set
  actions?: SetAction[];
  // create_task
  task_type?: TaskType;
  due_minutes?: number;
  // handoff
  create_task?: boolean;
  task_text?: string | null;
  // webhook
  webhook_id?: Identifier | null;
  webhook_name?: string | null;
  // delay
  minutes?: number;
};

export type Scenario = { start: string | null; steps: Step[] };

export const TRANSPORTS = [
  "whatsapp",
  "instagram",
  "telegram",
  "telegram_bot",
] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** A bot (public.salesbots) */
export type Salesbot = {
  id: Identifier;
  name: string;
  description?: string | null;
  is_active: boolean;
  scenario: Scenario;
  version: number;
  trigger_new_lead: boolean;
  trigger_transports: Transport[];
  trigger_source_ids: Identifier[];
  trigger_keywords: string[];
  position: number;
  created_by?: Identifier | null;
  created_at: string;
  updated_at: string;
};

export type SessionStatus =
  | "running"
  | "waiting"
  | "done"
  | "handed_off"
  | "stopped"
  | "failed";
export type SessionTrigger = "new_lead" | "keyword" | "pipeline" | "manual";

export type SessionState = {
  wait?: "reply" | "delay";
  buttons?: string[];
  replies?: string[];
  last_send_at?: string;
};

/** A conversation of a bot on a deal (public.salesbot_sessions) */
export type SalesbotSession = {
  id: Identifier;
  deal_id: Identifier;
  bot_id?: Identifier | null;
  bot_name: string;
  bot_version: number;
  scenario: Scenario;
  current_step: string | null;
  state: SessionState;
  status: SessionStatus;
  wait_until: string | null;
  last_reply: string | null;
  messages_sent: number;
  trigger: SessionTrigger;
  started_by?: Identifier | null;
  stopped_reason?: string | null;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
};

export type LogKind =
  | "started"
  | "sent"
  | "waiting"
  | "reply"
  | "timeout"
  | "branch"
  | "set"
  | "task"
  | "handoff"
  | "webhook"
  | "delay"
  | "moved"
  | "skipped"
  | "failed"
  | "done"
  | "stopped";

/** What the bot did (public.salesbot_logs) */
export type SalesbotLog = {
  id: Identifier;
  session_id: Identifier;
  deal_id: Identifier;
  step_id?: string | null;
  step_type?: StepType | null;
  kind: LogKind;
  text?: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export const ACTIVE_STATUSES: SessionStatus[] = ["running", "waiting"];
