import type { Identifier } from "ra-core";

import { lineTotal, planTotal } from "../treatment/planMath";
import type { TreatmentPlan, TreatmentPlanItem } from "../treatment/types";
import {
  PAYMENT_METHODS,
  type AccountOperation,
  type MethodPart,
  type OperationKind,
  type PaymentMethod,
} from "./types";

/**
 * Money math of the patient account and the cash desk, in whole tenge: the
 * twin of supabase/schemas/36_payments.sql (the generated columns of
 * account_operations, private.operation_method_amount,
 * private.plan_done_charge, private.cash_shift_expected, the views
 * patient_accounts and treatment_plan_payments, the checks of
 * private.handle_account_operation_before_write).
 */

type OperationLike = Pick<
  AccountOperation,
  "kind" | "account" | "method" | "amount"
> & { parts?: MethodPart[] | null };

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** "12 500", "12 500 ₸" → 12500; unreadable or empty → 0 */
export const parseAmount = (raw: string | number | null | undefined) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const value = Number(
    String(raw ?? "")
      .replace(/[\s ₸]/g, "")
      .replace(",", "."),
  );
  return Number.isFinite(value) ? Math.round(value) : 0;
};

/**
 * The fixed account and method of a kind (the trigger sets them): a payment
 * and a payment from the deposit pay the services, a deposit goes on the
 * deposit, a payment from the deposit is paid by «deposit», a correction
 * moves no money («other»).
 */
export const normalizeOperation = <T extends OperationLike>(op: T): T => {
  const next = { ...op };
  if (next.kind === "payment") next.account = "services";
  else if (next.kind === "deposit") next.account = "deposit";
  else if (next.kind === "deposit_payment") {
    next.account = "services";
    next.method = "deposit";
  } else if (next.kind === "correction") next.method = "other";
  if (next.method !== "mixed") next.parts = null;
  return next;
};

/** The effect of an operation: on the deposit, the paid services, the till */
export const operationDeltas = ({
  kind,
  account,
  method,
  amount,
}: OperationLike) => {
  const deposit =
    kind === "deposit"
      ? amount
      : kind === "deposit_payment"
        ? -amount
        : kind === "refund" && account === "deposit"
          ? -amount
          : kind === "refund" && method === "deposit"
            ? amount
            : kind === "correction" && account === "deposit"
              ? amount
              : 0;
  const paid =
    kind === "payment" || kind === "deposit_payment"
      ? amount
      : kind === "refund" && account === "services"
        ? -amount
        : kind === "correction" && account === "services"
          ? amount
          : 0;
  const till =
    method === "deposit" || kind === "correction"
      ? 0
      : kind === "payment" || kind === "deposit"
        ? amount
        : kind === "refund"
          ? -amount
          : 0;
  return { deposit, paid, till };
};

/** An operation with its generated columns, as the database returns it */
export const withDeltas = <T extends OperationLike>(op: T) => {
  const { deposit, paid, till } = operationDeltas(op);
  return {
    ...op,
    deposit_delta: deposit,
    paid_delta: paid,
    till_delta: till,
  };
};

/** The part paid with one method (mixed payments split in parts) */
export const methodAmount = (op: OperationLike, target: PaymentMethod) => {
  if (op.method === "mixed") {
    return (op.parts ?? [])
      .filter((part) => part.method === target)
      .reduce((sum, part) => sum + Number(part.amount), 0);
  }
  return op.method === target ? Math.abs(op.amount) : 0;
};

/** The real methods of an operation with their amounts */
export const methodParts = (op: OperationLike): MethodPart[] =>
  op.method === "mixed"
    ? (op.parts ?? [])
    : PAYMENT_METHODS.includes(op.method as PaymentMethod)
      ? [{ method: op.method as PaymentMethod, amount: Math.abs(op.amount) }]
      : [];

/**
 * What a mixed payment is missing: the amount minus the parts (negative:
 * the parts are too much)
 */
export const partsRemainder = (amount: number, parts: MethodPart[]) =>
  Math.round(amount) -
  parts.reduce((sum, part) => sum + Math.round(Number(part.amount) || 0), 0);

/** Why the parts of a mixed payment are refused, or null */
export const checkParts = (
  amount: number,
  parts: MethodPart[] | null | undefined,
): string | null => {
  if (!parts || parts.length < 2) return "payments.errors.parts_count";
  for (const part of parts) {
    if (
      !PAYMENT_METHODS.includes(part.method) ||
      !(Number(part.amount) > 0) ||
      !Number.isInteger(Number(part.amount))
    ) {
      return "payments.errors.part_invalid";
    }
  }
  return partsRemainder(Math.abs(amount), parts) === 0
    ? null
    : "payments.errors.parts_sum";
};

/**
 * The change for cash: cash received minus the cash part; null when there
 * is no cash or nothing was given. Negative: not enough cash.
 */
