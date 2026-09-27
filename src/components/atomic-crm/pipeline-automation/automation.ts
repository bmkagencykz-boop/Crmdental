import type { Identifier } from "ra-core";

import type {
  AutomessageRule,
  Call,
  Deal,
  DealNote,
  Message,
  Stage,
  Task,
  TaskRule,
} from "../types";
import type {
  StageTrigger,
  StageTriggerAction,
  StageTriggerEvent,
  StageTriggerRun,
} from "./types";

/**
 * Digital pipeline (stage 20): the same rules as the database
 * (supabase/schemas/20_digital_pipeline.sql), for the settings grid, the
 * deal feed and the demo data provider.
 */

export const STAGE_TRIGGER_EVENTS: StageTriggerEvent[] = [
  "stage_entered",
  "message_in",
  "message_out",
  "call_missed",
  "payment_added",
  "appointment_set",
  "idle",
  "visit_passed",
];

/** Run by the pg_cron tick, with a delay */
export const DELAYED_EVENTS: StageTriggerEvent[] = ["idle", "visit_passed"];

export const STAGE_TRIGGER_ACTIONS: StageTriggerAction[] = [
  "move_stage",
  "set_responsible",
  "add_tag",
  "remove_tag",
  "create_task",
  "send_template",
  "send_webhook",
  "set_field",
];

/** A chain of automatic actions stops at this depth (crm.automation_depth) */
export const MAX_AUTOMATION_DEPTH = 3;

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const anyOf = (
  ids: Identifier[] | undefined,
  value: Identifier | null | undefined,
) => !ids?.length || ids.some((id) => same(id, value));

/**
 * Conditions of a trigger (private.stage_trigger_matches): every non-empty
 * list must contain the deal's value, the required tags must all be there,
 * the excluded ones none.
 */
export const triggerMatches = (
  trigger: Pick<
    StageTrigger,
    | "source_ids"
    | "service_ids"
    | "doctor_ids"
    | "sales_ids"
    | "tags_present"
    | "tags_absent"
  >,
  deal: Pick<
    Deal,
    "source_id" | "service_id" | "doctor_id" | "sales_id" | "tags"
  >,
) => {
  const tags = deal.tags ?? [];
  return (
    anyOf(trigger.source_ids, deal.source_id) &&
    anyOf(trigger.service_ids, deal.service_id) &&
    anyOf(trigger.doctor_ids, deal.doctor_id) &&
    anyOf(trigger.sales_ids, deal.sales_id) &&
    (trigger.tags_present ?? []).every((tag) =>
      tags.some((t) => same(t, tag)),
    ) &&
    !(trigger.tags_absent ?? []).some((tag) => tags.some((t) => same(t, tag)))
  );
};

export const hasConditions = (trigger: StageTrigger) =>
  [
    trigger.source_ids,
    trigger.service_ids,
    trigger.doctor_ids,
    trigger.sales_ids,
    trigger.tags_present,
    trigger.tags_absent,
  ].some((ids) => ids?.length);

/**
 * What is missing for the database to accept a trigger (its check
 * constraints): the keys of the fields to fill.
 */
export const missingTriggerFields = (
  trigger: Partial<StageTrigger>,
): string[] => {
  const missing: string[] = [];
  if (trigger.stage_id == null) missing.push("stage_id");
  if (trigger.event === "idle" && !(Number(trigger.delay_minutes) > 0)) {
    missing.push("delay_minutes");
  }
  switch (trigger.action) {
    case "move_stage":
      if (
        trigger.target_stage_id == null ||
        same(trigger.target_stage_id, trigger.stage_id)
      ) {
        missing.push("target_stage_id");
      }
      break;
    case "add_tag":
    case "remove_tag":
      if (trigger.tag_id == null) missing.push("tag_id");
      break;
    case "create_task":
      if (!trigger.task_text?.trim()) missing.push("task_text");
      break;
    case "send_template":
      if (trigger.template_id == null) missing.push("template_id");
      break;
    case "send_webhook":
      if (trigger.webhook_id == null) missing.push("webhook_id");
      break;
    case "set_field":
      if (trigger.field_name === "plan_amount") {
        if (!(Number(trigger.plan_amount) >= 0) || trigger.plan_amount == null)
          missing.push("plan_amount");
      } else if (trigger.field_name === "doctor_id") {
        if (trigger.doctor_id == null) missing.push("doctor_id");
      } else if (trigger.field_name === "service_id") {
        if (trigger.service_id == null) missing.push("service_id");
      } else {
        missing.push("field_name");
      }
      break;
    case undefined:
      missing.push("action");
  }
  return missing;
};

/**
 * Only the columns of the chosen action are kept (the others are cleared),
 * as the settings dialog saves them.
 */
