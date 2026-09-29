import type { Identifier } from "ra-core";

import { addDays, billedOn, overdueDays } from "./labMath";
import type {
  Lab,
  LabFault,
  LabOrder,
  LabOrderCost,
  LabOrderRemake,
  LabPayment,
  LabPaymentAllocation,
  LabQualityReport,
  LabQualityRow,
  LabReconciliation,
  LabReconciliationLine,
  LabWorkType,
  LabWorkTypePrice,
  LabWorkTypeTerm,
} from "./types";

/**
 * Pure rules of the lab module of stage 43, twins of
 * supabase/schemas/43_lab_plus.sql: labPriceOn ↔ private.lab_price_on,
 * addWorkDays ↔ private.lab_add_work_days, proposeDates ↔
 * public.lab_propose_dates, remakeIsPaid ↔ the defaults of
 * private.handle_lab_order_remake_before_write, warrantyUntil ↔ the view
 * lab_orders_summary, labQuality ↔ public.report_lab_quality,
 * labReconciliation ↔ public.report_lab_reconciliation, remakeCosts ↔ the
 * remake rows of public.lab_order_costs. Days are «YYYY-MM-DD».
 */

const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a) === String(b);

/** Mon–Sat: the default working days of a lab */
export const DEFAULT_WORK_WEEKDAYS = [1, 2, 3, 4, 5, 6];

/** ISO weekday of a day: 1 = Monday … 7 = Sunday */
export const isoWeekday = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1;
};

/**
 * The lab price of a work type on a day: the price of that lab effective
 * then, else the default price effective then, else 0
 */
export const labPriceOn = (
  prices: Pick<
    LabWorkTypePrice,
    "work_type_id" | "lab_id" | "effective_from" | "price"
  >[],
  workTypeId: Identifier | null | undefined,
  labId: Identifier | null | undefined,
  day: string,
) => {
  const candidates = prices
    .filter(
      (p) =>
        same(p.work_type_id, workTypeId) &&
        (p.lab_id == null || same(p.lab_id, labId)) &&
        (p.effective_from ?? "2000-01-01") <= day,
    )
    .sort(
      (a, b) =>
        Number(a.lab_id == null) - Number(b.lab_id == null) ||
        (b.effective_from ?? "2000-01-01").localeCompare(
          a.effective_from ?? "2000-01-01",
        ),
    );
  return candidates[0]?.price ?? 0;
};

/** The day `days` working days after `start` (none given: every day) */
export const addWorkDays = (
  start: string,
  days: number | null | undefined,
  weekdays: number[] | null | undefined,
): string | null => {
  if (days == null) return null;
  const open = weekdays?.length ? weekdays : [1, 2, 3, 4, 5, 6, 7];
  let day = start;
  let counted = 0;
  while (counted < days) {
    day = addDays(day, 1);
    if (open.includes(isoWeekday(day))) counted++;
  }
  return day;
};

/**
 * «По срокам»: the fitting and the due date of an order of the lab with
 * these works, from the day it is sent — the longest term of the works,
 * the lab's own terms first, in the lab's working days
 */
export const proposeDates = ({
  lab,
  workTypeIds,
  workTypes,
  terms,
  start,
}: {
  lab?: Pick<Lab, "id" | "work_weekdays"> | null;
  workTypeIds: Identifier[];
  workTypes: Pick<LabWorkType, "id" | "fitting_days" | "ready_days">[];
  terms: Pick<
    LabWorkTypeTerm,
    "lab_id" | "work_type_id" | "fitting_days" | "ready_days"
  >[];
  start: string;
}) => {
  let fitting: number | null = null;
  let ready: number | null = null;
  const max = (a: number | null, b: number | null | undefined) =>
    b == null ? a : a == null ? b : Math.max(a, b);
  for (const id of workTypeIds) {
    const type = workTypes.find((w) => same(w.id, id));
    if (!type) continue;
    const own = lab
      ? terms.find((t) => same(t.lab_id, lab.id) && same(t.work_type_id, id))
      : undefined;
    fitting = max(fitting, own?.fitting_days ?? type.fitting_days);
    ready = max(ready, own?.ready_days ?? type.ready_days);
  }
  const weekdays = lab ? (lab.work_weekdays ?? DEFAULT_WORK_WEEKDAYS) : null;
  return {
    fitting_days: fitting,
    ready_days: ready,
    fitting_at: addWorkDays(start, fitting, weekdays),
    due_at: addWorkDays(start, ready, weekdays),
  };
};

/**
 * A remake is paid when the clinic or the patient is at fault and it is not
 * under the warranty; free for the lab's fault, the warranty, or a fault
 * not known yet
 */
