import { describe, expect, it } from "vitest";

import {
  groupByStage,
  planTotals,
  stageStatusAfterProgress,
  stageTotal,
  type StageLike,
} from "./planMath";
import {
  chartMarks,
  extraDiscountData,
  extraDiscountMode,
  itemsFromTemplate,
  linesForTargets,
  nextStagePosition,
  planPaid,
  templateLines,
} from "./planStages";
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

const stage = (id: number, patch: Partial<StageLike> = {}): StageLike => ({
  id,
  position: id,
  status: "new",
  discount_percent: 0,
  ...patch,
});

// The plan of supabase/tests/034_plan_editor.test.sql
const stages = [
  stage(1, { discount_percent: 5 }),
  stage(2),
  stage(3),
  stage(4, { status: "cancelled" }),
];
const items = [
  item(1, {
    stage_id: 1,
    tooth: "16",
    quantity: 2,
    unit_price: 25_000,
    discount_percent: 10,
  }),
  item(2, {
    stage_id: 1,
    tooth: "17",
    quantity: 2,
    unit_price: 25_000,
    discount_percent: 10,
  }),
  item(3, { stage_id: 2, stage_no: 2, tooth: "36", unit_price: 100_000 }),
  item(4, { stage_id: 3, stage_no: 3, tooth: "36", unit_price: 60_000 }),
  item(5, { stage_id: 4, stage_no: 4, unit_price: 999 }),
];

