import { describe, expect, it } from "vitest";
import type { Stage } from "../../types";
import {
  applyPipelineMove,
  checkDealStageChange,
  dealChanges,
  normalizePatient,
  normalizePhone,
  pipelineHasClosingStages,
} from "./domain";

const stage = (id: number, kind: Stage["kind"], pipeline_id = 1): Stage => ({
  id,
  pipeline_id,
  kind,
  name: `S${id}`,
  position: id,
  color: "#000",
});
const stages = [
  stage(1, "open"),
  stage(2, "won"),
  stage(3, "lost"),
  stage(4, "open", 2),
  stage(5, "won", 2),
];

describe("normalizePhone (same as the SQL function)", () => {
  it.each([
    ["8 (701) 123-45-67", "+77011234567"],
    ["+7 701 123 45 67", "+77011234567"],
    ["7011234567", "+77011234567"],
    ["+49 30 1234567", "+49301234567"],
    ["", null],
    [null, null],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });
});

describe("normalizePatient", () => {
  it("cleans phones and handles like the database trigger", () => {
    expect(
      normalizePatient({
        phone_jsonb: [{ number: "8 701 123 45 67" }, { number: "" }],
        whatsapp: "87017654321",
        instagram: " @Asel.Dent ",
        telegram: "@asel_tg",
      }),
    ).toMatchObject({
      phone_jsonb: [{ number: "+77011234567" }],
      whatsapp: "+77017654321",
      instagram: "asel.dent",
      telegram: "asel_tg",
      phones: ["+77011234567", "+77017654321"],
    });
  });
});

describe("checkDealStageChange", () => {
  it("accepts a normal move", () => {
    expect(
      checkDealStageChange({
        previous: { stage_id: 1, pipeline_id: 1 },
        next: { stage_id: 2, pipeline_id: 1, lost_reason_id: null },
        stages,
      }),
    ).toEqual({ changed: true, kind: "won" });
  });

  it("requires a reason to lose a deal", () => {
    expect(() =>
      checkDealStageChange({
        next: { stage_id: 3, pipeline_id: 1, lost_reason_id: null },
        stages,
      }),
    ).toThrow("причину отказа");
  });

  it("locks lost deals", () => {
    expect(() =>
      checkDealStageChange({
        previous: { stage_id: 3, pipeline_id: 1 },
        next: { stage_id: 1, pipeline_id: 1, lost_reason_id: 1 },
        stages,
      }),
    ).toThrow("не возвращается");
  });

  it("keeps the stage in the pipeline", () => {
    expect(() =>
      checkDealStageChange({
        next: { stage_id: 4, pipeline_id: 1, lost_reason_id: null },
        stages,
      }),
    ).toThrow("воронке");
  });
});

describe("dealChanges", () => {
  it("lists changed tracked fields with before and after", () => {
    expect(
      dealChanges(
        { plan_amount: 100, index: 1, tags: [1] },
        { plan_amount: 200, index: 5, tags: [1] },
      ),
    ).toEqual({ plan_amount: [100, 200] });
  });
});

describe("pipelineHasClosingStages", () => {
  it("needs a won and a lost stage", () => {
    expect(pipelineHasClosingStages(stages)).toBe(true);
    expect(pipelineHasClosingStages([stage(1, "open"), stage(2, "won")])).toBe(
      false,
    );
  });
});

describe("applyPipelineMove", () => {
  it("puts a deal moved to another pipeline on its first stage", () => {
    expect(
      applyPipelineMove({
        previous: { pipeline_id: 1 },
        next: { pipeline_id: 2, stage_id: 5 },
        stages,
      }),
    ).toEqual({ pipeline_id: 2, stage_id: 4 });
  });

  it("keeps the chosen stage when the clinic allows it", () => {
    expect(
      applyPipelineMove({
        previous: { pipeline_id: 1 },
        next: { pipeline_id: 2, stage_id: 5 },
        stages,
        mode: "choose_stage",
      }),
    ).toEqual({ pipeline_id: 2, stage_id: 5 });
  });

  it("does nothing within the same pipeline", () => {
    expect(
      applyPipelineMove({
        previous: { pipeline_id: 1 },
        next: { pipeline_id: 1, stage_id: 2 },
        stages,
      }),
    ).toEqual({ pipeline_id: 1, stage_id: 2 });
  });
});
