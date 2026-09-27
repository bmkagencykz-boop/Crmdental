import { TASK_STATE_FILTER, ME } from "../../../deals/list/dealFilters";
import {
  forecast,
  PLAN_METRICS,
  salesPlanReport,
  type PlanValues,
  type SalesPlan,
} from "../../../reports/salesPlan";
import type { Db } from "./types";

/** Round to a number people would type as a target */
const roundTarget = (value: number, step: number) =>
  Math.max(step, Math.round(value / step) * step);

const STEPS = { new_deals: 1, won_deals: 1, paid_amount: 50_000, visits: 1 };

/**
 * Deal list and sales plan of the demo (stage 21): two clinic filters and a
 * personal one of the owner; this month's targets for the clinic and every
 * active employee, set around their forecast so that some are ahead of the
 * plan and some behind.
 */
export const generateListsPlans = (db: Db) => {
  const service = (name: string) =>
    db.services.find((s) => s.name === name)?.id ?? null;
  const tag = (name: string) => db.tags.find((t) => t.name === name)?.id;

  db.saved_filters = [
    {
      id: 1,
      sales_id: null,
      name: "Имплантация без задач",
      resource: "deals",
      filter: {
        service_id: service("Имплантация"),
        [TASK_STATE_FILTER]: "no_task",
      },
      position: 0,
    },
    {
      id: 2,
      sales_id: null,
      name: "Новые за неделю",
      resource: "deals",
      filter: { "created_at@gte": "$period:week" },
      position: 1,
    },
    {
      id: 3,
      sales_id: 0,
      name: "Мои VIP",
      resource: "deals",
      filter: { sales_id: ME, "tags@cs": `{${tag("VIP") ?? 0}}` },
      position: 0,
    },
  ];

  const report = salesPlanReport({ ...db, sales_plans: [] }, null);
  // Ahead or behind: the target is the forecast times this factor
  const factors = [1.15, 0.9, 1.3, 1.05, 0.8, 1.2];
  const target = (fact: PlanValues | Record<string, number>, factor: number) =>
    Object.fromEntries(
      PLAN_METRICS.map((metric) => [
        metric,
        roundTarget(
          (forecast(
            Number(fact[metric] ?? 0),
            report.days_elapsed,
            report.days_total,
          ) ?? 0) * factor,
          STEPS[metric],
        ),
      ]),
    ) as PlanValues;

  const rows: SalesPlan[] = [
    {
      id: 1,
      month: report.month,
      sales_id: null,
      ...target(report.clinic.fact, 1.1),
    },
    ...report.by_sales
      .filter((row) =>
        db.sales.some((sale) => sale.id === row.id && !sale.disabled),
      )
      .map((row, index) => ({
        id: index + 2,
        month: report.month,
        sales_id: row.id,
        ...target(row.fact, factors[index % factors.length]),
      })),
  ];
  db.sales_plans = rows;
};