export const cleanTrigger = (
  trigger: Partial<StageTrigger>,
): Partial<StageTrigger> => {
  const cleared: Partial<StageTrigger> = {
    target_stage_id: null,
    target_sales_id: null,
    tag_id: null,
    task_type: null,
    task_text: null,
    task_due_minutes: null,
    template_id: null,
    message_mode: null,
    webhook_id: null,
    field_name: null,
    plan_amount: null,
    doctor_id: null,
    service_id: null,
  };
  const keep: Record<StageTriggerAction, (keyof StageTrigger)[]> = {
    move_stage: ["target_stage_id"],
    set_responsible: ["target_sales_id"],
    add_tag: ["tag_id"],
    remove_tag: ["tag_id"],
    create_task: ["task_type", "task_text", "task_due_minutes"],
    send_template: ["template_id", "message_mode"],
    send_webhook: ["webhook_id"],
    set_field: ["field_name", "plan_amount", "doctor_id", "service_id"],
  };
  const result: Partial<StageTrigger> = { ...trigger, ...cleared };
  for (const key of trigger.action ? keep[trigger.action] : []) {
    (result as Record<string, unknown>)[key] = trigger[key] ?? null;
  }
  if (result.action === "create_task") {
    result.task_type = result.task_type ?? "call";
    result.task_due_minutes = result.task_due_minutes ?? 0;
    result.task_text = result.task_text?.trim() ?? null;
  }
  if (result.action === "send_template") {
    result.message_mode = result.message_mode ?? "auto";
  }
  if (result.action === "set_field") {
    const field = result.field_name;
    if (field !== "plan_amount") result.plan_amount = null;
    if (field !== "doctor_id") result.doctor_id = null;
    if (field !== "service_id") result.service_id = null;
  }
  if (!DELAYED_EVENTS.includes(result.event as StageTriggerEvent)) {
    result.delay_minutes = 0;
  }
  return result;
};

export type StageColumn = {
  stage: Stage;
  taskRules: TaskRule[];
  automessageRules: AutomessageRule[];
  triggers: StageTrigger[];
};

const byPosition = <T extends { position: number; id: Identifier }>(
  a: T,
  b: T,
) => a.position - b.position || Number(a.id) - Number(b.id);

/**
 * The grid of the digital pipeline: one column per stage of the pipeline,
 * with the task rules, the auto-message rules and the triggers of that stage.
 */
export const automationColumns = ({
  stages,
  pipelineId,
  taskRules,
  automessageRules,
  triggers,
}: {
  stages: Stage[];
  pipelineId: Identifier;
  taskRules: TaskRule[];
  automessageRules: AutomessageRule[];
  triggers: StageTrigger[];
}): StageColumn[] =>
  stages
    .filter((stage) => same(stage.pipeline_id, pipelineId))
    .sort(byPosition)
    .map((stage) => ({
      stage,
      taskRules: taskRules
        .filter(
          (rule) =>
            rule.event === "stage_entered" && same(rule.stage_id, stage.id),
        )
        .sort(byPosition),
      automessageRules: automessageRules
        .filter((rule) => same(rule.stage_id, stage.id))
        .sort(byPosition),
      triggers: triggers
        .filter((trigger) => same(trigger.stage_id, stage.id))
        .sort(byPosition),
    }));

/**
 * Last activity of a deal (private.deal_last_activity_at): entering its
 * stage, a message, a note, a call, a completed task.
 */
export const lastActivityAt = ({
  deal,
  messages = [],
  notes = [],
  calls = [],
  tasks = [],
}: {
  deal: Pick<Deal, "id" | "stage_changed_at" | "created_at">;
  messages?: Pick<Message, "deal_id" | "sent_at">[];
  notes?: Pick<DealNote, "deal_id" | "date">[];
  calls?: Pick<Call, "deal_id" | "called_at">[];
  tasks?: Pick<Task, "deal_id" | "done_date">[];
}) => {
  const dates = [
    deal.stage_changed_at ?? deal.created_at,
    ...messages.filter((m) => same(m.deal_id, deal.id)).map((m) => m.sent_at),
    ...notes.filter((n) => same(n.deal_id, deal.id)).map((n) => n.date),
    ...calls.filter((c) => same(c.deal_id, deal.id)).map((c) => c.called_at),
    ...tasks
      .filter((t) => same(t.deal_id, deal.id) && t.done_date)
      .map((t) => t.done_date as string),
  ].filter(Boolean);
  return dates.reduce((latest, date) =>
    new Date(date).getTime() > new Date(latest).getTime() ? date : latest,
  );
};