describe("stage totals (twin of 34_plan_editor.sql)", () => {
  it("applies the stage discount to the sum of the lines", () => {
    expect(stageTotal(90_000, 5)).toBe(85_500);
    expect(stageTotal(1001, 12.5)).toBe(876);
    expect(stageTotal(1000, 0)).toBe(1000);
  });

  it("keeps every stage, even an empty one, in order", () => {
    const groups = groupByStage([items[2]], [stage(2), stage(1)]);
    expect(groups.map((g) => [g.stage_no, g.items.length])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it("counts the stage discounts and leaves the cancelled stages aside", () => {
    const totals = planTotals(
      { discount_percent: 0, discount_amount: 0 },
      items,
      stages,
    );
    expect(totals.stages.map((g) => [g.subtotal, g.total])).toEqual([
      [90_000, 85_500],
      [100_000, 100_000],
      [60_000, 60_000],
      [999, 999],
    ]);
    expect(totals.gross).toBe(260_000);
    expect(totals.subtotal).toBe(245_500);
    expect(totals.stagesDiscount).toBe(14_500);
    expect(totals.itemsDiscount).toBe(10_000);
    expect(totals.stageDiscount).toBe(4_500);
    expect(totals.itemsCount).toBe(4);
    expect(totals.total).toBe(245_500);
  });

  it("then the extra discount, in percent or in tenge", () => {
    const percent = planTotals(
      { discount_percent: 10, discount_amount: 0 },
      items,
      stages,
    );
    expect(percent.planDiscount).toBe(24_550);
    expect(percent.total).toBe(220_950);
    expect(percent.discountTotal).toBe(39_050);
    const amount = planTotals(
      { discount_percent: 0, discount_amount: 5_500 },
      items,
      stages,
    );
    expect(amount.planDiscount).toBe(5_500);
    expect(amount.total).toBe(240_000);
  });

  it("follows the items of a stage", () => {
    expect(
      stageStatusAfterProgress("new", [{ done: true }, { done: false }]),
    ).toBe("in_progress");
    expect(stageStatusAfterProgress("in_progress", [{ done: true }])).toBe(
      "done",
    );
    expect(stageStatusAfterProgress("done", [{ done: false }])).toBe(
      "in_progress",
    );
    expect(stageStatusAfterProgress("cancelled", [{ done: true }])).toBe(
      "cancelled",
    );
    expect(stageStatusAfterProgress("new", [])).toBe("new");
  });
});

describe("the extra discount", () => {
  it("is in tenge only when only the amount is set", () => {
    expect(extraDiscountMode({ discount_percent: 0, discount_amount: 0 })).toBe(
      "percent",
    );
    expect(
      extraDiscountMode({ discount_percent: 0, discount_amount: 500 }),
    ).toBe("amount");
    expect(
      extraDiscountMode({ discount_percent: 5, discount_amount: 500 }),
    ).toBe("percent");
  });

  it("clears the other mode", () => {
    expect(extraDiscountData("percent", 12.5)).toEqual({
      discount_percent: 12.5,
      discount_amount: 0,
    });
    expect(extraDiscountData("amount", 5000.4)).toEqual({
      discount_percent: 0,
      discount_amount: 5000,
    });
    expect(extraDiscountData("percent", 150).discount_percent).toBe(100);
  });
});

describe("lines for the teeth of the chart", () => {
  it("adds one line per tooth, or one line without a tooth", () => {
    const service = { id: 7, name: "Лечение кариеса", price: 25_000 };
    const lines = linesForTargets({
      planId: 1,
      stage: { id: 3, position: 2 },
      service,
      name: "",
      targets: ["16", "Верхняя челюсть"],
      startPosition: 4,
    });
    expect(
      lines.map((l) => [
        l.tooth,
        l.position,
        l.unit_price,
        l.stage_id,
        l.stage_no,
      ]),
    ).toEqual([
      ["16", 4, 25_000, 3, 2],
      ["Верхняя челюсть", 5, 25_000, 3, 2],
    ]);
    const custom = linesForTargets({
      planId: 1,
      stage: { id: 3, position: 2 },
      name: "Своя позиция",
      targets: [],
      startPosition: 0,
    });
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({
      tooth: null,
      name: "Своя позиция",
      unit_price: 0,
    });
  });

  it("marks the teeth and the areas of the stage", () => {
    const marks = chartMarks([
      { tooth: "36", name: "Имплант", done: false },
      { tooth: "36, 37", name: "Коронка", done: true },
      { tooth: "Нижняя челюсть", name: "Брекеты", done: false },
      { tooth: null, name: "Снимок", done: false },
    ]);
    expect(marks.teeth[36]).toEqual({
      tone: "neon",
      title: "Имплант, Коронка",
    });
    expect(marks.teeth[37]).toEqual({ tone: "done", title: "Коронка" });
    expect(Object.keys(marks.teeth)).toEqual(["36", "37"]);
    expect(marks.areas.lower).toEqual({ tone: "neon", title: "Брекеты" });
  });
});

describe("stage templates", () => {
  it("drops the teeth and merges identical lines", () => {
    const lines = templateLines([
      item(1, {
        service_id: 7,
        name: "Кариес",
        tooth: "16",
        quantity: 2,
        unit_price: 25_000,
        discount_percent: 10,
        position: 0,
      }),
      item(2, {
        service_id: 9,
        name: "Снимок",
        tooth: null,
        unit_price: 2_500,
        position: 1,
      }),
      item(3, {
        service_id: 7,
        name: "Кариес",
        tooth: "17",
        quantity: 2,
        unit_price: 25_000,
        discount_percent: 10,
        position: 2,
      }),
    ]);
    expect(lines).toEqual([
      {
        service_id: 7,
        name: "Кариес",
        quantity: 4,
        unit_price: 25_000,
        discount_percent: 10,
      },
      {
        service_id: 9,
        name: "Снимок",
        quantity: 1,
        unit_price: 2_500,
        discount_percent: 0,
      },
    ]);
  });

  it("takes the current prices of the price list", () => {
    const lines = itemsFromTemplate(
      {
        items: [
          {
            service_id: 7,
            name: "Кариес",
            quantity: 4,
            unit_price: 25_000,
            discount_percent: 10,
          },
          {
            service_id: 8,
            name: "Старая услуга",
            quantity: 1,
            unit_price: 9_000,
            discount_percent: 0,
          },
          {
            service_id: null,
            name: "Своя",
            quantity: 0,
            unit_price: 100,
            discount_percent: 0,
          },
        ],
      },
      [
        { id: 7, name: "Кариес", price: 30_000, is_archived: false },
        { id: 8, name: "Старая услуга", price: 12_000, is_archived: true },
      ],
    );
    expect(
      lines.map((l) => [l.name, l.quantity, l.unit_price, l.discount_percent]),
    ).toEqual([
      ["Кариес", 4, 30_000, 10],
      ["Старая услуга", 1, 9_000, 0],
      ["Своя", 1, 100, 0],
    ]);
  });
});

describe("the rest", () => {
  it("numbers a new stage", () => {
    expect(nextStagePosition([])).toBe(1);
    expect(nextStagePosition([{ position: 1 }, { position: 3 }])).toBe(4);
  });

  it("reads «Оплачено» from the plan, else from the deal", () => {
    expect(planPaid({ paid_amount: 50_000, deal_paid_amount: 1 })).toBe(50_000);
    expect(planPaid({ deal_paid_amount: 7_000 })).toBe(7_000);
    expect(planPaid({})).toBe(0);
  });
});
