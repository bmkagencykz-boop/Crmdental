import { describe, expect, it } from "vitest";

import {
  advance,
  dealMatches,
  receiveReply,
  replyMatches,
  resumeDue,
  startSession,
  stopSession,
  validateScenario,
  withButtons,
  type DealFacts,
  type EngineHooks,
  type EngineLog,
} from "./engine";
import {
  buildFlow,
  duplicateStep,
  insertStep,
  linkSlot,
  removeStep,
} from "./scenarioEdit";
import type { Scenario, SetAction } from "./types";

/** Hooks that record everything, on an in-memory deal */
const recorder = (deal: DealFacts = { stage_id: 1, tags: [] }) => {
  const sent: string[] = [];
  const logs: EngineLog[] = [];
  const tasks: string[] = [];
  const handoffs: string[] = [];
  const webhooks: unknown[] = [];
  let now = new Date("2026-10-01T06:00:00Z");
  const hooks: EngineHooks = {
    now: () => now,
    deal: () => deal,
    render: (body, reply) =>
      body.replace("{имя}", "Асель").replace("{ответ}", reply ?? ""),
    templateBody: (id) => (String(id) === "7" ? "Шаблон {имя}" : undefined),
    send: (text) => {
      sent.push(text);
    },
    applySet: (action: SetAction, reply) => {
      if (action.kind === "tag_add") {
        deal.tags = [...deal.tags, action.tag_id!];
        return { tag_id: action.tag_id };
      }
      if (action.kind === "stage") {
        if (String(action.stage_id) === "99") {
          throw new Error("Выполните чек-лист этапа «В работе»");
        }
        deal.stage_id = action.stage_id;
        return { to_stage_id: action.stage_id };
      }
      if (action.kind === "field") {
        deal.custom_values = {
          ...deal.custom_values,
          [String(action.field_id)]: (action.value ?? "").replace(
            "{ответ}",
            reply ?? "",
          ),
        };
        return {};
      }
      throw new Error("Некому назначить");
    },
    createTask: (_step, text) => {
      tasks.push(text);
    },
    handoff: (step) => {
      handoffs.push(step.text ?? "");
    },
    webhook: (step) => {
      webhooks.push(step.webhook_id);
      return String(step.webhook_id) === "1";
    },
    log: (entry) => {
      logs.push(entry);
    },
  };
  return {
    hooks,
    sent,
    logs,
    tasks,
    handoffs,
    webhooks,
    deal,
    kinds: () => logs.map((log) => log.kind),
    setNow: (value: Date) => {
      now = value;
    },
  };
};

const consultation: Scenario = {
  start: "greet",
  steps: [
    {
      id: "greet",
      type: "send_message",
      text: "Здравствуйте, {имя}! Что беспокоит?",
      buttons: ["Боль", "Имплантация"],
      next: "wait",
    },
    {
      id: "wait",
      type: "wait_reply",
      timeout_minutes: 60,
      next: "cond",
      timeout_next: "handoff",
    },
    {
      id: "cond",
      type: "condition",
      branches: [
        { match: "option", value: "1", next: "pain" },
        { match: "keywords", value: "имплант, зуб выпал", next: "implant" },
      ],
      else_next: "handoff",
    },
    {
      id: "pain",
      type: "set",
      actions: [{ kind: "tag_add", tag_id: 5 }],
      next: "offer",
    },
    {
      id: "implant",
      type: "set",
      actions: [
        { kind: "tag_add", tag_id: 6 },
        { kind: "field", field_id: 3, value: "{ответ}" },
      ],
      next: "offer",
    },
    { id: "offer", type: "send_message", text: "Записать вас?", next: "wait2" },
    {
      id: "wait2",
      type: "wait_reply",
      timeout_minutes: 30,
      next: "cond2",
      timeout_next: "handoff",
    },
    {
      id: "cond2",
      type: "condition",
      branches: [{ match: "keywords", value: "да", next: "book" }],
      else_next: "handoff",
    },
    {
      id: "book",
      type: "set",
      actions: [{ kind: "stage", stage_id: 3 }],
      next: "task",
    },
    {
      id: "task",
      type: "create_task",
      task_type: "call",
      text: "Записать ({ответ})",
      next: "bye",
    },
    { id: "bye", type: "send_message", text: "Спасибо!" },
    { id: "handoff", type: "handoff", text: "Нужен администратор" },
  ],
};