export const remakeIsPaid = (
  fault: LabFault | null | undefined,
  isWarranty: boolean,
) => (fault === "clinic" || fault === "patient") && !isWarranty;

/** «Гарантия до»: the first delivery + the warranty months */
export const warrantyUntil = (
  firstDeliveredAt: string | null | undefined,
  months: number | null | undefined,
): string | null => {
  if (!firstDeliveredAt || !months || months <= 0) return null;
  const [y, m, d] = firstDeliveredAt.slice(0, 10).split("-").map(Number);
  // Like PostgreSQL: the same day months later, clamped to the month end
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(Math.min(d, last))}`;
};

/** Under the warranty on that day (a remake of a delivered order) */
export const inWarranty = (
  firstDeliveredAt: string | null | undefined,
  months: number | null | undefined,
  day: string,
) => {
  const until = warrantyUntil(firstDeliveredAt, months);
  return !!until && day <= until;
};

type CostOrder = Pick<
  LabOrder,
  | "id"
  | "number"
  | "patient_id"
  | "doctor_id"
  | "lab_id"
  | "technician_id"
  | "branch_id"
  | "plan_id"
  | "status"
  | "ready_at"
>;

/**
 * The remake rows of public.lab_order_costs: one per paid remake, the
 * cost of the order's lines again, billed the day it came back
 */
export const remakeCosts = (
  remakes: LabOrderRemake[],
  orders: CostOrder[],
  lineCost: (orderId: Identifier) => number | null,
): LabOrderCost[] =>
  remakes.flatMap((remake) => {
    if (!remake.is_paid) return [];
    const order = orders.find((o) => same(o.id, remake.order_id));
    const amount = lineCost(remake.order_id);
    if (!order || amount == null) return [];
    return [
      {
        id: -Number(remake.id),
        order_id: order.id,
        order_number: order.number,
        patient_id: order.patient_id,
        doctor_id: order.doctor_id ?? null,
        lab_id: order.lab_id ?? null,
        technician_id: order.technician_id ?? null,
        branch_id: order.branch_id ?? null,
        plan_id: order.plan_id ?? null,
        plan_item_id: null,
        work_type_id: null,
        name: `Переделка${remake.reason ? `: ${remake.reason}` : ""}`,
        qty: 1,
        price: amount,
        amount,
        status: order.status,
        ready_at: order.ready_at ?? null,
        month: remake.ready_at ? `${remake.ready_at.slice(0, 7)}-01` : null,
        kind: "remake" as const,
        remake_id: remake.id,
        billed_on: remake.ready_at ?? null,
      },
    ];
  });

type QualityOrder = Pick<
  LabOrder,
  | "id"
  | "lab_id"
  | "technician_id"
  | "doctor_id"
  | "branch_id"
  | "status"
  | "sent_at"
  | "due_at"
  | "first_ready_at"
  | "remake_count"
> & {
  /** The clinic day the order was created */
  created_on: string;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * «Качество» (public.report_lab_quality): per lab, technician and doctor,
 * for a period (both days included) and a branch — orders created and
 * remade, ready (first) and on time, lead time sent → ready, remakes of
 * the period by fault and reason, overdue now, cost billed in the period
 */
export const labQuality = ({
  orders,
  remakes,
  costs,
  from,
  to,
  today,
  branchId = null,
  names,
}: {
  orders: QualityOrder[];
  remakes: Pick<
    LabOrderRemake,
    "order_id" | "reason" | "fault" | "is_warranty" | "occurred_on"
  >[];
  costs: Pick<LabOrderCost, "order_id" | "amount" | "billed_on" | "ready_at">[];
  from: string;
  to: string;
  today: string;
  branchId?: Identifier | null;
  names: {
    labs: Array<{ id: Identifier; name: string }>;
    technicians: Array<{ id: Identifier; name: string }>;
    doctors: Array<{ id: Identifier; name: string }>;
  };
}): LabQualityReport => {
  const inPeriod = (day: string | null | undefined) =>
    !!day && day >= from && day <= to;
  const base = orders.filter(
    (order) => branchId == null || same(order.branch_id, branchId),
  );
  const periodRemakes = remakes.filter((r) => inPeriod(r.occurred_on));
  const periodCosts = costs.filter((c) => inPeriod(billedOn(c)));

  const stats = (
    group: QualityOrder[],
    id: Identifier | null,
    name: string | null,
  ): LabQualityRow => {
    const ids = new Set(group.map((order) => String(order.id)));
    const created = group.filter((order) => inPeriod(order.created_on));
    const ready = group.filter((order) => inPeriod(order.first_ready_at));
    const withDue = ready.filter((order) => order.due_at);
    const onTime = withDue.filter(
      (order) => order.first_ready_at! <= order.due_at!,
    );
    const leads = ready
      .filter((order) => order.sent_at)
      .map(
        (order) =>
          (Date.parse(order.first_ready_at!) - Date.parse(order.sent_at!)) /
          86_400_000,
      );
    const groupRemakes = periodRemakes.filter((r) =>
      ids.has(String(r.order_id)),
    );
    const reasons = new Map<string | null, number>();
    for (const remake of groupRemakes) {
      const key = remake.reason ?? null;
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    const remade = created.filter((order) => order.remake_count > 0).length;
    return {
      id,
      name,
      orders: created.length,
      remade_orders: remade,
      remake_rate: created.length
        ? Math.round((100 * remade) / created.length)
        : null,
      ready: ready.length,
      ready_with_due: withDue.length,
      on_time: onTime.length,
      on_time_pct: withDue.length
        ? Math.round((100 * onTime.length) / withDue.length)
        : null,
      avg_lead_days: leads.length
        ? round1(leads.reduce((sum, lead) => sum + lead, 0) / leads.length)
        : null,
      remakes: groupRemakes.length,
      lab_fault: groupRemakes.filter((r) => r.fault === "lab").length,
      clinic_fault: groupRemakes.filter((r) => r.fault === "clinic").length,
      patient_fault: groupRemakes.filter((r) => r.fault === "patient").length,
      warranty: groupRemakes.filter((r) => r.is_warranty).length,
      reasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort(
          (a, b) =>
            b.count - a.count ||
            (a.reason == null
              ? 1
              : b.reason == null
                ? -1
                : a.reason.localeCompare(b.reason)),
        ),
      overdue_now: group.filter(
        (order) => overdueDays(order.status, order.due_at, today) > 0,
      ).length,
      cost: periodCosts
        .filter((c) => ids.has(String(c.order_id)))
        .reduce((sum, c) => sum + Number(c.amount), 0),
    };
  };

  const byKey = (
    key: "lab_id" | "technician_id" | "doctor_id",
    list: Array<{ id: Identifier; name: string }>,
  ) => {
    const groups = new Map<string, QualityOrder[]>();
    for (const order of base) {
      if (order[key] == null) continue;
      const k = String(order[key]);
      groups.set(k, [...(groups.get(k) ?? []), order]);
    }
    return [...groups.entries()]
      .map(([k, group]) =>
        stats(
          group,
          group[0][key] as Identifier,
          list.find((item) => String(item.id) === k)?.name ?? null,
        ),
      )
      .filter(
        (row) =>
          row.orders > 0 ||
          row.ready > 0 ||
          row.overdue_now > 0 ||
          row.remakes > 0 ||
          row.cost > 0,
      )
      .sort(
        (a, b) =>
          b.orders - a.orders || (a.name ?? "").localeCompare(b.name ?? ""),
      );
  };
  const totals = stats(base, null, null);
  return {
    labs: byKey("lab_id", names.labs),
    technicians: byKey("technician_id", names.technicians),
    doctors: byKey("doctor_id", names.doctors),
    reasons: totals.reasons,
    totals,
  };
};

/**
 * «Акт сверки» (public.report_lab_reconciliation): the opening balance
 * (billed − paid before the period), the works billed and the payments of
 * the period by date, the closing balance
 */
export const labReconciliation = ({
  lab,
  costs,
  payments,
  allocations,
  orderNumbers,
  patientNames,
  from,
  to,
  paidDay,
}: {
  lab: Pick<Lab, "id" | "name">;
  costs: LabOrderCost[];
  payments: Pick<
    LabPayment,
    "id" | "lab_id" | "amount" | "method" | "comment" | "month" | "paid_at"
  >[];
  allocations: Pick<LabPaymentAllocation, "payment_id" | "order_id">[];
  orderNumbers: (orderId: Identifier) => number | null;
  patientNames: (patientId: Identifier) => string | null;
  from: string;
  to: string;
  /** The clinic day of a payment moment */
  paidDay: (paidAt: string) => string;
}): LabReconciliation => {
  const labCosts = costs.filter(
    (c) => same(c.lab_id, lab.id) && billedOn(c) != null,
  );
  const labPayments = payments.filter((p) => same(p.lab_id, lab.id));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const opening =
    sum(labCosts.filter((c) => billedOn(c)! < from).map((c) => c.amount)) -
    sum(
      labPayments.filter((p) => paidDay(p.paid_at) < from).map((p) => p.amount),
    );
  const inPeriod = (day: string) => day >= from && day <= to;
  const periodCosts = labCosts.filter((c) => inPeriod(billedOn(c)!));
  const periodPayments = labPayments.filter((p) =>
    inPeriod(paidDay(p.paid_at)),
  );
  const groups = new Map<string, LabOrderCost[]>();
  for (const cost of periodCosts) {
    const key = `${billedOn(cost)}|${cost.order_id}|${cost.remake_id ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), cost]);
  }
  const lines: Array<LabReconciliationLine & { sort: number; ref: number }> =
    [];
  for (const group of groups.values()) {
    const first = group[0];
    lines.push({
      day: billedOn(first)!,
      kind: first.kind === "remake" ? "remake" : "work",
      order_id: first.order_id,
      number: first.order_number,
      remake_id: first.remake_id ?? null,
      patient_name: patientNames(first.patient_id),
      works: [...group]
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((c) => (c.qty > 1 ? `${c.name} × ${c.qty}` : c.name))
        .join(", "),
      debit: sum(group.map((c) => c.amount)),
      credit: 0,
      sort: 0,
      ref: Number(first.order_id),
    });
  }
  for (const payment of periodPayments) {
    const numbers = allocations
      .filter((a) => same(a.payment_id, payment.id))
      .map((a) => orderNumbers(a.order_id))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b);
    lines.push({
      day: paidDay(payment.paid_at),
      kind: "payment",
      payment_id: payment.id,
      method: payment.method,
      comment: payment.comment ?? null,
      month: payment.month,
      orders: numbers.length ? numbers.map((n) => `№${n}`).join(", ") : null,
      debit: 0,
      credit: payment.amount,
      sort: 1,
      ref: Number(payment.id),
    });
  }
  lines.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.sort - b.sort ||
      (a.number ?? 0) - (b.number ?? 0) ||
      a.ref - b.ref,
  );
  const charged = sum(periodCosts.map((c) => c.amount));
  const paid = sum(periodPayments.map((p) => p.amount));
  return {
    lab_id: lab.id,
    lab_name: lab.name,
    period_from: from,
    period_to: to,
    opening,
    charged,
    paid,
    closing: opening + charged - paid,
    lines: lines.map(({ sort: _sort, ref: _ref, ...line }) => line),
  };
};

