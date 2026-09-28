import type { Branch, LogKind, SetAction, Step, StepType } from "./types";
import type { Slot } from "./scenarioEdit";
import { nameOf, type BotLookups } from "./useBotDictionaries";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A colored left border per step type (theme tokens), no icons */
export const STEP_BORDER: Record<StepType, string> = {
  send_message: "border-l-primary",
  wait_reply: "border-l-brand-yellow",
  condition: "border-l-brand-blue",
  set: "border-l-brand-green",
  create_task: "border-l-brand-lime",
  handoff: "border-l-brand-pink",
  webhook: "border-l-muted-foreground",
  delay: "border-l-brand-rose",
  stop: "border-l-destructive",
};

/** «90 мин», «2 ч», «1 дн» */
export const formatMinutes = (minutes: number, translate: Translate) => {
  const n = Number(minutes) || 0;
  if (n >= 1440 && n % 1440 === 0) {
    return translate("salesbot.time.days", { n: n / 1440 });
  }
  if (n >= 60 && n % 60 === 0) {
    return translate("salesbot.time.hours", { n: n / 60 });
  }
  return translate("salesbot.time.minutes", { n });
};

const shorten = (text: string, length = 70) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;

export const branchSummary = (
  branch: Branch,
  translate: Translate,
  lookups: BotLookups,
) => {
  const missing = translate("salesbot.panel.choose");
  switch (branch.match) {
    case "stage":
      return translate("salesbot.match_summary.stage", {
        name: nameOf(lookups.stages, branch.stage_id) ?? missing,
      });
    case "tag":
      return translate("salesbot.match_summary.tag", {
        name: nameOf(lookups.tags, branch.tag_id) ?? missing,
      });
    case "source":
      return translate("salesbot.match_summary.source", {
        name: nameOf(lookups.sources, branch.source_id) ?? missing,
      });
    case "field":
      return branch.value?.trim()
        ? translate("salesbot.match_summary.field", {
            name: nameOf(lookups.fields, branch.field_id) ?? missing,
            value: branch.value.trim(),
          })
        : translate("salesbot.match_summary.field_filled", {
            name: nameOf(lookups.fields, branch.field_id) ?? missing,
          });
    default:
      return translate(`salesbot.match_summary.${branch.match}`, {
        value: branch.value?.trim() || "…",
      });
  }
};

export const actionSummary = (
  action: SetAction,
  translate: Translate,
  lookups: BotLookups,
) => {
  const missing = translate("salesbot.panel.choose");
  switch (action.kind) {
    case "stage":
      return translate("salesbot.set_summary.stage", {
        name: nameOf(lookups.stages, action.stage_id) ?? missing,
      });
    case "responsible":
      return translate("salesbot.set_summary.responsible", {
        name:
          action.sales_id == null
            ? translate("salesbot.set.round_robin")
            : (nameOf(lookups.sales, action.sales_id) ?? missing),
      });
    case "tag_add":
    case "tag_remove":
      return translate(`salesbot.set_summary.${action.kind}`, {
        name: nameOf(lookups.tags, action.tag_id) ?? missing,
      });
    case "field":
      return translate("salesbot.set_summary.field", {
        name: nameOf(lookups.fields, action.field_id) ?? missing,
        value: action.value ?? "",
      });
    case "deal_field": {
      const list =
        action.field === "service_id"
          ? lookups.services
          : action.field === "doctor_id"
            ? lookups.doctors
            : action.field === "source_id"
              ? lookups.sources
              : null;
      return translate("salesbot.set_summary.field", {
        name: translate(`salesbot.deal_fields.${action.field ?? "name"}`),
        value: list
          ? (nameOf(list, action.value) ?? missing)
          : (action.value ?? ""),
      });
    }
    case "patient_field":
      return translate("salesbot.set_summary.field", {
        name: translate(
          `salesbot.patient_fields.${action.field ?? "first_name"}`,
        ),
        value: action.value ?? "",
      });
  }
};

/** One line under the type label of a card */
export const stepSummary = (
  step: Step,
  translate: Translate,
  lookups: BotLookups,
) => {
  switch (step.type) {
    case "send_message": {
      const template = step.template_id
        ? nameOf(lookups.templates, step.template_id)
        : undefined;
      const text = template
        ? translate("salesbot.summary.template", { name: template })
        : step.text?.trim()
          ? shorten(step.text.trim(), 140)
          : translate("salesbot.summary.no_text");
      return step.buttons?.length
        ? `${text}\n${translate("salesbot.summary.buttons", {
            buttons: step.buttons.map((b, i) => `${i + 1} — ${b}`).join(", "),
          })}`
        : text;
    }
    case "wait_reply":
      return translate("salesbot.summary.wait", {
        time: formatMinutes(step.timeout_minutes ?? 0, translate),
      });
    case "delay":
      return translate("salesbot.summary.delay", {
        time: formatMinutes(step.minutes ?? 0, translate),
      });
    case "condition":
      return (step.branches ?? [])
        .map((b) => branchSummary(b, translate, lookups))
        .join(" · ");
    case "set":
      return (step.actions ?? [])
        .map((a) => actionSummary(a, translate, lookups))
        .join(" · ");
    case "create_task":
      return translate("salesbot.summary.task", {
        type: translate(`crm.tasks.types.${step.task_type ?? "call"}`),
        text: shorten(step.text?.trim() || "…"),
      });
    case "handoff":
      return [
        step.text?.trim(),
        step.create_task ? translate("salesbot.summary.handoff_task") : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "webhook":
      return translate("salesbot.summary.webhook", {
        name:
          nameOf(lookups.webhooks, step.webhook_id) ??
          translate("salesbot.panel.choose"),
      });
    case "stop":
      return translate("salesbot.summary.stop");
  }
};

/** The label of a column of a wait or a condition */
export const slotLabel = (
  step: Step,
  slot: Slot,
  translate: Translate,
  lookups: BotLookups,
) => {
  switch (slot.kind) {
    case "next":
      return step.type === "wait_reply"
        ? translate("salesbot.columns.reply")
        : translate("salesbot.panel.next");
    case "timeout_next":
      return translate("salesbot.columns.timeout", {
        time: formatMinutes(step.timeout_minutes ?? 0, translate),
      });
    case "else_next":
      return translate("salesbot.columns.else");
    case "branch": {
      const branch = step.branches?.[slot.index];
      return branch
        ? `${slot.index + 1}. ${branchSummary(branch, translate, lookups)}`
        : "";
    }
  }
};

/** «Сообщение · s3: Здравствуйте…» for the target selects */
export const stepOptionLabel = (step: Step, translate: Translate) => {
  const detail =
    step.type === "send_message" && step.text?.trim()
      ? `: ${shorten(step.text.trim(), 40)}`
      : "";
  return `${step.id} · ${translate(`salesbot.types.${step.type}`)}${detail}`;
};

/** What the deal feed shows of the bot's log (replies are messages already) */
export const FEED_LOG_KINDS: LogKind[] = [
  "started",
  "sent",
  "waiting",
  "delay",
  "timeout",
  "set",
  "task",
  "handoff",
  "webhook",
  "skipped",
  "failed",
  "done",
  "stopped",
  "moved",
];
