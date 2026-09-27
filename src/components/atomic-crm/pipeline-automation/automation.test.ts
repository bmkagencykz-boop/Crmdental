import { describe, expect, it } from "vitest";

import type { Stage } from "../types";
import {
  automationColumns,
  cleanTrigger,
  delayedEventKey,
  describeRun,
  eventKey,
  lastActivityAt,
  missingTriggerFields,
  splitMinutes,
  toMinutes,
  triggerMatches,
} from "./automation";
import type { StageTrigger } from "./types";

const noConditions = {
  source_ids: [],
  service_ids: [],
  doctor_ids: [],
  sales_ids: [],
  tags_present: [],
  tags_absent: [],
};

const trigger = (data: Partial<StageTrigger>): StageTrigger => ({
  id: 1,
  stage_id: 1,
  event: "message_in",
  delay_minutes: 0,
  action: "move_stage",
  target_stage_id: 2,
  is_active: true,
  position: 0,
  ...noConditions,
  ...data,
});

describe("triggerMatches", () => {
  const deal = {
    source_id: 1,
    service_id: 2,
    doctor_id: 3,
    sales_id: 4,
    tags: [10, 11],
  };

  it("matches anything without conditions", () => {
    expect(triggerMatches(noConditions, deal)).toBe(true);
  });

  it("needs every non-empty list to contain the deal's value", () => {
    expect(
      triggerMatches(
        {
          ...noConditions,
          source_ids: [1, 5],
          service_ids: [2],
          doctor_ids: [3],
          sales_ids: ["4"],
        },
        deal,
      ),
    ).toBe(true);
    expect(triggerMatches({ ...noConditions, source_ids: [5] }, deal)).toBe(
      false,
    );
    expect(
      triggerMatches(
        { ...noConditions, doctor_ids: [3] },
        {
          ...deal,
          doctor_id: null,
        },
      ),
    ).toBe(false);
  });

  it("tags: all the required ones, none of the excluded ones", () => {
    expect(
      triggerMatches({ ...noConditions, tags_present: [10, 11] }, deal),
    ).toBe(true);
    expect(
      triggerMatches({ ...noConditions, tags_present: [10, 12] }, deal),
    ).toBe(false);
    expect(triggerMatches({ ...noConditions, tags_absent: [11] }, deal)).toBe(
      false,
    );
    expect(triggerMatches({ ...noConditions, tags_absent: [12] }, deal)).toBe(
      true,
    );
  });
});

describe("missingTriggerFields", () => {
  it("mirrors the checks of the database", () => {
    expect(missingTriggerFields(trigger({}))).toEqual([]);
    expect(missingTriggerFields(trigger({ target_stage_id: 1 }))).toEqual([
      "target_stage_id",
    ]);
    expect(
      missingTriggerFields(trigger({ event: "idle", delay_minutes: 0 })),
    ).toEqual(["delay_minutes"]);
    expect(
      missingTriggerFields(trigger({ action: "create_task", task_text: " " })),
    ).toEqual(["task_text"]);
    expect(missingTriggerFields(trigger({ action: "add_tag" }))).toEqual([
      "tag_id",
    ]);
    expect(
      missingTriggerFields(trigger({ action: "set_field", field_name: null })),
    ).toEqual(["field_name"]);
    expect(
      missingTriggerFields(
        trigger({
          action: "set_field",
          field_name: "plan_amount",
          plan_amount: 0,
        }),
      ),
    ).toEqual([]);
    expect(
      missingTriggerFields(trigger({ action: "set_responsible" })),
    ).toEqual([]);
  });
});

describe("cleanTrigger", () => {
  it("keeps the columns of the chosen action only", () => {
    const cleaned = cleanTrigger(
      trigger({
        action: "create_task",
        target_stage_id: 2,
        tag_id: 5,
        task_text: "  Перезвонить ",
      }),
    );
    expect(cleaned).toMatchObject({
      action: "create_task",
      target_stage_id: null,
      tag_id: null,
      task_text: "Перезвонить",
      task_type: "call",
      task_due_minutes: 0,
    });
  });

  it("clears the delay of an immediate event, the other field values", () => {
    expect(
      cleanTrigger(
        trigger({
          event: "stage_entered",
          delay_minutes: 60,
          action: "set_field",
          field_name: "doctor_id",
          doctor_id: 3,
          plan_amount: 100,
        }),
      ),
    ).toMatchObject({ delay_minutes: 0, doctor_id: 3, plan_amount: null });
    expect(
      cleanTrigger(trigger({ action: "send_template", template_id: 1 })),
    ).toMatchObject({ message_mode: "auto", template_id: 1 });
  });
});

