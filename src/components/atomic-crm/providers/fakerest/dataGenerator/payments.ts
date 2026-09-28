import type { Identifier } from "ra-core";

import {
  operationDeltas,
  patientCharged,
  shiftExpected,
  withDeltas,
} from "../../../payments/paymentMath";
import type {
  AccountOperation,
  MethodPart,
  OperationKind,
  OperationMethod,
} from "../../../payments/types";
import type { Deal, DealPayment } from "../../../types";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const dateOf = (at: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

/** A moment of a day: days back from today, at hh:mm local time */
const at = (daysBack: number, hours: number, minutes = 0) => {
  const moment = new Date();
  moment.setHours(0, 0, 0, 0);
  moment.setTime(moment.getTime() - daysBack * DAY);
  moment.setHours(hours, minutes, 0, 0);
  return moment;
};

/** The method a demo payment was written with (its comment) */
const methodOf = (comment: string | null | undefined): OperationMethod => {
  if (!comment) return "other";
  if (/рассрочка/i.test(comment)) return "kaspi_transfer";
  if (/kaspi/i.test(comment)) return "kaspi_qr";
  if (/налич/i.test(comment)) return "cash";
  if (/карт/i.test(comment)) return "card";
  return "other";
};

/**
 * Payments of the demo clinic (stage 36): one ledger row per deal payment
 * (Kaspi, cash, card), then yesterday's closed shift and today's open one
 * of the administrator with cash with change, a mixed payment, a deposit
 * top-up and a payment from it, a refund by the owner; a few debtors
 * (treatment done, not paid in full). Runs last: the deals have their
 * branch, the plans their items.
 */
export const generatePayments = (db: Db) => {
  db.account_operations = [];
  db.cash_shifts = [];
  let nextPayment =
    Math.max(0, ...db.deal_payments.map((payment) => Number(payment.id))) + 1;

  const push = (
    data: Omit<AccountOperation, "id" | "deposit_delta" | "paid_delta" | "till_delta">,
  ) => {
    const op = withDeltas({
      ...data,
      id: db.account_operations.length + 1,
    }) as AccountOperation;
    db.account_operations.push(op);
    return op;
  };

  // The payments written so far: their ledger rows
  for (const payment of db.deal_payments) {
    const deal = db.deals.find((d) => same(d.id, payment.deal_id));
    if (!deal) continue;
    const moment = new Date(`${payment.paid_at}T12:00:00`);
    push({
      patient_id: deal.patient_id,
      kind: payment.amount > 0 ? "payment" : "refund",
      account: "services",
      amount: Math.abs(payment.amount),
      method: methodOf(payment.comment),
      parts: null,
      prepayment: payment.kind === "prepayment",
      occurred_at: moment.toISOString(),
      sales_id: payment.sales_id ?? null,
      branch_id: deal.branch_id ?? null,
      shift_id: null,
      deal_id: deal.id,
      plan_id: null,
      plan_item_ids: [],
      visit_id: null,
      comment: payment.comment ?? null,
      source: "cash_desk",
      deal_payment_id: payment.id,
      created_at: payment.created_at,
    });
  }

  // The administrator at the till, the owner for the refund
  const cashier =
    db.sales.find((sale) => sale.role === "manager" && !sale.disabled) ??
    db.sales[0];
  const owner = db.sales.find((sale) => sale.role === "owner") ?? db.sales[0];
  const mainBranch = db.branches?.[0]?.id ?? null;

  const yesterdayShift = {
    id: 1,
    sales_id: cashier.id,
    branch_id: mainBranch,
    opened_at: at(1, 9).toISOString(),
    opening_cash: 20000,
    closed_at: null as string | null,
    closed_by: null as Identifier | null,
    expected_cash: null as number | null,
    counted_cash: null as number | null,
    discrepancy: null as number | null,
    note: null as string | null,
  };
  const todayOpened = new Date(Math.min(at(0, 9).getTime(), Date.now() - 60_000));
  const todayShift = {
    id: 2,
    sales_id: cashier.id,
    branch_id: mainBranch,
    opened_at: todayOpened.toISOString(),
    opening_cash: 15000,
    closed_at: null,
    closed_by: null,
    expected_cash: null,
    counted_cash: null,
    discrepancy: null,
    note: null,
  };

  // Deals of patients in treatment: they pay at the till
  const paying = db.deals
    .filter(
      (deal) =>
        !deal.archived_at &&
        db.treatment_plans.some(
          (plan) => same(plan.deal_id, deal.id) && plan.is_main,
        ),
    )
    .sort((a, b) => Number(a.id) - Number(b.id));
  const others = db.deals
    .filter((deal) => !deal.archived_at && !paying.includes(deal))
    .sort((a, b) => Number(a.id) - Number(b.id));
  const dealAt = (list: Deal[], index: number) =>
    list.length ? list[index % list.length] : undefined;

  const pay = (
    deal: Deal | undefined,
    {
      kind = "payment",
      amount,
      method,
      parts = null,
      cashReceived = null,
      moment,
      shiftId = null,
      salesId = cashier.id,
      comment = null,
      account = "services",
    }: {
      kind?: OperationKind;
      amount: number;
      method: OperationMethod;
      parts?: MethodPart[] | null;
      cashReceived?: number | null;
      moment: Date;
      shiftId?: Identifier | null;
      salesId?: Identifier;
      comment?: string | null;
      account?: "services" | "deposit";
    },
  ) => {
    if (!deal) return;
    // Early in the morning «today» is the last minutes
    const when = new Date(Math.min(moment.getTime(), Date.now() - 30_000));
    const plan = db.treatment_plans.find(
      (p) => same(p.deal_id, deal.id) && p.is_main,
    );
    const op = push({
      patient_id: deal.patient_id,
      kind,
      account,
      amount,
      method,
      parts,
      cash_received: cashReceived,
      prepayment: false,
      occurred_at: when.toISOString(),
      sales_id: salesId,
      branch_id: deal.branch_id ?? mainBranch,
      shift_id: shiftId,
      deal_id: kind === "deposit" ? null : deal.id,
      plan_id: kind === "deposit" ? null : (plan?.id ?? null),
      plan_item_ids: [],
      visit_id: null,
      comment,
      source: "cash_desk",
      deal_payment_id: null,
      created_at: when.toISOString(),
    });
    const paid = operationDeltas(op).paid;
    if (paid !== 0 && op.deal_id != null) {
      const payment: DealPayment = {
        id: nextPayment++,
        deal_id: deal.id,
        amount: paid,
        kind: "payment",
        paid_at: dateOf(when),
        comment,
        sales_id: salesId,
        created_at: when.toISOString(),
      };
      db.deal_payments.push(payment);
      deal.paid_amount = (deal.paid_amount ?? 0) + paid;
      op.deal_payment_id = payment.id;
    }
  };

  // Yesterday: a day at the till, closed with 500 ₸ missing
  pay(dealAt(paying, 0), {
    amount: 45000,
    method: "cash",
    cashReceived: 50000,
    moment: at(1, 10, 15),
    shiftId: 1,
    comment: "Лечение, 1 этап",
  });
  pay(dealAt(paying, 1), {
    amount: 120000,
    method: "kaspi_qr",
    moment: at(1, 12, 40),
    shiftId: 1,
  });
  pay(dealAt(others, 0), {
    amount: 25000,
    method: "card",
    moment: at(1, 15, 5),
    shiftId: 1,
    comment: "Профгигиена",
  });
  pay(dealAt(others, 1), {
    kind: "deposit",
    account: "deposit",
    amount: 100000,
    method: "kaspi_transfer",
    moment: at(1, 17, 30),
    shiftId: 1,
    comment: "Аванс на имплантацию",
  });
  // Today: the shift is open
  pay(dealAt(paying, 2), {
    amount: 32000,
    method: "cash",
    cashReceived: 40000,
    moment: at(0, 9, 20),
    shiftId: 2,
    comment: "Лечение кариеса",
  });
  pay(dealAt(paying, 3), {
    amount: 150000,
    method: "mixed",
    parts: [
      { method: "card", amount: 100000 },
      { method: "kaspi_qr", amount: 50000 },
    ],
    moment: at(0, 10, 10),
    shiftId: 2,
    comment: "Коронка",
  });
  pay(dealAt(others, 1), {
    kind: "deposit_payment",
    amount: 60000,
    method: "deposit",
    moment: at(0, 11, 0),
    shiftId: 2,
    comment: "Оплата с депозита",
  });
  pay(dealAt(others, 2), {
    kind: "deposit",
    account: "deposit",
    amount: 50000,
    method: "cash",
    moment: at(0, 11, 45),
    shiftId: 2,
  });
  pay(dealAt(paying, 4), {
    amount: 18000,
    method: "insurance",
    moment: at(0, 12, 30),
    shiftId: 2,
    comment: "Полис ДМС",
  });
  // The owner gives money back (not in the administrator's shift)
  pay(dealAt(paying, 1), {
    kind: "refund",
    amount: 20000,
    method: "kaspi_transfer",
    moment: at(0, 9, 5),
    salesId: owner.id,
    comment: "Возврат: коронка не понадобилась",
  });

  // Yesterday's shift is closed: 500 ₸ missing
  const expected = shiftExpected(
    yesterdayShift.opening_cash,
    db.account_operations.filter((op) => same(op.shift_id, 1)),
  );
  Object.assign(yesterdayShift, {
    closed_at: at(1, 20).toISOString(),
    closed_by: cashier.id,
    expected_cash: expected,
    counted_cash: expected - 500,
    discrepancy: -500,
    note: "Не хватает 500 ₸ — сдача",
  });
  db.cash_shifts.push(yesterdayShift, todayShift);

  // A few debtors: treatment done, not paid in full
  const debt = (patientId: Identifier) => {
    const charged = patientCharged({
      patientId,
      plans: db.treatment_plans,
      items: db.treatment_plan_items,
      visits: db.visits,
      services: db.services,
    });
    const paid = db.account_operations
      .filter((op) => same(op.patient_id, patientId))
      .reduce((sum, op) => sum + operationDeltas(op).paid, 0);
    return charged - paid;
  };
  const debtors = () =>
    db.patients.filter((patient) => debt(patient.id) > 0).length;
  const plans = db.treatment_plans
    .filter((plan) => ["agreed", "in_progress"].includes(plan.status))
    .sort((a, b) => Number(a.id) - Number(b.id));
  for (const plan of plans) {
    if (debtors() >= 4) break;
    if (debt(plan.patient_id) > 0) continue;
    // One more stage done, not paid yet
    const items = db.treatment_plan_items
      .filter((item) => same(item.plan_id, plan.id) && !item.done)
      .sort((a, b) => a.stage_no - b.stage_no || a.position - b.position);
    const stage = items[0]?.stage_no;
    for (const item of items.filter((i) => i.stage_no === stage)) {
      item.done = true;
      item.done_at = at(3, 12).toISOString();
    }
    if (items.length) plan.status = "in_progress";
  }
};
