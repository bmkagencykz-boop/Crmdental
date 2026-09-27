import type { Identifier } from "ra-core";

import {
  DEFAULT_TIME_ZONE,
  fromWallClock,
} from "../providers/commons/automessages";
import type { Sale } from "../types";
import { keyStages, localDate, type ReportData } from "./reportMath";

/**
 * Sales plan (stage 21): targets of a month for the clinic and every
 * employee, facts, progress and forecast. salesPlanReport is the TypeScript
 * twin of public.report_sales_plan (supabase/schemas/21_lists_plans.sql) for
 * the demo; the progress and the forecast are computed here for both data
 * providers.
 */

export const PLAN_METRICS = [
  "new_deals",
  "won_deals",
  "paid_amount",
  "visits",
] as const;
export type PlanMetric = (typeof PLAN_METRICS)[number];

/** Targets of a month; null: not set */
export type PlanValues = Record<PlanMetric, number | null>;
export type FactValues = Record<PlanMetric, number>;

export type SalesPlanReport = {
  /** First day of the month, YYYY-MM-DD */
  month: string;
  days_total: number;
  /** Days of the month gone by, today included (0 for a future month) */
  days_elapsed: number;
  clinic: { plan: PlanValues | null; fact: FactValues };
  by_sales: Array<{
    id: Identifier;
    name: string;
    plan: PlanValues | null;
    fact: FactValues;
  }>;
};

/** A row of public.sales_plans */
export type SalesPlan = {
  id?: Identifier;
  organization_id?: Identifier;
  /** First day of the month, YYYY-MM-DD */
  month: string;
  /** null: the clinic */
  sales_id: Identifier | null;
} & PlanValues;

/** What the plan editor saves (public.save_sales_plan) */
export type SalesPlanInput = { sales_id: Identifier | null } & PlanValues;

// --- months ----------------------------------------------------------------------

const pad = (value: number) => String(value).padStart(2, "0");

/** First day (YYYY-MM-DD) of the month of a date or a YYYY-MM[-DD] string */
export const monthOf = (
  value: string | Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
) => {
  const day =
    typeof value === "string" ? value : localDate(value.toISOString(), timeZone);
  return `${day.slice(0, 7)}-01`;
};

/** The first day of the month `delta` months later */
export const shiftMonth = (month: string, delta: number) => {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
};

export const daysInMonth = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
};

/** Days between two YYYY-MM-DD dates */
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

/** Days of the month gone by on `today` (today included), 0..days */
export const daysElapsed = (month: string, today: string) =>
  Math.max(0, Math.min(daysInMonth(month), dayDiff(today, month) + 1));

// --- progress and forecast --------------------------------------------------

/** Fact / target (not capped: 1.2 is 120 %); null without a target */
export const progress = (fact: number, target: number | null | undefined) =>
  target == null || target <= 0 ? null : fact / target;

/**
 * Linear extrapolation of a fact to the end of the month: fact / days gone
 * by * days of the month. The fact itself once the month is over; null
 * before it starts.
 */
export const forecast = (
  fact: number,
  elapsed: number,
  total: number,
): number | null => {
  if (elapsed <= 0) return null;
  if (elapsed >= total) return fact;
  return Math.round((fact / elapsed) * total);
};

/**
 * Targets of the clinic: the clinic's own target of each metric, else the
 * sum of the employees' targets when some are set
 */
export const clinicTargets = (report: SalesPlanReport): PlanValues =>
  Object.fromEntries(
    PLAN_METRICS.map((metric) => {
      const own = report.clinic.plan?.[metric];
      if (own != null) return [metric, own];
      const values = report.by_sales
        .map((row) => row.plan?.[metric])
        .filter((value): value is number => value != null);
      return [
        metric,
        values.length ? values.reduce((sum, v) => sum + v, 0) : null,
      ];
    }),
  ) as PlanValues;