describe("replyMatches", () => {
  it("matches keywords as whole words, case and ё insensitive", () => {
    const branch = { match: "keywords" as const, value: "цена, сколько стоит" };
    expect(replyMatches(branch, "Какая ЦЕНА?")).toBe(true);
    expect(replyMatches(branch, "Сколько СТОИТ имплант")).toBe(true);
    expect(replyMatches(branch, "бесценно")).toBe(false);
    expect(
      replyMatches({ match: "keywords", value: "еще" }, "Ещё вопрос"),
    ).toBe(true);
    expect(replyMatches({ match: "keywords", value: "да" }, "когда")).toBe(
      false,
    );
  });

  it("matches an option by number or by the text of its button", () => {
    const option = { match: "option" as const, value: "1" };
    expect(replyMatches(option, "1")).toBe(true);
    expect(replyMatches(option, "1. Боль")).toBe(true);
    expect(replyMatches(option, "1 — да")).toBe(true);
    expect(replyMatches(option, "10")).toBe(false);
    expect(replyMatches(option, " боль ", ["Боль", "Другое"])).toBe(true);
    expect(replyMatches(option, "другое", ["Боль", "Другое"])).toBe(false);
  });

  it("matches a regex on the lowercased reply, any reply for «any»", () => {
    expect(replyMatches({ match: "regex", value: "^\\d{2}$" }, "42")).toBe(
      true,
    );
    expect(
      replyMatches({ match: "regex", value: "^спасибо" }, "Спасибо!"),
    ).toBe(true);
    expect(replyMatches({ match: "regex", value: "(" }, "x")).toBe(false);
    expect(replyMatches({ match: "any" }, "")).toBe(true);
    expect(replyMatches({ match: "any" }, null)).toBe(false);
  });
});

describe("dealMatches", () => {
  const deal: DealFacts = {
    stage_id: 2,
    tags: [5],
    source_id: 4,
    custom_values: { "3": "Инстаграм", "4": true, "5": ["Имплант", "КТ"] },
  };
  it("reads the stage, the tags, the source and the custom fields", () => {
    expect(dealMatches({ match: "stage", stage_id: 2, next: "x" }, deal)).toBe(
      true,
    );
    expect(dealMatches({ match: "tag", tag_id: 6, next: "x" }, deal)).toBe(
      false,
    );
    expect(
      dealMatches({ match: "source", source_id: 4, next: "x" }, deal),
    ).toBe(true);
    expect(
      dealMatches(
        { match: "field", field_id: 3, value: "инстаграм", next: "x" },
        deal,
      ),
    ).toBe(true);
    expect(dealMatches({ match: "field", field_id: 3, next: "x" }, deal)).toBe(
      true,
    );
    expect(
      dealMatches(
        { match: "field", field_id: 4, value: "да", next: "x" },
        deal,
      ),
    ).toBe(true);
    expect(
      dealMatches(
        { match: "field", field_id: 5, value: "кт", next: "x" },
        deal,
      ),
    ).toBe(true);
    expect(dealMatches({ match: "field", field_id: 9, next: "x" }, deal)).toBe(
      false,
    );
  });
});

describe("validateScenario", () => {
  it("accepts a complete scenario", () => {
    expect(validateScenario(consultation)).toEqual([]);
  });

  it("reports every kind of error with its step", () => {
    expect(validateScenario(null)).toEqual([{ code: "invalid", step: null }]);
    expect(validateScenario({ start: null, steps: [] })).toEqual([
      { code: "no_steps", step: null },
    ]);
    const errors = validateScenario({
      start: "a",
      steps: [
        { id: "a", type: "wait_reply", timeout_minutes: 0, next: "zz" },
        { id: "b", type: "send_message", text: " " },
        {
          id: "c",
          type: "condition",
          branches: [{ match: "regex", value: "(", next: "a" }],
        },
        { id: "a", type: "stop" },
        { id: "d", type: "dance" as never },
      ],
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        { code: "duplicate_id", step: "a" },
        { code: "bad_timeout", step: "a" },
        { code: "dangling_next", step: "a" },
        { code: "missing_target", step: "a" },
        { code: "empty_message", step: "b" },
        { code: "invalid_regex", step: "c" },
        { code: "missing_target", step: "c" },
        { code: "unknown_type", step: "d" },
        { code: "unreachable", step: "b" },
      ]),
    );
    expect(
      validateScenario({ start: "x", steps: [{ id: "a", type: "stop" }] }),
    ).toContainEqual({ code: "no_start", step: null });
    expect(
      validateScenario({
        start: "a",
        steps: [
          { id: "a", type: "set", actions: [{ kind: "stage" }], next: "b" },
          { id: "b", type: "create_task", task_type: "call", text: "" },
        ],
      }),
    ).toEqual([
      { code: "missing_param", step: "a" },
      { code: "missing_param", step: "b" },
    ]);
  });
});

