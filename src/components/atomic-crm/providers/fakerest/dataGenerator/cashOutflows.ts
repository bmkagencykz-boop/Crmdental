import type { Identifier } from "ra-core";

import { monthStart, shiftMonth } from "../../../lab/labMath";
import type { LabPayment } from "../../../lab/types";
import { withDeltas } from "../../../payments/paymentMath";
import type {
  AccountOperation,
  CashExpenseCategory,
  ExpenseMethod,
} from "../../../payments/types";
import type { Db } from "./types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** A moment of a day: days back from today, at hh:mm local time */
const at = (daysBack: number, hours: number, minutes = 0) => {
  const moment = new Date();
  moment.setHours(0, 0, 0, 0);
  moment.setDate(moment.getDate() - daysBack);
  moment.setHours(hours, minutes, 0, 0);
  return moment;
};

/** The categories every clinic starts with (seed_cash_expense_categories) */
export const DEFAULT_EXPENSE_CATEGORIES: Omit<CashExpenseCategory, "id">[] = [
  { name: "Зарплата", code: "salary", is_active: true, position: 0 },
  { name: "Лаборатория", code: "lab", is_active: true, position: 1 },
  { name: "Материалы", code: "materials", is_active: true, position: 2 },
  { name: "Аренда", code: "rent", is_active: true, position: 3 },
  { name: "Прочее", code: "other", is_active: true, position: 4 },
];

/**
 * Money going out of the demo's cash desk (stage 42): the categories, the
 * rent paid by transfer, materials bought in cash from the administrator's
 * open shift (the clinic lets administrators spend), the therapist's
 * advance given from the cash desk (linked to the payout of the payroll)
 * and the external lab paid for last month — by transfer and a part in
 * cash. Runs after the payments, the payroll and the lab orders.
 */
export const generateCashOutflows = (db: Db) => {
  db.cash_expense_categories = DEFAULT_EXPENSE_CATEGORIES.map(
    (category, index) => ({
      ...category,
      id: index + 1,
      created_at: at(60, 9).toISOString(),
    }),
  );
  db.lab_payments = [];
  db.organization_settings[0].manager_cash_expenses = true;
  const category = (code: string) =>
    db.cash_expense_categories.find((c) => c.code === code)!.id;
  const owner = db.sales.find((sale) => sale.role === "owner") ?? db.sales[0];
  const openShift = db.cash_shifts.find((shift) => !shift.closed_at);

  const push = (data: {
    amount: number;
    method: ExpenseMethod;
    code: string;
    moment: Date;
    comment: string;
    salesId?: Identifier;
    shiftId?: Identifier | null;
  }) => {
    const shift = db.cash_shifts.find((s) => same(s.id, data.shiftId));
    const op = withDeltas({
      id: Math.max(0, ...db.account_operations.map((o) => Number(o.id))) + 1,
      patient_id: null,
      kind: "expense",
      account: "services",
      amount: data.amount,
      method: data.method,
      parts: null,
      cash_received: null,
      prepayment: false,
      occurred_at: data.moment.toISOString(),
      sales_id: data.salesId ?? owner.id,
      branch_id: shift?.branch_id ?? null,
      shift_id: shift?.id ?? null,
      deal_id: null,
      plan_id: null,
      plan_item_ids: [],
      visit_id: null,
      comment: data.comment,
      source: "cash_desk",
      deal_payment_id: null,
      category_id: category(data.code),
      created_at: data.moment.toISOString(),
    }) as AccountOperation;
    db.account_operations.push(op);
    return op;
  };

  // The rent of the month, by bank transfer (no shift)
  push({
    amount: 450000,
    method: "bank_transfer",
    code: "rent",
    moment: at(Math.min(new Date().getDate() - 1, 2), 10, 15),
    comment: "Аренда помещения за месяц",
  });
  // Materials bought by the administrator from today's open shift
  if (openShift) {
    push({
      amount: 12500,
      method: "cash",
      code: "materials",
      moment: at(0, 13, 20),
      comment: "Перчатки и маски",
      salesId: openShift.sales_id,
      shiftId: openShift.id,
    });
  }

  // The therapist's advance: given from the cash desk (cash)
  const therapist = db.doctors.find((d) => /терапевт/i.test(d.specialty ?? ""));
  const advance = db.payroll_adjustments.find(
    (a) =>
      a.kind === "payout" &&
      a.note === "Аванс" &&
      same(a.doctor_id, therapist?.id),
  );
  if (advance && therapist) {
    const moment = new Date(`${advance.occurred_on}T18:30:00`);
    const op = push({
      amount: advance.amount,
      method: "cash",
      code: "salary",
      moment,
      comment: `Зарплата: ${therapist.name}, ${advance.month.slice(5, 7)}.${advance.month.slice(0, 4)} — Аванс`,
      shiftId:
        openShift && advance.occurred_on === dayOf(new Date())
          ? openShift.id
          : null,
      salesId:
        openShift && advance.occurred_on === dayOf(new Date())
          ? openShift.sales_id
          : owner.id,
    });
    advance.account_operation_id = op.id;
  }

  // The external lab: last month paid — by transfer, and a part in cash
  const lastMonth = shiftMonth(monthStart(dayOf(new Date())), -1);
  const owed = new Map<string, number>();
  for (const order of db.lab_orders) {
    if (!order.ready_at || monthStart(order.ready_at) !== lastMonth) continue;
    for (const item of db.lab_order_items.filter((i) =>
      same(i.order_id, order.id),
    )) {
      const price =
        db.lab_order_item_prices.find((p) => same(p.item_id, item.id))
          ?.price ?? 0;
      const key = String(order.lab_id);
      owed.set(key, (owed.get(key) ?? 0) + item.qty * price);
    }
  }
  const external = db.labs.find((lab) => !lab.is_own);
  if (external) {
    const due = owed.get(String(external.id)) ?? 60000;
    const cashPart = Math.min(20000, Math.round(due / 3 / 1000) * 1000);
    const transfer = due - cashPart;
    const paymentOf = (
      data: Omit<LabPayment, "id" | "lab_id" | "month" | "created_by">,
    ) => {
      db.lab_payments.push({
        id: db.lab_payments.length + 1,
        lab_id: external.id,
        month: lastMonth,
        created_by: owner.id,
        ...data,
      });
    };
    if (transfer > 0) {
      const moment = at(Math.min(new Date().getDate() - 1, 3), 11, 0);
      paymentOf({
        amount: transfer,
        method: "bank_transfer",
        paid_at: moment.toISOString(),
        comment: "Счёт № 214",
        account_operation_id: null,
        created_at: moment.toISOString(),
      });
    }
    if (cashPart > 0) {
      const moment = at(0, 17, 40);
      const op = push({
        amount: cashPart,
        method: "cash",
        code: "lab",
        moment,
        comment: `Лаборатория: ${external.name}, ${lastMonth.slice(5, 7)}.${lastMonth.slice(0, 4)} — курьеру`,
        salesId: openShift?.sales_id ?? owner.id,
        shiftId: openShift?.id ?? null,
      });
      paymentOf({
        amount: cashPart,
        method: "cash",
        paid_at: op.occurred_at,
        comment: "курьеру",
        account_operation_id: op.id,
        created_at: op.occurred_at,
      });
    }
  }
};
