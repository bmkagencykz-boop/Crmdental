import type { Identifier } from "ra-core";

import type { PlanStatus, TreatmentPlan, TreatmentPlanItem } from "./types";

/**
 * Totals of a treatment plan, in whole tenge: the twin of the database
 * (supabase/schemas/29_treatment_plans.sql — the line_total column,
 * private.treatment_plan_total, public.treatment_plans_summary). Rounding is
 * half up, like round() of PostgreSQL on positive numbers; BigInt keeps
 * large sums exact.
 */

/** Percent with two decimals → hundredths of a percent (12.5 → 1250) */
const hundredths = (percent: number | string | null | undefined) =>
  BigInt(Math.round(Number(percent ?? 0) * 100));

const whole = (value: number | string | null | undefined) =>
  BigInt(Math.max(0, Math.round(Number(value ?? 0))));

/** round(value × (10000 − h) / 10000), half up */
const roundDiv = (value: bigint) => Number((value + 5000n) / 10000n);

/** round(quantity × unit price × (100 − discount %) / 100) */
export const lineTotal = (
  quantity: number,
  unitPrice: number,
  discountPercent: number,
) =>
  roundDiv(
    whole(quantity) * whole(unitPrice) * (10000n - hundredths(discountPercent)),
  );

/** The discount of the plan itself: round(subtotal × % / 100) + amount */
export const planDiscount = (
  subtotal: number,
  discountPercent: number,
  discountAmount: number,
) =>
  roundDiv(whole(subtotal) * hundredths(discountPercent)) +
  Number(whole(discountAmount));

/** max(0, subtotal − plan discount): private.treatment_plan_total */
export const planTotal = (
  subtotal: number,
  discountPercent: number,
  discountAmount: number,
) =>
  Math.max(
    0,
    Math.round(subtotal) -
      planDiscount(subtotal, discountPercent, discountAmount),
  );

export type StageTotals = {
  stage_no: number;
  items: TreatmentPlanItem[];
  subtotal: number;
  done: number;
};

export type PlanTotals = {
  /** Σ quantity × price */
  gross: number;
  /** Σ line totals (after the discounts of the items) */
  subtotal: number;
  /** gross − subtotal */
  itemsDiscount: number;
  /** subtotal − total */
  planDiscount: number;
  total: number;
  /** gross − total: every discount */
  discountTotal: number;
  itemsCount: number;
  doneCount: number;
  /** Σ line totals of the done items */
  doneAmount: number;
  stages: StageTotals[];
};

const itemTotal = (item: TreatmentPlanItem) =>
  lineTotal(item.quantity, item.unit_price, item.discount_percent);

export const compareItems = (a: TreatmentPlanItem, b: TreatmentPlanItem) =>
  a.stage_no - b.stage_no ||
  a.position - b.position ||
  Number(a.id) - Number(b.id);

/** Items grouped by stage, stages and items in order */
export const groupByStage = (items: TreatmentPlanItem[]): StageTotals[] => {
  const stages = new Map<number, StageTotals>();
  for (const item of [...items].sort(compareItems)) {
    const stage = stages.get(item.stage_no) ?? {
      stage_no: item.stage_no,
      items: [],
      subtotal: 0,
      done: 0,
    };
    stage.items.push(item);
    stage.subtotal += itemTotal(item);
    if (item.done) stage.done++;
    stages.set(item.stage_no, stage);
  }
  return [...stages.values()];
};

export const planTotals = (
  plan: Pick<TreatmentPlan, "discount_percent" | "discount_amount">,
  items: TreatmentPlanItem[],
): PlanTotals => {
  let gross = 0;
  let subtotal = 0;
  let doneAmount = 0;
  let doneCount = 0;
  for (const item of items) {
    const line = itemTotal(item);
    gross += Math.round(item.quantity) * Math.round(item.unit_price);
    subtotal += line;
    if (item.done) {
      doneCount++;
      doneAmount += line;
    }
  }
  const total = planTotal(
    subtotal,
    plan.discount_percent,
    plan.discount_amount,
  );
  return {
    gross,
    subtotal,
    itemsDiscount: gross - subtotal,
    planDiscount: subtotal - total,
    total,
    discountTotal: gross - total,
    itemsCount: items.length,
    doneCount,
    doneAmount,
    stages: groupByStage(items),
  };
};

/**
 * The status of an agreed plan after its items changed: all done →
 * completed, some done → in progress (private.handle_treatment_item_after_write)
 */
export const statusAfterProgress = (
  status: PlanStatus,
  items: Pick<TreatmentPlanItem, "done">[],
): PlanStatus => {
  if (!["agreed", "in_progress", "completed"].includes(status)) return status;
  const done = items.filter((item) => item.done).length;
  if (items.length > 0 && done === items.length) return "completed";
  if (status === "completed") return "in_progress";
  if (done > 0 && status === "agreed") return "in_progress";
  return status;
};

/**
 * Is a discount above the limit of the clinic? Percent and amount together,
 * against the subtotal (private.check_treatment_discount).
 */
export const discountExceeds = ({
  percent,
  amount = 0,
  subtotal = 0,
  max,
}: {
  percent: number;
  amount?: number;
  subtotal?: number;
  max: number;
}) => percent > max || subtotal * percent + amount * 100 > max * subtotal;

/** Only the owner and the head go beyond the limit and below the price list */
export const canExceedLimits = (role: string | undefined | null) =>
  role === "owner" || role === "head";

/** Balance of a plan: what is left to pay (never negative) */
export const remainingToPay = (total: number, paid: number) =>
  Math.max(0, Math.round(total) - Math.round(paid));

/**
 * Up/down inside a stage: the new positions of the stage's items, or [] at
 * the edge.
 */
export const moveInStage = (
  items: TreatmentPlanItem[],
  id: Identifier,
  direction: -1 | 1,
): { id: Identifier; position: number }[] => {
  const item = items.find((i) => String(i.id) === String(id));
  if (!item) return [];
  const stage = items
    .filter((i) => i.stage_no === item.stage_no)
    .sort(compareItems);
  const index = stage.findIndex((i) => String(i.id) === String(id));
  const target = index + direction;
  if (target < 0 || target >= stage.length) return [];
  const reordered = [...stage];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered
    .map((i, position) => ({ id: i.id, position, before: i.position }))
    .filter((change) => change.position !== change.before)
    .map(({ id, position }) => ({ id, position }));
};

/** The next free position in a stage */
export const nextPosition = (items: TreatmentPlanItem[], stageNo: number) =>
  Math.max(
    -1,
    ...items.filter((i) => i.stage_no === stageNo).map((i) => i.position),
  ) + 1;

/** "Выполнено N из M" is shown for the main plan, else the latest agreed */
export const progressPlan = <
  T extends Pick<TreatmentPlan, "is_main" | "status" | "updated_at">,
>(
  plans: T[],
) =>
  plans.find((plan) => plan.is_main) ??
  plans
    .filter((plan) => ["in_progress", "completed"].includes(plan.status))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

/** "12,5" → 12.5, "5 000 ₸" → 5000; unreadable → fallback */
export const parseNumber = (raw: string, fallback = 0) => {
  const value = Number(raw.replace(/[\s\u00a0₸%]/g, "").replace(",", "."));
  return raw.trim() && Number.isFinite(value) ? value : fallback;
};