describe("runtime", () => {
  it("runs the consultation: greeting, option, offer, booking", async () => {
    const r = recorder();
    let session = await advance(startSession(consultation), r.hooks);
    expect(session.status).toBe("waiting");
    expect(session.current_step).toBe("wait");
    expect(r.sent).toEqual([
      "Здравствуйте, Асель! Что беспокоит?\n\n1 — Боль\n2 — Имплантация",
    ]);
    expect(session.wait_until).toBe("2026-10-01T07:00:00.000Z");

    session = await receiveReply(session, "боль", r.hooks);
    expect(r.deal.tags).toEqual([5]);
    expect(session.current_step).toBe("wait2");
    session = await receiveReply(session, "Да, конечно", r.hooks);
    expect(r.deal.stage_id).toBe(3);
    expect(r.tasks).toEqual(["Записать (Да, конечно)"]);
    expect(session.status).toBe("done");
    expect(r.sent.at(-1)).toBe("Спасибо!");
    expect(r.kinds()).toEqual([
      "sent",
      "waiting",
      "reply",
      "branch",
      "set",
      "sent",
      "waiting",
      "reply",
      "branch",
      "set",
      "task",
      "sent",
      "done",
    ]);
  });

  it("fills a custom field with the reply", async () => {
    const r = recorder();
    const session = await advance(startSession(consultation), r.hooks);
    await receiveReply(session, "Хочу имплант", r.hooks);
    expect(r.deal.custom_values).toEqual({ "3": "Хочу имплант" });
    expect(r.deal.tags).toEqual([6]);
  });

  it("takes the timeout branch on the tick, only when due", async () => {
    const r = recorder();
    let session = await advance(startSession(consultation), r.hooks);
    const early = await resumeDue(
      session,
      r.hooks,
      new Date("2026-10-01T06:30:00Z"),
    );
    expect(early).toBe(session);
    session = await resumeDue(
      session,
      r.hooks,
      new Date("2026-10-01T07:00:00Z"),
    );
    expect(session.status).toBe("handed_off");
    expect(r.handoffs).toEqual(["Нужен администратор"]);
    expect(r.kinds().slice(-2)).toEqual(["timeout", "handoff"]);
  });

  it("counts the timeout from the moment the message goes out (quiet hours)", async () => {
    const r = recorder();
    r.hooks.sendTime = () => new Date("2026-10-02T04:00:00Z");
    const session = await advance(startSession(consultation), r.hooks);
    expect(session.wait_until).toBe("2026-10-02T05:00:00.000Z");
  });

  it("keeps a reply during a delay for the next condition", async () => {
    const r = recorder();
    const scenario: Scenario = {
      start: "d",
      steps: [
        { id: "d", type: "delay", minutes: 10, next: "c" },
        {
          id: "c",
          type: "condition",
          branches: [{ match: "any", next: "hi" }],
          else_next: "end",
        },
        { id: "hi", type: "send_message", text: "Ответ: {ответ}", next: "end" },
        { id: "end", type: "stop" },
      ],
    };
    let session = await advance(startSession(scenario), r.hooks);
    expect(session.state.wait).toBe("delay");
    session = await receiveReply(session, "Привет", r.hooks);
    expect(session.status).toBe("waiting");
    session = await resumeDue(
      session,
      r.hooks,
      new Date("2026-10-02T00:00:00Z"),
    );
    expect(r.sent).toEqual(["Ответ: Привет"]);
    expect(session.status).toBe("done");
  });

  it("logs a checklist block as skipped and goes on; other errors as failed", async () => {
    const r = recorder();
    const session = await advance(
      startSession({
        start: "s",
        steps: [
          {
            id: "s",
            type: "set",
            actions: [
              { kind: "stage", stage_id: 99 },
              { kind: "responsible", sales_id: 1 },
            ],
            next: "m",
          },
          { id: "m", type: "send_message", text: "Дальше" },
        ],
      }),
      r.hooks,
    );
    expect(r.kinds()).toEqual(["skipped", "failed", "sent", "done"]);
    expect(session.status).toBe("done");
  });

  it("stops a loop after 50 steps and a chatter after 30 messages", async () => {
    const loop = recorder();
    const looped = await advance(
      startSession({
        start: "a",
        steps: [
          {
            id: "a",
            type: "condition",
            branches: [{ match: "tag", tag_id: 5, next: "a" }],
            else_next: "b",
          },
          {
            id: "b",
            type: "set",
            actions: [{ kind: "tag_add", tag_id: 5 }],
            next: "a",
          },
        ],
      }),
      loop.hooks,
    );
    expect(looped.status).toBe("failed");
    expect(looped.stopped_reason).toMatch(/Слишком много шагов/);

    const chatter = recorder();
    const talked = await advance(
      startSession({
        start: "a",
        steps: [
          { id: "a", type: "send_message", text: "Раз", next: "b" },
          { id: "b", type: "send_message", text: "Два", next: "a" },
        ],
      }),
      chatter.hooks,
    );
    expect(talked.status).toBe("failed");
    expect(talked.messages_sent).toBe(30);
    expect(chatter.sent).toHaveLength(30);
  });

  it("sends a template, calls the webhook, stops by hand", async () => {
    const r = recorder();
    let session = await advance(
      startSession({
        start: "t",
        steps: [
          { id: "t", type: "send_message", template_id: 7, next: "w" },
          { id: "w", type: "webhook", webhook_id: 2, next: "wait" },
          {
            id: "wait",
            type: "wait_reply",
            timeout_minutes: 5,
            next: "wait",
            timeout_next: "wait",
          },
        ],
      }),
      r.hooks,
    );
    expect(r.sent).toEqual(["Шаблон Асель"]);
    expect(r.kinds()).toEqual(["sent", "failed", "waiting"]);
    session = await stopSession(session, "Сотрудник ответил сам", r.hooks);
    expect(session.status).toBe("stopped");
    expect(await receiveReply(session, "Алло", r.hooks)).toBe(session);
  });

  it("appends numbered buttons", () => {
    expect(withButtons("Как вам удобнее?", ["Утром", " Вечером "])).toBe(
      "Как вам удобнее?\n\n1 — Утром\n2 — Вечером",
    );
    expect(withButtons("", ["Да"])).toBe("1 — Да");
  });
});