export type MetricProgress = {
  metric: PlanMetric;
  fact: number;
  target: number | null;
  progress: number | null;
  forecast: number | null;
  /** Forecast / target */
  forecastProgress: number | null;
};

export const metricProgress = (
  report: Pick<SalesPlanReport, "days_elapsed" | "days_total">,
  fact: FactValues,
  targets: PlanValues | null,
  metric: PlanMetric,
): MetricProgress => {
  const target = targets?.[metric] ?? null;
  const expected = forecast(
    fact[metric],
    report.days_elapsed,
    report.days_total,
  );
  return {
    metric,
    fact: fact[metric],
    target,
    progress: progress(fact[metric], target),
    forecast: expected,
    forecastProgress: expected == null ? null : progress(expected, target),
  };
};

/** Nothing typed in: the row is removed */
export const isEmptyPlan = (plan: Partial<PlanValues> | null | undefined) =>
  PLAN_METRICS.every((metric) => plan?.[metric] == null);

/** An input of the editor ("12 000", "", "abc") as a target */
export const parseTarget = (value: string): number | null => {
  const digits = value.replace(/[\s ]/g, "");
  if (!digits) return null;
  const number = Number(digits);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
};

// --- the demo twin of public.report_sales_plan -------------------------------------

export type SalesPlanData = Pick<
  ReportData,
  "deals" | "stages" | "deal_events" | "deal_payments" | "sales" | "timeZone"
> & { sales_plans: SalesPlan[] };

const emptyFacts = (): FactValues => ({
  new_deals: 0,
  won_deals: 0,
  paid_amount: 0,
  visits: 0,
});

const planValues = (row: SalesPlan | undefined): PlanValues | null =>
  row
    ? {
        new_deals: row.new_deals ?? null,
        won_deals: row.won_deals ?? null,
        paid_amount: row.paid_amount ?? null,
        visits: row.visits ?? null,
      }
    : null;

