import { describe, expect, it } from "vitest";

import type { Deal, DealEvent, DealPayment, Sale, Stage } from "../types";
import {
  applyPlanInputs,
  clinicTargets,
  daysElapsed,
  daysInMonth,
  forecast,
  metricProgress,
  monthOf,
  parseTarget,
  progress,
  salesPlanReport,
  shiftMonth,
  type SalesPlan,
  type SalesPlanReport,
} from "./salesPlan";

/*
 * Same clinic as the sales plan part of supabase/tests/021_lists_plans.test.sql,
 * with the same expected facts.
 */

const STAGES: Stage[] = [
  ["Новый лид", "open"],
  ["В работе", "open"],
  ["Записан", "open"],
  ["Пришёл на консультацию", "open"],
  ["План согласован", "open"],
  ["В лечении", "open"],
  ["Лечение завершено", "won"],
  ["Отказ", "lost"],
].map(([name, kind], position) => ({
  id: position + 1,
  pipeline_id: 1,
  name,
  position,
  kind: kind as Stage["kind"],
  color: "#000",
}));
const stage = (name: string) => STAGES.find((s) => s.name === name)!.id;

const sale = (id: number, last_name: string): Sale => ({
  id,
  organization_id: 1,
  first_name: "T",
  last_name,
  role: id === 1 ? "owner" : "manager",
  administrator: id === 1,
  user_id: String(id),
  email: `${id}@clinic.kz`,
});

const deal = (
  id: number,
  sales_id: number | null,
  created_at: string,
  stage_id: number,
  stage_changed_at = created_at,
): Deal => ({
  id,
  name: `p${id}`,
  patient_id: 1,
  pipeline_id: 1,
  stage_id,
  plan_amount: 0,
  paid_amount: 0,
  sales_id,
  tags: [],
  index: 0,
  created_at,
  updated_at: created_at,
  stage_changed_at,
});

let eventId = 0;
const event = (deal_id: number, to: string, created_at: string): DealEvent =>
  ({
    id: ++eventId,
    deal_id,
    type: "stage_changed",
    to_stage_id: stage(to),
    from_stage_id: null,
    changes: {},
    sales_id: null,
    created_at,
  }) as DealEvent;

const payment = (
  id: number,
  deal_id: number,
  amount: number,
  paid_at: string,
): DealPayment =>
  ({ id, deal_id, amount, paid_at, kind: "payment" }) as DealPayment;

const NOW = new Date("2026-09-27T12:00:00Z");

const data = {
  timeZone: "Asia/Almaty",
  stages: STAGES,
  sales: [sale(1, "Owner"), sale(2, "Manager")],
  deals: [
    deal(1, 2, "2026-09-05T05:00:00Z", stage("Лечение завершено"), "2026-09-20T05:00:00Z"),
    deal(2, 2, "2026-09-06T05:00:00Z", stage("Пришёл на консультацию"), "2026-09-12T05:00:00Z"),
    deal(3, 1, "2026-09-07T05:00:00Z", stage("Новый лид")),
    deal(4, null, "2026-09-08T05:00:00Z", stage("Лечение завершено"), "2026-09-09T05:00:00Z"),
    deal(5, 2, "2025-09-05T05:00:00Z", stage("Лечение завершено"), "2025-09-20T05:00:00Z"),
    // 1:00 on September 1st in Almaty: September; 0:30 on October 1st: October
    deal(6, 1, "2026-08-31T20:00:00Z", stage("Новый лид")),
    deal(7, 1, "2026-09-30T19:30:00Z", stage("Новый лид")),
  ],
  deal_events: [
    event(1, "Новый лид", "2026-09-05T05:00:00Z"),
    event(1, "Пришёл на консультацию", "2026-09-10T05:00:00Z"),
    event(1, "Лечение завершено", "2026-09-20T05:00:00Z"),
    event(2, "Новый лид", "2026-09-06T05:00:00Z"),
    event(2, "Пришёл на консультацию", "2026-09-12T05:00:00Z"),
    event(3, "Новый лид", "2026-09-07T05:00:00Z"),
    event(4, "Новый лид", "2026-09-08T05:00:00Z"),
    event(4, "Лечение завершено", "2026-09-09T05:00:00Z"),
    event(5, "Новый лид", "2025-09-05T05:00:00Z"),
    event(5, "Лечение завершено", "2025-09-20T05:00:00Z"),
  ],
  deal_payments: [
    payment(1, 1, 150000, "2026-09-27"),
    payment(2, 4, 50000, "2026-09-27"),
    payment(3, 1, 70000, "2026-08-31"),
  ],
  sales_plans: [
    {
      id: 1,
      month: "2026-09-01",
      sales_id: null,
      new_deals: 10,
      won_deals: 4,
      paid_amount: 1000000,
      visits: 6,
    },
    {
      id: 2,
      month: "2026-09-01",
      sales_id: 2,
      new_deals: 6,
      won_deals: 2,
      paid_amount: 600000,
      visits: null,
    },
    {
      id: 3,
      month: "2026-08-01",
      sales_id: 1,
      new_deals: 1,
      won_deals: null,
      paid_amount: null,
      visits: null,
    },
  ] as SalesPlan[],
};