/** The balance of each order: cost (lines and paid remakes), allocated, due */
export const orderBalances = (
  costs: Pick<LabOrderCost, "order_id" | "amount">[],
  allocations: Pick<LabPaymentAllocation, "order_id" | "amount">[],
) => {
  const result = new Map<
    string,
    { cost: number; allocated: number; due: number }
  >();
  for (const cost of costs) {
    const key = String(cost.order_id);
    const row = result.get(key) ?? { cost: 0, allocated: 0, due: 0 };
    row.cost += Number(cost.amount);
    result.set(key, row);
  }
  for (const allocation of allocations) {
    const row = result.get(String(allocation.order_id));
    if (row) row.allocated += Number(allocation.amount);
  }
  for (const row of result.values()) row.due = row.cost - row.allocated;
  return result;
};

/**
 * Checks an allocation like private.handle_lab_payment_allocation_before_write:
 * an order of the payment's lab, within the payment and the order's cost.
 * Returns the hint of the error, or null.
 */
export const allocationError = ({
  paymentLabId,
  paymentAmount,
  orderLabId,
  amount,
  allocatedOfPayment,
  allocatedOfOrder,
  orderCost,
}: {
  paymentLabId: Identifier | null | undefined;
  paymentAmount: number;
  orderLabId: Identifier | null | undefined;
  amount: number;
  allocatedOfPayment: number;
  allocatedOfOrder: number;
  orderCost: number;
}) => {
  if (!same(paymentLabId, orderLabId)) return "lab_allocation_lab";
  if (!(amount > 0)) return "lab_allocation_amount";
  if (allocatedOfPayment + amount > paymentAmount)
    return "lab_allocation_over_payment";
  if (allocatedOfOrder + amount > orderCost) return "lab_allocation_over_order";
  return null;
};

/** Periods of the quality tab: the last 30 / 90 days, this / last month */
export type QualityPeriod = "30d" | "90d" | "month" | "last_month";

export const qualityRange = (period: QualityPeriod, today: string) => {
  const monthStart = `${today.slice(0, 7)}-01`;
  if (period === "30d") return { from: addDays(today, -29), to: today };
  if (period === "90d") return { from: addDays(today, -89), to: today };
  if (period === "month") return { from: monthStart, to: today };
  const lastEnd = addDays(monthStart, -1);
  return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
};