/** Same as public.report_sales_plan */
export const salesPlanReport = (
  data: SalesPlanData,
  target: string | null | undefined,
  now = new Date(),
): SalesPlanReport => {
  const timeZone = data.timeZone ?? DEFAULT_TIME_ZONE;
  const today = localDate(now.toISOString(), timeZone);
  const month = monthOf(target ?? today);
  const next = shiftMonth(month, 1);
  const bound = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return fromWallClock(y, m, d, 0, timeZone).getTime();
  };
  const from = bound(month);
  const to = bound(next);
  const inMonth = (value: string | null | undefined) => {
    if (!value) return false;
    const t = new Date(value).getTime();
    return t >= from && t < to;
  };

  const stages = new Map(data.stages.map((s) => [String(s.id), s]));
  const facts = new Map<string, FactValues>();
  const add = (
    salesId: Identifier | null | undefined,
    metric: PlanMetric,
    value: number,
  ) => {
    const key = salesId == null ? "" : String(salesId);
    const row = facts.get(key) ?? emptyFacts();
    row[metric] += value;
    facts.set(key, row);
  };
  const dealsById = new Map(data.deals.map((d) => [String(d.id), d]));
  const eventsByDeal = new Map<string, typeof data.deal_events>();
  for (const event of data.deal_events) {
    if (event.type !== "created" && event.type !== "stage_changed") continue;
    const key = String(event.deal_id);
    eventsByDeal.set(key, [...(eventsByDeal.get(key) ?? []), event]);
  }

  for (const deal of data.deals) {
    if (inMonth(deal.created_at)) add(deal.sales_id, "new_deals", 1);
    const events = eventsByDeal.get(String(deal.id)) ?? [];
    if (
      events.some(
        (event) =>
          stages.get(String(event.to_stage_id))?.kind === "won" &&
          inMonth(event.created_at),
      )
    ) {
      add(deal.sales_id, "won_deals", 1);
    }
    // Visits: the first entry at or past the visit stage of its pipeline
    const visit = keyStages(data.stages, deal.pipeline_id).visit;
    if (visit == null) continue;
    const entries: string[] = [];
    for (const event of events) {
      const stage = stages.get(String(event.to_stage_id));
      if (
        stage &&
        String(stage.pipeline_id) === String(deal.pipeline_id) &&
        stage.kind !== "lost" &&
        stage.position >= visit
      ) {
        entries.push(event.created_at);
      }
    }
    const current = stages.get(String(deal.stage_id));
    if (current && current.kind !== "lost" && current.position >= visit) {
      entries.push(deal.stage_changed_at ?? deal.created_at);
    }
    const first = entries.sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    )[0];
    if (inMonth(first)) add(deal.sales_id, "visits", 1);
  }
  for (const payment of data.deal_payments) {
    const day = String(payment.paid_at).slice(0, 10);
    if (day < month || day >= next) continue;
    const deal = dealsById.get(String(payment.deal_id));
    if (!deal) continue;
    add(deal.sales_id, "paid_amount", Number(payment.amount));
  }

  const plans = data.sales_plans.filter((row) => row.month === month);
  const clinicFact = emptyFacts();
  for (const row of facts.values()) {
    for (const metric of PLAN_METRICS) clinicFact[metric] += row[metric];
  }
  const byOrder = (a: Sale, b: Sale) =>
    (a.last_name ?? "").localeCompare(b.last_name ?? "") ||
    Number(a.id) - Number(b.id);

  return {
    month,
    days_total: daysInMonth(month),
    days_elapsed: daysElapsed(month, today),
    clinic: {
      plan: planValues(plans.find((row) => row.sales_id == null)),
      fact: clinicFact,
    },
    by_sales: [...data.sales]
      .sort(byOrder)
      .map((sale) => {
        const plan = planValues(
          plans.find(
            (row) =>
              row.sales_id != null && String(row.sales_id) === String(sale.id),
          ),
        );
        const fact = facts.get(String(sale.id));
        return {
          sale,
          row: {
            id: sale.id,
            name: `${sale.first_name ?? ""} ${sale.last_name ?? ""}`.trim(),
            plan,
            fact: fact ?? emptyFacts(),
          },
          keep: !sale.disabled || plan != null || fact != null,
        };
      })
      .filter(({ keep }) => keep)
      .map(({ row }) => row),
  };
};

/**
 * The demo twin of public.save_sales_plan: the rows of the month after
 * saving (an empty input removes the plan of that employee)
 */
export const applyPlanInputs = (
  rows: SalesPlan[],
  month: string,
  inputs: SalesPlanInput[],
): { keep: SalesPlan[]; upsert: SalesPlan[]; remove: SalesPlan[] } => {
  const target = monthOf(month);
  const same = (row: SalesPlan, salesId: Identifier | null) =>
    row.month === target &&
    (row.sales_id == null
      ? salesId == null
      : salesId != null && String(row.sales_id) === String(salesId));
  const upsert: SalesPlan[] = [];
  const remove: SalesPlan[] = [];
  for (const input of inputs) {
    for (const metric of PLAN_METRICS) {
      const value = input[metric];
      if (value != null && !(value >= 0)) {
        throw new Error("sales_plan.errors.negative");
      }
    }
    const existing = rows.find((row) => same(row, input.sales_id));
    if (isEmptyPlan(input)) {
      if (existing) remove.push(existing);
      continue;
    }
    upsert.push({
      ...(existing ?? {}),
      month: target,
      sales_id: input.sales_id,
      new_deals: input.new_deals ?? null,
      won_deals: input.won_deals ?? null,
      paid_amount: input.paid_amount ?? null,
      visits: input.visits ?? null,
    });
  }
  const touched = new Set([...upsert, ...remove].map((row) => row.id));
  return {
    keep: rows.filter((row) => row.id == null || !touched.has(row.id)),
    upsert,
    remove,
  };
};