describe("salesPlanReport (same as public.report_sales_plan)", () => {
  const report = salesPlanReport(data, null, NOW);

  it("reports the current month in the clinic time zone", () => {
    expect(report.month).toBe("2026-09-01");
    expect(report.days_total).toBe(30);
    expect(report.days_elapsed).toBe(27);
  });

  it("computes the clinic facts", () => {
    expect(report.clinic.plan).toEqual({
      new_deals: 10,
      won_deals: 4,
      paid_amount: 1000000,
      visits: 6,
    });
    expect(report.clinic.fact).toEqual({
      new_deals: 5,
      won_deals: 2,
      paid_amount: 200000,
      visits: 3,
    });
  });

  it("computes the facts and plans of the employees", () => {
    expect(report.by_sales).toEqual([
      {
        id: 2,
        name: "T Manager",
        plan: { new_deals: 6, won_deals: 2, paid_amount: 600000, visits: null },
        fact: { new_deals: 2, won_deals: 1, paid_amount: 150000, visits: 2 },
      },
      {
        id: 1,
        name: "T Owner",
        plan: null,
        fact: { new_deals: 2, won_deals: 0, paid_amount: 0, visits: 0 },
      },
    ]);
  });

  it("reports another month", () => {
    const august = salesPlanReport(data, "2026-08-15", NOW);
    expect(august.month).toBe("2026-08-01");
    expect(august.days_elapsed).toBe(31);
    expect(august.clinic.fact.paid_amount).toBe(70000);
    expect(august.by_sales.find((row) => row.id === 1)?.plan?.new_deals).toBe(1);
    const october = salesPlanReport(data, "2026-10-01", NOW);
    expect(october.days_elapsed).toBe(0);
    expect(october.clinic.fact.new_deals).toBe(1);
  });
});

describe("months", () => {
  it("finds the month of a date", () => {
    expect(monthOf("2026-09-27")).toBe("2026-09-01");
    expect(monthOf(new Date("2026-08-31T20:00:00Z"), "Asia/Almaty")).toBe(
      "2026-09-01",
    );
  });

  it("shifts months across years", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
  });

  it("counts the days", () => {
    expect(daysInMonth("2028-02-01")).toBe(29);
    expect(daysElapsed("2026-09-01", "2026-09-01")).toBe(1);
    expect(daysElapsed("2026-09-01", "2026-08-20")).toBe(0);
    expect(daysElapsed("2026-09-01", "2026-11-02")).toBe(30);
  });
});

describe("progress and forecast", () => {
  it("extrapolates linearly to the end of the month", () => {
    expect(forecast(100, 10, 30)).toBe(300);
    expect(forecast(7, 3, 31)).toBe(72);
    expect(forecast(100, 30, 30)).toBe(100);
    expect(forecast(100, 0, 30)).toBeNull();
  });

  it("gives the share of the target", () => {
    expect(progress(50, 200)).toBe(0.25);
    expect(progress(300, 200)).toBe(1.5);
    expect(progress(10, null)).toBeNull();
    expect(progress(10, 0)).toBeNull();
  });

  it("sums the employees' targets when the clinic has none", () => {
    const report: SalesPlanReport = {
      month: "2026-09-01",
      days_total: 30,
      days_elapsed: 10,
      clinic: {
        plan: { new_deals: 20, won_deals: null, paid_amount: null, visits: null },
        fact: { new_deals: 5, won_deals: 1, paid_amount: 100, visits: 0 },
      },
      by_sales: [
        {
          id: 1,
          name: "A",
          plan: { new_deals: 5, won_deals: 2, paid_amount: 100, visits: null },
          fact: { new_deals: 1, won_deals: 1, paid_amount: 100, visits: 0 },
        },
        {
          id: 2,
          name: "B",
          plan: { new_deals: 5, won_deals: 3, paid_amount: null, visits: null },
          fact: { new_deals: 4, won_deals: 0, paid_amount: 0, visits: 0 },
        },
      ],
    };
    const targets = clinicTargets(report);
    expect(targets).toEqual({
      new_deals: 20,
      won_deals: 5,
      paid_amount: 100,
      visits: null,
    });
    expect(
      metricProgress(report, report.clinic.fact, targets, "new_deals"),
    ).toEqual({
      metric: "new_deals",
      fact: 5,
      target: 20,
      progress: 0.25,
      forecast: 15,
      forecastProgress: 0.75,
    });
    expect(
      metricProgress(report, report.clinic.fact, targets, "visits").progress,
    ).toBeNull();
  });
});

describe("plan editor", () => {
  it("parses a target", () => {
    expect(parseTarget("1 200 000")).toBe(1200000);
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("abc")).toBeNull();
    expect(parseTarget("-5")).toBeNull();
  });

  it("updates, creates and removes rows of the month", () => {
    const { keep, upsert, remove } = applyPlanInputs(
      data.sales_plans,
      "2026-09-10",
      [
        {
          sales_id: 2,
          new_deals: 7,
          won_deals: null,
          paid_amount: null,
          visits: null,
        },
        {
          sales_id: 1,
          new_deals: 3,
          won_deals: null,
          paid_amount: null,
          visits: null,
        },
        {
          sales_id: null,
          new_deals: null,
          won_deals: null,
          paid_amount: null,
          visits: null,
        },
      ],
    );
    expect(upsert).toEqual([
      expect.objectContaining({ id: 2, sales_id: 2, new_deals: 7, won_deals: null }),
      expect.objectContaining({ sales_id: 1, month: "2026-09-01", new_deals: 3 }),
    ]);
    expect(upsert[1].id).toBeUndefined();
    expect(remove.map((row) => row.id)).toEqual([1]);
    expect(keep.map((row) => row.id)).toEqual([3]);
  });

  it("refuses a negative target", () => {
    expect(() =>
      applyPlanInputs([], "2026-09-01", [
        {
          sales_id: null,
          new_deals: -1,
          won_deals: null,
          paid_amount: null,
          visits: null,
        },
      ]),
    ).toThrow();
  });
});