/** Identity of an event instance: a trigger runs once per key and deal */
export const eventKey = (
  event: StageTriggerEvent,
  value: Identifier | string,
  stageId?: Identifier,
) => {
  const time = (date: Identifier | string) =>
    String(new Date(String(date)).getTime() / 1000);
  switch (event) {
    case "stage_entered":
      return `stage:${stageId}:${time(value)}`;
    case "appointment_set":
      return `appointment:${time(value)}`;
    case "idle":
      return `idle:${time(value)}`;
    case "visit_passed":
      return `visit:${time(value)}`;
    case "message_in":
    case "message_out":
      return `message:${value}`;
    case "call_missed":
      return `call:${value}`;
    case "payment_added":
      return `payment:${value}`;
  }
};

/**
 * A delayed trigger due for a deal (private.stage_triggers_tick): the key of
 * the event, or null when not due yet.
 */
export const delayedEventKey = (
  trigger: Pick<StageTrigger, "event" | "delay_minutes">,
  deal: Pick<Deal, "appointment_at">,
  lastActivity: string,
  now = new Date(),
) => {
  const since =
    trigger.event === "idle"
      ? lastActivity
      : trigger.event === "visit_passed"
        ? deal.appointment_at
        : null;
  if (!since) return null;
  const due = new Date(since).getTime() + trigger.delay_minutes * 60_000;
  return due <= now.getTime() ? eventKey(trigger.event, since) : null;
};

/** "2 ч", "30 мин", "1 дн" parts of a delay, for the forms */
export const DELAY_UNITS = [
  { key: "minutes", minutes: 1 },
  { key: "hours", minutes: 60 },
  { key: "days", minutes: 24 * 60 },
] as const;
export type DelayUnit = (typeof DELAY_UNITS)[number]["key"];

export const splitMinutes = (minutes: number) => {
  const unit =
    [...DELAY_UNITS]
      .reverse()
      .find((u) => minutes > 0 && minutes % u.minutes === 0) ?? DELAY_UNITS[0];
  return { amount: minutes / unit.minutes, unit: unit.key as DelayUnit };
};

export const toMinutes = (amount: number, unit: DelayUnit) =>
  Math.max(0, Math.round(amount)) *
  DELAY_UNITS.find((u) => u.key === unit)!.minutes;

export type RunLookups = {
  stageName: (id: Identifier | null | undefined) => string | undefined;
  salesName: (id: Identifier | null | undefined) => string | undefined;
  tagName: (id: Identifier | null | undefined) => string | undefined;
  templateName: (id: Identifier | null | undefined) => string | undefined;
  fieldValue: (field: string | undefined, value: unknown) => string | undefined;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One line of the deal feed: «Автоматически: этап → В работе (правило
 * «Ответил пациент»)»; a skipped or failed run gives its reason.
 */
export const describeRun = (
  run: Pick<
    StageTriggerRun,
    "action" | "status" | "details" | "error" | "trigger_name"
  >,
  lookups: RunLookups,
  translate: Translate,
) => {
  const details = run.details ?? {};
  const rule = run.trigger_name
    ? translate("pipeline_automation.feed.rule", { name: run.trigger_name })
    : "";
  if (run.status !== "done") {
    return translate(`pipeline_automation.feed.${run.status}`, {
      action: translate(`pipeline_automation.actions.${run.action}`),
      error: run.error ?? "",
      rule,
    }).trim();
  }
  let what: string;
  switch (run.action) {
    case "move_stage":
      what = translate("pipeline_automation.feed.move_stage", {
        stage: lookups.stageName(details.to_stage_id) ?? "—",
      });
      break;
    case "set_responsible":
      what = translate("pipeline_automation.feed.set_responsible", {
        name: lookups.salesName(details.to_sales_id) ?? "—",
      });
      break;
    case "add_tag":
    case "remove_tag":
      what = translate(`pipeline_automation.feed.${run.action}`, {
        tag: lookups.tagName(details.tag_id) ?? "—",
      });
      break;
    case "send_template":
      what = translate(
        details.mode === "confirm"
          ? "pipeline_automation.feed.send_template_confirm"
          : "pipeline_automation.feed.send_template",
        { template: lookups.templateName(details.template_id) ?? "—" },
      );
      break;
    case "set_field":
      what = translate("pipeline_automation.feed.set_field", {
        field: translate(`pipeline_automation.fields.${details.field}`),
        value: lookups.fieldValue(details.field, details.to) ?? "—",
      });
      break;
    default:
      what = translate(`pipeline_automation.feed.${run.action}`);
  }
  if (details.unchanged) {
    what = translate("pipeline_automation.feed.unchanged", { what });
  }
  return translate("pipeline_automation.feed.done", { what, rule }).trim();
};