export const changeDue = (
  op: OperationLike,
  cashReceived: number | null | undefined,
) => {
  const cash = methodAmount(op, "cash");
  if (!cash || cashReceived == null || !Number.isFinite(cashReceived)) {
    return null;
  }
  return Math.round(cashReceived) - cash;
};

/** The value of the done items of a plan, with the plan discount pro rata */
export const planDoneCharge = (
  subtotal: number,
  doneSubtotal: number,
  discountPercent: number,
  discountAmount: number,
) => {
  if (subtotal <= 0 || doneSubtotal <= 0) return 0;
  const total = planTotal(subtotal, discountPercent, discountAmount);
  if (doneSubtotal >= subtotal) return total;
  return Math.round((doneSubtotal * total) / subtotal);
};

type PlanLike = Pick<
  TreatmentPlan,
  | "id"
  | "deal_id"
  | "patient_id"
  | "status"
  | "is_main"
  | "discount_percent"
  | "discount_amount"
>;
type ItemLike = Pick<
  TreatmentPlanItem,
  "plan_id" | "quantity" | "unit_price" | "discount_percent" | "done"
> & { line_total?: number };

const itemTotal = (item: ItemLike) =>
  item.line_total ??
  lineTotal(item.quantity, item.unit_price, item.discount_percent);

/** Total and done value of a plan */
export const planCharges = (plan: PlanLike, items: ItemLike[]) => {
  const own = items.filter((item) => same(item.plan_id, plan.id));
  const subtotal = own.reduce((sum, item) => sum + itemTotal(item), 0);
  const doneSubtotal = own
    .filter((item) => item.done)
    .reduce((sum, item) => sum + itemTotal(item), 0);
  return {
    total: planTotal(
      subtotal,
      Number(plan.discount_percent),
      Number(plan.discount_amount),
    ),
    done: planDoneCharge(
      subtotal,
      doneSubtotal,
      Number(plan.discount_percent),
      Number(plan.discount_amount),
    ),
  };
};

type VisitLike = {
  patient_id: Identifier;
  deal_id?: Identifier | null;
  service_id?: Identifier | null;
  status: string;
  source?: string;
};
type ServiceLike = { id: Identifier; price?: number | null };

/**
 * The services done for a patient: the done items of the plans (not
 * declined), the completed visits of the CRM with a priced service whose
 * deal has no treatment plan
 */
export const patientCharged = ({
  patientId,
  plans,
  items,
  visits,
  services,
}: {
  patientId: Identifier;
  plans: PlanLike[];
  items: ItemLike[];
  visits: VisitLike[];
  services: ServiceLike[];
}) => {
  const own = plans.filter(
    (plan) => same(plan.patient_id, patientId) && plan.status !== "declined",
  );
  const fromPlans = own.reduce(
    (sum, plan) => sum + planCharges(plan, items).done,
    0,
  );
  const fromVisits = visits
    .filter(
      (visit) =>
        same(visit.patient_id, patientId) &&
        visit.status === "completed" &&
        (visit.source ?? "crm") === "crm" &&
        !plans.some(
          (plan) => same(plan.deal_id, visit.deal_id) && plan.status !== "declined",
        ),
    )
    .reduce((sum, visit) => {
      const price = Number(
        services.find((service) => same(service.id, visit.service_id))?.price ??
          0,
      );
      return price > 0 ? sum + Math.round(price) : sum;
    }, 0);
  return fromPlans + fromVisits;
};

/** deposit, paid, charged, debt, advance, balance of an account */
export const accountTotals = (ops: OperationLike[], charged: number) => {
  let deposit = 0;
  let paid = 0;
  for (const op of ops) {
    const deltas = operationDeltas(op);
    deposit += deltas.deposit;
    paid += deltas.paid;
  }
  return {
    deposit,
    paid,
    charged,
    debt: Math.max(0, charged - paid),
    advance: Math.max(0, paid - charged),
    balance: deposit + paid - charged,
  };
};

/**
 * The paid amount of a plan: its operations and, for the main plan of the
 * deal, the operations of the deal without a plan (plan_paid_amount)
 */
export const planPaid = (
  plan: Pick<TreatmentPlan, "id" | "deal_id" | "is_main">,
  ops: (OperationLike & {
    deal_id?: Identifier | null;
    plan_id?: Identifier | null;
  })[],
) =>
  ops
    .filter(
      (op) =>
        same(op.plan_id, plan.id) ||
        (plan.is_main && op.plan_id == null && same(op.deal_id, plan.deal_id)),
    )
    .reduce((sum, op) => sum + operationDeltas(op).paid, 0);

/** Cash expected in the till of a shift: at start + cash in − cash out */
export const shiftExpected = (openingCash: number, ops: OperationLike[]) =>
  ops.reduce((sum, op) => {
    const till = operationDeltas(op).till;
    return till === 0 ? sum : sum + Math.sign(till) * methodAmount(op, "cash");
  }, Math.round(openingCash));

export type MethodTotals = {
  income: number;
  refunds: number;
  net: number;
  count: number;
};