describe("scenario editing", () => {
  const base: Scenario = {
    start: "a",
    steps: [
      { id: "a", type: "send_message", text: "Привет", next: "b" },
      { id: "b", type: "stop" },
    ],
  };

  it("inserts a step between two steps and at the start", () => {
    const { scenario, id } = insertStep(
      base,
      { kind: "slot", stepId: "a", slot: { kind: "next" } },
      "delay",
    );
    expect(id).toBe("s3");
    expect(scenario.steps.find((s) => s.id === "a")?.next).toBe("s3");
    expect(scenario.steps.find((s) => s.id === "s3")?.next).toBe("b");
    const first = insertStep(base, { kind: "start" }, "send_message");
    expect(first.scenario.start).toBe(first.id);
    expect(first.scenario.steps.at(-1)?.next).toBe("a");
    // A branching step keeps the rest of the chain in its main slot
    const cond = insertStep(
      base,
      { kind: "slot", stepId: "a", slot: { kind: "next" } },
      "condition",
    );
    expect(cond.scenario.steps.at(-1)?.else_next).toBe("b");
  });

  it("removes a step, reconnecting its neighbours", () => {
    const removed = removeStep(base, "a");
    expect(removed.start).toBe("b");
    expect(removed.steps.map((s) => s.id)).toEqual(["b"]);
  });

  it("duplicates a step right after it", () => {
    const { scenario, id } = duplicateStep(base, "a");
    expect(scenario.steps.find((s) => s.id === "a")?.next).toBe(id);
    expect(scenario.steps.find((s) => s.id === id)).toMatchObject({
      text: "Привет",
      next: "b",
    });
  });

  it("lays out branches as columns, jumps for steps reached twice, orphans apart", () => {
    const { items, orphans } = buildFlow(consultation);
    expect(items.map((item) => item.kind)).toEqual(["step", "step"]);
    const wait = items[1];
    if (wait.kind !== "step") throw new Error();
    expect(wait.columns).toHaveLength(2);
    const [reply, timeout] = wait.columns;
    const cond = reply.items[0];
    if (cond.kind !== "step") throw new Error();
    expect(cond.columns).toHaveLength(3);
    expect(timeout.items[0]).toMatchObject({ kind: "jump", target: "handoff" });
    expect(orphans).toEqual([]);

    const linked = linkSlot(base, "a", { kind: "next" }, null);
    expect(buildFlow(linked).orphans.map((s) => s.id)).toEqual(["b"]);
  });
});