describe("automationColumns", () => {
  it("groups the rules and triggers per stage of the pipeline", () => {
    const stages: Stage[] = [
      {
        id: 2,
        pipeline_id: 1,
        name: "В работе",
        position: 1,
        color: "",
        kind: "open",
      },
      {
        id: 1,
        pipeline_id: 1,
        name: "Новый лид",
        position: 0,
        color: "",
        kind: "open",
      },
      {
        id: 9,
        pipeline_id: 2,
        name: "Другая",
        position: 0,
        color: "",
        kind: "open",
      },
    ] as Stage[];
    const columns = automationColumns({
      stages,
      pipelineId: 1,
      taskRules: [
        { id: 1, event: "deal_created", stage_id: null } as never,
        { id: 2, event: "stage_entered", stage_id: 2, position: 0 } as never,
      ],
      automessageRules: [{ id: 3, stage_id: 1, position: 0 } as never],
      triggers: [
        trigger({ id: 5, stage_id: 1, position: 1 }),
        trigger({ id: 4, stage_id: 1, position: 0 }),
        trigger({ id: 6, stage_id: 9 }),
      ],
    });
    expect(columns.map((c) => c.stage.name)).toEqual(["Новый лид", "В работе"]);
    expect(columns[0].triggers.map((t) => t.id)).toEqual([4, 5]);
    expect(columns[0].automessageRules.map((r) => r.id)).toEqual([3]);
    expect(columns[1].taskRules.map((r) => r.id)).toEqual([2]);
  });
});

describe("delayed events", () => {
  it("last activity: the latest message, note, call or done task", () => {
    expect(
      lastActivityAt({
        deal: {
          id: 1,
          stage_changed_at: "2026-10-01T08:00:00Z",
          created_at: "2026-09-01T08:00:00Z",
        },
        messages: [
          { deal_id: 1, sent_at: "2026-10-01T09:00:00Z" },
          { deal_id: 2, sent_at: "2026-10-02T09:00:00Z" },
        ],
        notes: [{ deal_id: 1, date: "2026-10-01T10:00:00Z" }],
        tasks: [{ deal_id: 1, done_date: null }],
      }),
    ).toBe("2026-10-01T10:00:00Z");
  });

  it("is due after the delay, with the key of the quiet period", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(
      delayedEventKey(
        { event: "idle", delay_minutes: 120 },
        {},
        "2026-10-01T10:00:00Z",
        now,
      ),
    ).toBe(eventKey("idle", "2026-10-01T10:00:00Z"));
    expect(
      delayedEventKey(
        { event: "idle", delay_minutes: 121 },
        {},
        "2026-10-01T10:00:00Z",
        now,
      ),
    ).toBeNull();
    expect(
      delayedEventKey(
        { event: "visit_passed", delay_minutes: 60 },
        { appointment_at: "2026-10-01T10:30:00Z" },
        "2026-10-01T00:00:00Z",
        now,
      ),
    ).toBe("visit:1790850600");
    expect(
      delayedEventKey(
        { event: "visit_passed", delay_minutes: 60 },
        { appointment_at: null },
        "2026-10-01T00:00:00Z",
        now,
      ),
    ).toBeNull();
  });

  it("event keys", () => {
    expect(eventKey("message_in", 15)).toBe("message:15");
    expect(eventKey("stage_entered", "2026-10-01T10:30:00Z", 3)).toBe(
      "stage:3:1790850600",
    );
  });

  it("delays in minutes, hours, days", () => {
    expect(splitMinutes(120)).toEqual({ amount: 2, unit: "hours" });
    expect(splitMinutes(2 * 24 * 60)).toEqual({ amount: 2, unit: "days" });
    expect(splitMinutes(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(toMinutes(3, "days")).toBe(4320);
  });
});

describe("describeRun", () => {
  const translate = (key: string, options: Record<string, unknown> = {}) =>
    `${key}(${Object.entries(options)
      .map(([k, v]) => `${k}=${v}`)
      .join(",")})`;
  const lookups = {
    stageName: (id: unknown) => (id === 2 ? "В работе" : undefined),
    salesName: () => "Иванов",
    tagName: () => "VIP",
    templateName: () => "Приветствие",
    fieldValue: (_field: unknown, value: unknown) => String(value),
  };

  it("describes a move with the rule", () => {
    expect(
      describeRun(
        {
          action: "move_stage",
          status: "done",
          details: { from_stage_id: 1, to_stage_id: 2 },
          trigger_name: "Ответил пациент",
        },
        lookups,
        translate,
      ),
    ).toBe(
      "pipeline_automation.feed.done(what=pipeline_automation.feed.move_stage(stage=В работе),rule=pipeline_automation.feed.rule(name=Ответил пациент))",
    );
  });

  it("gives the reason of a skipped run", () => {
    expect(
      describeRun(
        {
          action: "move_stage",
          status: "skipped",
          details: {},
          error: "Выполните чек-лист этапа «В работе»",
          trigger_name: null,
        },
        lookups,
        translate,
      ),
    ).toContain("error=Выполните чек-лист этапа «В работе»");
  });
});
