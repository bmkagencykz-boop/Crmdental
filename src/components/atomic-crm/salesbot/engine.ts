import type { Identifier } from "ra-core";

import {
  DEAL_FIELDS,
  DEAL_MATCHES,
  PATIENT_FIELDS,
  REPLY_MATCHES,
  SET_KINDS,
  STEP_TYPES,
  type Branch,
  type LogKind,
  type SalesbotSession,
  type Scenario,
  type SessionStatus,
  type SetAction,
  type Step,
  type StepType,
} from "./types";

/**
 * The salesbot engine: the same rules as the database
 * (supabase/schemas/26_salesbot.sql), for the «Тест» mode of the editor and
 * the demo data provider. Pure: everything that touches the deal goes
 * through the hooks.
 */

/** Loop protection: steps per activation, messages per session */
export const MAX_STEPS_PER_RUN = 50;
export const MAX_MESSAGES = 30;

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** Lowercase, ё → е. Same as private.salesbot_normalize */
export const normalizeText = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/ё/g, "е");

const LETTERS = "a-z0-9а-яәғқңөұүһі";
const escapeRegex = (value: string) =>
  value.replace(/[.^$*+?()[\]{}|\\-]/g, "\\$&");

/** Comma separated keywords of a branch or a trigger */
export const splitKeywords = (value: string | null | undefined) =>
  normalizeText(value)
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

const isId = (value: unknown) =>
  value != null && /^\d+$/.test(String(value).trim());
const isCount = (value: unknown) =>
  value != null && /^\d+$/.test(String(value).trim());

/**
 * Does the last reply match a branch: keywords (whole words), option (the
 * number N or the text of button N), regex (on the lowercased reply), any.
 * Same as private.salesbot_reply_matches.
 */
export const replyMatches = (
  branch: Pick<Branch, "match" | "value">,
  reply: string | null | undefined,
  buttons: string[] = [],
) => {
  if (reply == null) return false;
  const answer = normalizeText(reply).trim();
  switch (branch.match) {
    case "any":
      return true;
    case "keywords":
      return splitKeywords(branch.value).some((word) =>
        new RegExp(
          `(^|[^${LETTERS}])${escapeRegex(word)}([^${LETTERS}]|$)`,
        ).test(answer),
      );
    case "option": {
      const n = Number(String(branch.value ?? "").trim());
      if (!Number.isInteger(n)) return false;
      if (new RegExp(`^${n}([^0-9]|$)`).test(answer)) return true;
      const button = buttons[n - 1];
      return button != null && normalizeText(button).trim() === answer;
    }
    case "regex":
      try {
        return new RegExp(branch.value ?? "").test(answer);
      } catch {
        return false;
      }
    default:
      return false;
  }
};

/** What a condition may read of the deal */
export type DealFacts = {
  stage_id?: Identifier | null;
  tags: Identifier[];
  source_id?: Identifier | null;
  custom_values?: Record<string, unknown>;
};

const TRUE_WORDS = ["true", "1", "да", "yes", "+"];

/** Does the deal match a branch on its data. Same as private.salesbot_deal_matches */
export const dealMatches = (branch: Branch, deal: DealFacts) => {
  switch (branch.match) {
    case "stage":
      return same(deal.stage_id, branch.stage_id);
    case "tag":
      return deal.tags.some((tag) => same(tag, branch.tag_id));
    case "source":
      return same(deal.source_id, branch.source_id);
    case "field": {
      const stored = deal.custom_values?.[String(branch.field_id)];
      if (stored == null) return false;
      const expected = normalizeText(branch.value).trim();
      if (!expected) return true;
      if (Array.isArray(stored)) {
        return stored.some(
          (item) => normalizeText(String(item)).trim() === expected,
        );
      }
      if (typeof stored === "boolean") {
        return stored === TRUE_WORDS.includes(expected);
      }
      return normalizeText(String(stored)).trim() === expected;
    }
    default:
      return false;
  }
};