/**
 * Money in and out of the till by method (report_cash_methods): payments
 * and deposits in, refunds out; payments from the deposit, refunds to the
 * deposit and corrections move no money
 */
export const tillTotals = (ops: OperationLike[]) => {
  const byMethod = Object.fromEntries(
    PAYMENT_METHODS.map((method) => [
      method,
      { income: 0, refunds: 0, net: 0, count: 0 },
    ]),
  ) as Record<PaymentMethod, MethodTotals>;
  const total: MethodTotals = { income: 0, refunds: 0, net: 0, count: 0 };
  for (const op of ops) {
    const till = operationDeltas(op).till;
    if (till === 0) continue;
    total.count++;
    for (const part of methodParts(op)) {
      const line = byMethod[part.method];
      if (till > 0) line.income += part.amount;
      else line.refunds += part.amount;
      line.count++;
    }
    if (till > 0) total.income += Math.abs(till);
    else total.refunds += Math.abs(till);
  }
  for (const line of [...Object.values(byMethod), total]) {
    line.net = line.income - line.refunds;
  }
  return { byMethod, total };
};

/** Operations that only the owner / the head may write */
export const kindNeedsRole = (kind: OperationKind) =>
  kind === "correction"
    ? ["owner"]
    : kind === "refund"
      ? ["owner", "head"]
      : ["owner", "head", "manager"];

/**
 * Why an operation is refused (the checks of the trigger), or null.
 * `deposit`: the patient's deposit now; `paid`: what is paid for the
 * services (of the deal when the operation has one).
 */
export const checkOperation = (
  input: OperationLike & { cash_received?: number | null },
  { deposit, paid }: { deposit: number; paid: number },
): string | null => {
  const op = normalizeOperation(input);
  if (op.kind === "correction" ? !op.amount : !(op.amount > 0)) {
    return "payments.errors.amount";
  }
  if (!Number.isInteger(op.amount)) return "payments.errors.amount";
  if (op.kind === "payment" && op.method === "deposit") {
    return "payments.errors.method";
  }
  if (op.kind === "deposit" && ["deposit", "other"].includes(op.method)) {
    return "payments.errors.method";
  }
  if (
    op.kind === "refund" &&
    op.account === "deposit" &&
    op.method === "deposit"
  ) {
    return "payments.errors.method";
  }
  if (op.method === "mixed") {
    const problem = checkParts(op.amount, op.parts);
    if (problem) return problem;
  }
  const change = changeDue(op, input.cash_received);
  if (
    (op.kind === "payment" || op.kind === "deposit") &&
    change != null &&
    change < 0
  ) {
    return "payments.errors.cash_short";
  }
  const spendsDeposit =
    op.kind === "deposit_payment" ||
    (op.kind === "refund" && op.account === "deposit") ||
    (op.kind === "correction" && op.account === "deposit" && op.amount < 0);
  if (spendsDeposit && deposit < Math.abs(op.amount)) {
    return "payments.errors.deposit_insufficient";
  }
  if (op.kind === "refund" && op.account === "services" && paid < op.amount) {
    return "payments.errors.refund_exceeds_paid";
  }
  return null;
};

/** Days since a moment (the debtors list: «последний визит N дн. назад») */
export const daysSince = (at: string | null | undefined, now = new Date()) =>
  at
    ? Math.max(
        0,
        Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000),
      )
    : null;

/**
 * What an employee may do with the money (the database enforces the same):
 * whoever works with the patients (owner, head, manager — not the
 * integrator) accepts payments and deposits; refunds, changes and
 * cancellations: owner and head; corrections: the owner. The cash desk of
 * the whole clinic, every shift and the reports: owner, head and employees
 * with the «Отчёты» right; a cashier without it sees their own operations.
 */
export const paymentRights = (
  role: string | null | undefined,
  reportsView?: string | null,
) => {
  const staff = role === "owner" || role === "head" || role === "manager";
  const senior = role === "owner" || role === "head";
  return {
    canAccept: staff,
    canRefund: senior,
    canEdit: senior,
    canCorrect: role === "owner",
    seesAll: senior || (role === "manager" && reportsView === "all"),
  };
};

/**
 * The amount of chosen plan items, with the plan discount pro rata (like
 * the done items of the account): what «Оплатить позиции» proposes
 */
export const itemsAmount = (
  plan: Pick<TreatmentPlan, "id" | "discount_percent" | "discount_amount">,
  items: (ItemLike & { id: Identifier })[],
  ids: Identifier[],
) => {
  const own = items.filter((item) => same(item.plan_id, plan.id));
  const subtotal = own.reduce((sum, item) => sum + itemTotal(item), 0);
  const chosen = own
    .filter((item) => ids.some((id) => same(id, item.id)))
    .reduce((sum, item) => sum + itemTotal(item), 0);
  return planDoneCharge(
    subtotal,
    chosen,
    Number(plan.discount_percent),
    Number(plan.discount_amount),
  );
};
