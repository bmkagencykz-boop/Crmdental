import { describe, expect, it } from "vitest";

import {
  canExceedLimits,
  discountExceeds,
  groupByStage,
  lineTotal,
  moveInStage,
  nextPosition,
  planTotal,
  planTotals,
  progressPlan,
  remainingToPay,
  statusAfterProgress,
} from "./planMath";
import type { TreatmentPlanItem } from "./types";

const item = (
  id: number,
  patch: Partial<TreatmentPlanItem> = {},
): TreatmentPlanItem => ({
  id,
  plan_id: 1,
  stage_no: 1,
  name: `Позиция ${id}`,
  quantity: 1,
  unit_price: 0,
  discount_percent: 0,
  done: false,
  position: id,
  ...patch,
});

describe("lineTotal", () => {
  it("is quantity × price minus the discount, whole tenge", () => {
    expect(lineTotal(2, 180_000, 5)).toBe(342_000);
    expect(lineTotal(1, 25_000, 0)).toBe(25_000);
  });

  it("rounds half up like the database (29_treatment_plans test)", () => {
    expect(lineTotal(1, 1001, 50)).toBe(501);
    expect(lineTotal(3, 333, 12.5)).toBe(874);
  });

  it("stays exact for large sums", () => {
    expect(lineTotal(1000, 1_000_000_000, 0.01)).toBe(999_900_000_000);
  });
});

describe("planTotal", () => {
  it("applies the plan percent then the amount", () => {
    expect(planTotal(597_000, 3, 2000)).toBe(577_090);
    expect(planTotal(1001, 12.5, 0)).toBe(876);
  });

  it("is never negative", () => {
    expect(planTotal(1000, 5, 5000)).toBe(0);
  });
});

describe("planTotals", () => {
  const items = [
    item(1, {
      stage_no: 1,
      quantity: 2,
      unit_price: 180_000,
      discount_percent: 5,
      done: true,
    }),
    item(2, { stage_no: 2, quantity: 2, unit_price: 120_000, position: 1 }),
    item(3, { stage_no: 2, quantity: 1, unit_price: 15_000, position: 0 }),
  ];

  it("totals per item, per stage and for the plan (same as the SQL test)", () => {
    const totals = planTotals(
      { discount_percent: 3, discount_amount: 2000 },
      items,
    );
    expect(totals).toMatchObject({
      gross: 615_000,
      subtotal: 597_000,
      itemsDiscount: 18_000,
      planDiscount: 19_910,
      total: 577_090,
      discountTotal: 37_910,
      itemsCount: 3,
      doneCount: 1,
      doneAmount: 342_000,
    });
    expect(
      totals.stages.map((stage) => [stage.stage_no, stage.subtotal]),
    ).toEqual([
      [1, 342_000],
      [2, 255_000],
    ]);
  });

  it("orders the items of a stage by position", () => {
    expect(groupByStage(items)[1].items.map((i) => i.id)).toEqual([3, 2]);
  });
});

describe("statusAfterProgress", () => {
  it("moves an agreed plan along with the done items", () => {
    expect(
      statusAfterProgress("agreed", [{ done: true }, { done: false }]),
    ).toBe("in_progress");
    expect(statusAfterProgress("in_progress", [{ done: true }])).toBe(
      "completed",
    );
    expect(statusAfterProgress("completed", [{ done: false }])).toBe(
      "in_progress",
    );
    expect(statusAfterProgress("agreed", [{ done: false }])).toBe("agreed");
  });

  it("leaves drafts and declined plans alone", () => {
    expect(statusAfterProgress("draft", [{ done: true }])).toBe("draft");
    expect(statusAfterProgress("declined", [{ done: true }])).toBe("declined");
  });
});

describe("discount limit", () => {
  it("counts the percent and the amount against the subtotal", () => {
    expect(discountExceeds({ percent: 10, max: 10 })).toBe(false);
    expect(discountExceeds({ percent: 12, max: 10 })).toBe(true);
    expect(
      discountExceeds({
        percent: 8,
        amount: 100_000,
        subtotal: 400_000,
        max: 10,
      }),
    ).toBe(true);
    expect(
      discountExceeds({
        percent: 5,
        amount: 20_000,
        subtotal: 400_000,
        max: 10,
      }),
    ).toBe(false);
  });

  it("is lifted for the owner and the head", () => {
    expect(canExceedLimits("owner")).toBe(true);
    expect(canExceedLimits("head")).toBe(true);
    expect(canExceedLimits("manager")).toBe(false);
  });
});

describe("helpers", () => {
  it("moves an item up and down inside its stage", () => {
    const items = [
      item(1, { position: 0 }),
      item(2, { position: 1 }),
      item(3, { stage_no: 2, position: 0 }),
    ];
    expect(moveInStage(items, 2, -1)).toEqual([
      { id: 2, position: 0 },
      { id: 1, position: 1 },
    ]);
    expect(moveInStage(items, 1, -1)).toEqual([]);
    expect(moveInStage(items, 3, 1)).toEqual([]);
    expect(nextPosition(items, 1)).toBe(2);
    expect(nextPosition(items, 5)).toBe(0);
  });

  it("computes what is left to pay", () => {
    expect(remainingToPay(577_090, 200_000)).toBe(377_090);
    expect(remainingToPay(100, 300)).toBe(0);
  });

  it("shows the progress of the main plan", () => {
    const plans = [
      {
        id: 1,
        is_main: false,
        status: "completed" as const,
        updated_at: "2026-01-02",
      },
      {
        id: 2,
        is_main: true,
        status: "agreed" as const,
        updated_at: "2026-01-01",
      },
    ];
    expect(progressPlan(plans)?.id).toBe(2);
    expect(progressPlan([plans[0]])?.id).toBe(1);
  });
});