/** "1 — Записаться" lines appended to a message */
export const buttonsText = (buttons: string[] | undefined) =>
  (buttons ?? [])
    .map((button, index) => `${index + 1} — ${button.trim()}`)
    .join("\n");

/** The text of a message with its buttons. Same as private.salesbot_message_text */
export const withButtons = (text: string, buttons: string[] | undefined) =>
  [text.trim(), buttonsText(buttons)].filter(Boolean).join("\n\n").trim();

// --- validation ------------------------------------------------------------

export type ValidationCode =
  | "invalid"
  | "no_steps"
  | "duplicate_id"
  | "unknown_type"
  | "no_start"
  | "dangling_next"
  | "missing_target"
  | "missing_param"
  | "empty_message"
  | "bad_timeout"
  | "bad_delay"
  | "invalid_regex"
  | "unreachable";
export type ValidationError = { code: ValidationCode; step: string | null };

const TASK_TYPES = ["call", "message", "reminder", "other", "meeting"];

/** The errors of a scenario. Same as private.salesbot_errors */
export const validateScenario = (
  scenario: Scenario | null | undefined,
): ValidationError[] => {
  if (!scenario || !Array.isArray(scenario.steps)) {
    return [{ code: "invalid", step: null }];
  }
  if (!scenario.steps.length) return [{ code: "no_steps", step: null }];
  const errors: ValidationError[] = [];
  const add = (code: ValidationCode, step: string | null) =>
    errors.push({ code, step });
  const ids: string[] = [];
  for (const step of scenario.steps) {
    const id = typeof step?.id === "string" ? step.id.trim() : "";
    if (!id) {
      add("invalid", null);
      continue;
    }
    if (ids.includes(id)) add("duplicate_id", id);
    ids.push(id);
  }
  if (!scenario.start || !ids.includes(scenario.start)) add("no_start", null);

  const edges = new Map<string, string[]>();
  for (const step of scenario.steps) {
    const id = typeof step?.id === "string" ? step.id.trim() : "";
    if (!id) continue;
    const optional: (string | null | undefined)[] = [];
    const required: (string | null | undefined)[] = [];
    switch (step.type) {
      case "send_message":
        if (!step.text?.trim() && !isId(step.template_id)) {
          add("empty_message", id);
        }
        if (
          step.buttons != null &&
          (!Array.isArray(step.buttons) ||
            step.buttons.some((b) => typeof b !== "string" || !b.trim()))
        ) {
          add("missing_param", id);
        }
        optional.push(step.next);
        break;
      case "wait_reply":
        if (!isCount(step.timeout_minutes) || Number(step.timeout_minutes) < 1)
          add("bad_timeout", id);
        required.push(step.next, step.timeout_next);
        break;
      case "condition":
        if (!Array.isArray(step.branches) || !step.branches.length) {
          add("missing_param", id);
        } else {
          for (const branch of step.branches) {
            if (branchIncomplete(branch)) add("missing_param", id);
            else if (branch.match === "regex") {
              try {
                new RegExp(branch.value ?? "");
              } catch {
                add("invalid_regex", id);
              }
            }
            required.push(branch?.next);
          }
        }
        required.push(step.else_next);
        break;
      case "set":
        if (!Array.isArray(step.actions) || !step.actions.length) {
          add("missing_param", id);
        } else if (step.actions.some(actionIncomplete)) {
          add("missing_param", id);
        }
        optional.push(step.next);
        break;
      case "create_task":
        if (
          !step.text?.trim() ||
          !TASK_TYPES.includes(step.task_type ?? "") ||
          (step.due_minutes != null && !isCount(step.due_minutes))
        ) {
          add("missing_param", id);
        }
        optional.push(step.next);
        break;
      case "handoff":
      case "stop":
        break;
      case "webhook":
        if (!isId(step.webhook_id)) add("missing_param", id);
        optional.push(step.next);
        break;
      case "delay":
        if (!isCount(step.minutes) || Number(step.minutes) < 1)
          add("bad_delay", id);
        optional.push(step.next);
        break;
      default:
        add("unknown_type", id);
    }
    for (const target of optional) {
      if (target && !ids.includes(target)) add("dangling_next", id);
    }
    for (const target of required) {
      if (!target) add("missing_target", id);
      else if (!ids.includes(target)) add("dangling_next", id);
    }
    edges.set(
      id,
      [...optional, ...required].filter((t): t is string => !!t),
    );
  }

  if (scenario.start && ids.includes(scenario.start)) {
    const reachable = new Set<string>();
    const queue = [scenario.start];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      queue.push(...(edges.get(id) ?? []));
    }
    for (const id of [...new Set(ids)].sort()) {
      if (!reachable.has(id)) add("unreachable", id);
    }
  }
  return errors;
};

const branchIncomplete = (branch: Branch | null | undefined) => {
  if (!branch || typeof branch !== "object") return true;
  if (
    !(REPLY_MATCHES as readonly string[]).includes(branch.match) &&
    !(DEAL_MATCHES as readonly string[]).includes(branch.match)
  ) {
    return true;
  }
  switch (branch.match) {
    case "keywords":
    case "regex":
      return !branch.value?.trim();
    case "option":
      return !/^\s*\d+\s*$/.test(branch.value ?? "");
    case "stage":
      return !isId(branch.stage_id);
    case "tag":
      return !isId(branch.tag_id);
    case "source":
      return !isId(branch.source_id);
    case "field":
      return !isId(branch.field_id);
    default:
      return false;
  }
};

const actionIncomplete = (action: SetAction | null | undefined) => {
  if (!action || !(SET_KINDS as readonly string[]).includes(action.kind)) {
    return true;
  }
  switch (action.kind) {
    case "stage":
      return !isId(action.stage_id);
    case "tag_add":
    case "tag_remove":
      return !isId(action.tag_id);
    case "field":
      return !isId(action.field_id);
    case "deal_field":
      return !(DEAL_FIELDS as readonly string[]).includes(action.field ?? "");
    case "patient_field":
      return !(PATIENT_FIELDS as readonly string[]).includes(
        action.field ?? "",
      );
    default:
      return false;
  }
};

/** Errors that make the scenario unusable even as a draft */
export const isBroken = (errors: ValidationError[]) =>
  errors.some((error) =>
    ["invalid", "duplicate_id", "unknown_type"].includes(error.code),
  );

// --- runtime ---------------------------------------------------------------

/** The part of a session the engine runs */
export type EngineSession = Pick<
  SalesbotSession,
  | "scenario"
  | "current_step"
  | "state"
  | "status"
  | "wait_until"
  | "last_reply"
  | "messages_sent"
  | "stopped_reason"
>;

export type EngineLog = {
  step: Step | null;
  kind: LogKind;
  text?: string | null;
  details?: Record<string, unknown>;
};

/** Everything the engine does to the world */
export type EngineHooks = {
  now?: () => Date;
  /** Quiet hours: when a message queued now goes out */
  sendTime?: (now: Date) => Date;
  deal: () => DealFacts | Promise<DealFacts>;
  /** Template variables + {ответ} */
  render: (body: string, reply: string | null) => string | Promise<string>;
  templateBody?: (
    id: Identifier,
  ) => string | undefined | Promise<string | undefined>;
  send: (text: string, sendAt: Date, step: Step) => void | Promise<void>;
  /** Throws when the action cannot be done ("Выполните чек-лист…": skipped) */
  applySet: (
    action: SetAction,
    reply: string | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  createTask: (step: Step, text: string) => void | Promise<void>;
  handoff: (step: Step) => void | Promise<void>;
  /** false: the webhook is off */
  webhook: (step: Step) => boolean | Promise<boolean>;
  log: (entry: EngineLog) => void | Promise<void>;
};

export const findStep = (scenario: Scenario, id: string | null | undefined) =>
  id ? scenario.steps.find((step) => step.id === id) : undefined;

/** A new session of a scenario (status running, at its start) */
export const startSession = (scenario: Scenario): EngineSession => ({
  scenario,
  current_step: scenario.start,
  state: {},
  status: "running",
  wait_until: null,
  last_reply: null,
  messages_sent: 0,
  stopped_reason: null,
});

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

const finish = async (
  session: EngineSession,
  status: SessionStatus,
  reason: string | null,
  hooks: EngineHooks,
) => {
  const { wait: _wait, ...state } = session.state;
  const result: EngineSession = {
    ...session,
    status,
    stopped_reason: reason,
    wait_until: null,
    state,
  };
  await hooks.log({
    step: null,
    kind:
      status === "done" || status === "stopped" || status === "failed"
        ? status
        : "handoff",
    text: reason,
  });
  return result;
};

/** Ends an active session (replaced, stopped by hand, a human took over) */
export const stopSession = (
  session: EngineSession,
  reason: string,
  hooks: EngineHooks,
) => finish(session, "stopped", reason, hooks);

/**
 * Runs the steps of a running session until it waits or ends. Same as
 * private.salesbot_advance.
 */
export const advance = async (
  input: EngineSession,
  hooks: EngineHooks,
): Promise<EngineSession> => {
  if (input.status !== "running") return input;
  let session: EngineSession = { ...input, state: { ...input.state } };
  const now = hooks.now?.() ?? new Date();
  let steps = 0;
  const end = (status: SessionStatus, reason: string | null = null) =>
    finish(session, status, reason, hooks);

  for (;;) {
    if (!session.current_step) return end("done");
    const step = findStep(session.scenario, session.current_step);
    if (!step) return end("failed", "Шаг сценария не найден");
    steps++;
    if (steps > MAX_STEPS_PER_RUN) {
      return end(
        "failed",
        "Слишком много шагов подряд: проверьте, нет ли в сценарии петли",
      );
    }
    const next = step.next || null;
    switch (step.type as StepType) {
      case "send_message": {
        if (session.messages_sent >= MAX_MESSAGES) {
          return end("failed", "Бот отправил слишком много сообщений");
        }
        const body =
          (isId(step.template_id)
            ? await hooks.templateBody?.(step.template_id!)
            : undefined) ??
          step.text ??
          "";
        const text = withButtons(
          await hooks.render(body, session.last_reply),
          step.buttons,
        );
        if (!text) {
          await hooks.log({
            step,
            kind: "skipped",
            text: "Пустой текст сообщения",
          });
        } else {
          const sendAt = hooks.sendTime?.(now) ?? now;
          await hooks.send(text, sendAt, step);
          session.messages_sent++;
          session.state = {
            ...session.state,
            last_send_at: sendAt.toISOString(),
            buttons: step.buttons ?? [],
          };
          await hooks.log({
            step,
            kind: "sent",
            text,
            details: { send_at: sendAt.toISOString() },
          });
        }
        session.current_step = next;
        break;
      }
      case "wait_reply": {
        const lastSend = session.state.last_send_at
          ? new Date(session.state.last_send_at)
          : now;
        const from = lastSend > now ? lastSend : now;
        session = {
          ...session,
          status: "waiting",
          wait_until: addMinutes(
            from,
            Number(step.timeout_minutes),
          ).toISOString(),
          state: { ...session.state, wait: "reply" },
        };
        await hooks.log({
          step,
          kind: "waiting",
          details: { until: session.wait_until },
        });
        return session;
      }
      case "delay":
        session = {
          ...session,
          status: "waiting",
          wait_until: addMinutes(now, Number(step.minutes)).toISOString(),
          state: { ...session.state, wait: "delay" },
        };
        await hooks.log({
          step,
          kind: "delay",
          details: { until: session.wait_until },
        });
        return session;
      case "condition": {
        const deal = await hooks.deal();
        const branch = (step.branches ?? []).find((b) =>
          (REPLY_MATCHES as readonly string[]).includes(b.match)
            ? replyMatches(b, session.last_reply, session.state.buttons)
            : dealMatches(b, deal),
        );
        const target = branch ? branch.next : step.else_next || null;
        await hooks.log({
          step,
          kind: "branch",
          text: session.last_reply,
          details: { next: target, matched: !!branch },
        });
        session.current_step = target;
        break;
      }
      case "set":
        for (const action of step.actions ?? []) {
          try {
            const result = await hooks.applySet(action, session.last_reply);
            await hooks.log({ step, kind: "set", details: { action, result } });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            await hooks.log({
              step,
              kind: message.startsWith("Выполните чек-лист")
                ? "skipped"
                : "failed",
              text: message,
              details: { action },
            });
          }
        }
        session.current_step = next;
        break;
      case "create_task":
        try {
          await hooks.createTask(
            step,
            await hooks.render(step.text ?? "", session.last_reply),
          );
          await hooks.log({ step, kind: "task", text: step.text });
        } catch (error) {
          await hooks.log({
            step,
            kind: "failed",
            text: error instanceof Error ? error.message : String(error),
          });
        }
        session.current_step = next;
        break;
      case "handoff":
        await hooks.handoff(step);
        return end("handed_off", step.text?.trim() || null);
      case "webhook": {
        const queued = await hooks.webhook(step);
        await hooks.log({
          step,
          kind: queued ? "webhook" : "failed",
          text: queued ? null : "Вебхук выключен или удалён",
          details: { webhook_id: step.webhook_id },
        });
        session.current_step = next;
        break;
      }
      case "stop":
        return end("done");
      default:
        return end("failed", "Неизвестный шаг сценария");
    }
  }
};

/**
 * An inbound message: resumes a session waiting for a reply, or keeps the
 * reply during a delay. Same as the session part of
 * private.salesbot_on_inbound.
 */
export const receiveReply = async (
  session: EngineSession,
  reply: string,
  hooks: EngineHooks,
): Promise<EngineSession> => {
  if (session.status !== "waiting" && session.status !== "running") {
    return session;
  }
  const replies = [...(session.state.replies ?? []), reply.slice(0, 1000)];
  const step = findStep(session.scenario, session.current_step) ?? null;
  if (session.status === "waiting" && session.state.wait === "reply") {
    const { wait: _wait, ...state } = session.state;
    const resumed: EngineSession = {
      ...session,
      last_reply: reply,
      state: { ...state, replies: replies.slice(-20) },
      status: "running",
      wait_until: null,
      current_step: step?.next || null,
    };
    await hooks.log({ step, kind: "reply", text: reply });
    return advance(resumed, hooks);
  }
  await hooks.log({ step, kind: "reply", text: reply });
  return {
    ...session,
    last_reply: reply,
    state: { ...session.state, replies: replies.slice(-20) },
  };
};

/**
 * The tick: a timed-out reply takes the timeout branch, an ended delay goes
 * on. Same as private.salesbot_tick for one session.
 */
export const resumeDue = async (
  session: EngineSession,
  hooks: EngineHooks,
  moment: Date = hooks.now?.() ?? new Date(),
  force = false,
): Promise<EngineSession> => {
  if (
    session.status !== "waiting" ||
    (!force && (!session.wait_until || new Date(session.wait_until) > moment))
  ) {
    return session;
  }
  const step = findStep(session.scenario, session.current_step) ?? null;
  const { wait, ...state } = session.state;
  const resumed: EngineSession = {
    ...session,
    status: "running",
    wait_until: null,
    state,
    current_step: (wait === "reply" ? step?.timeout_next : step?.next) || null,
  };
  if (step?.type === "wait_reply") await hooks.log({ step, kind: "timeout" });
  return advance(resumed, hooks);
};

/** Is a session still talking */
export const isActive = (status: SessionStatus | undefined) =>
  status === "running" || status === "waiting";

export const STEP_TYPE_LIST: readonly StepType[] = STEP_TYPES;
