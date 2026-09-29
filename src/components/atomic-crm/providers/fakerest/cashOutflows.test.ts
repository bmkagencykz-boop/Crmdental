import { beforeAll, describe, expect, it } from "vitest";

import { labSettlement, localDay, monthStart } from "../../lab/labMath";
import type { LabOrderCost, LabPayment } from "../../lab/types";
import type {
  AccountOperation,
  AccountOperationSummary,
  CashExpenseCategory,
} from "../../payments/types";
import type { PayrollAdjustment } from "../../payroll/types";
import type { Sale } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
}, 120_000);

const setup = () => {
  const db = generateData();
  let current: Sale = db.sales.find((sale) => sale.role === "owner")!;
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({
        id: current.id,
        fullName: current.first_name,
      }),
    },
  }) as CrmDataProvider;
  const loginAs = (role: Sale["role"]) => {
    current = db.sales.find((sale) => sale.role === role && !sale.disabled)!;
    return current;
  };
  return { db, dataProvider, loginAs };
};

const list = async <T>(
  dataProvider: CrmDataProvider,
  resource: string,
  filter: Record<string, unknown> = {},
) =>
  (
    await dataProvider.getList(resource, {
      filter,
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

const ops = (dataProvider: CrmDataProvider) =>
  list<AccountOperation>(dataProvider, "account_operations");
const payouts = (dataProvider: CrmDataProvider) =>
  list<PayrollAdjustment>(dataProvider, "payroll_adjustments");
const labPayments = (dataProvider: CrmDataProvider) =>
  list<LabPayment>(dataProvider, "lab_payments");

const categoryId = (
  db: { cash_expense_categories: CashExpenseCategory[] },
  code: string,
) => db.cash_expense_categories.find((c) => c.code === code)!.id;

describe("demo cash outflows (stage 42)", () => {
  it("has the categories and plausible expenses", () => {
    const { db } = setup();
    expect(db.cash_expense_categories.map((c) => c.name)).toEqual([
      "Зарплата",
      "Лаборатория",
      "Материалы",
      "Аренда",
      "Прочее",
    ]);
    const expenses = db.account_operations.filter(
      (op) => op.kind === "expense",
    );
    const codes = expenses.map(
      (op) =>
        db.cash_expense_categories.find((c) => c.id === op.category_id)?.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(["rent", "materials", "salary", "lab"]),
    );
    expect(
      expenses.every((op) => op.patient_id == null && op.till_delta! < 0),
    ).toBe(true);
    // The advance given from the cash desk, a lab payment from it
    const advance = db.payroll_adjustments.find(
      (a) => a.account_operation_id != null,
    );
    expect(advance?.kind).toBe("payout");
    expect(
      db.account_operations.find(
        (op) => op.id === advance?.account_operation_id,
      )?.amount,
    ).toBe(advance?.amount);
    expect(db.lab_payments.length).toBeGreaterThan(0);
    expect(
      db.lab_payments.some((payment) => payment.account_operation_id != null),
    ).toBe(true);
  });

  it("records an expense: the journal, the expected cash, the reports", async () => {
    const { db, dataProvider } = setup();
    const shiftId = await dataProvider.openCashShift(30000);
    await dataProvider.create("account_operations", {
      data: {
        kind: "expense",
        amount: 8000,
        method: "cash",
        category_id: categoryId(db, "other"),
        comment: "Вода",
      },
    });
    expect(await dataProvider.cashShiftExpected(shiftId)).toBe(22000);
    const journal = await list<AccountOperationSummary>(
      dataProvider,
      "account_operations_summary",
    );
    const water = journal.find((op) => op.comment === "Вода")!;
    expect(water.patient_name).toBeNull();
    expect(water.category_name).toBe("Прочее");
    expect(water.shift_id).toBe(shiftId);
    const report = await dataProvider.getCashExpensesReport({});
    expect(report.find((row) => row.code === "other")?.amount).toBe(8000);
    const methods = await dataProvider.getCashMethodsReport({});
    expect(
      methods.find((row) => row.method === "cash")!.expenses,
    ).toBeGreaterThanOrEqual(8000);
    // The rules
    await expect(
      dataProvider.create("account_operations", {
        data: { kind: "expense", amount: 100, method: "cash" },
      }),
    ).rejects.toThrow(/статью/);
    await expect(
      dataProvider.create("account_operations", {
        data: {
          kind: "expense",
          amount: 100,
          method: "deposit",
          category_id: categoryId(db, "other"),
        },
      }),
    ).rejects.toThrow();
    // The audit log
    const audit = await list<{ entity: string; changes: any }>(
      dataProvider,
      "audit_log",
    );
    expect(
      audit.some(
        (row) =>
          row.entity === "account_operation" &&
          (row.changes.kind as unknown[])?.[1] === "expense",
      ),
    ).toBe(true);
  });

  it("a manager spends only when the clinic allows it", async () => {
    const { db, dataProvider, loginAs } = setup();
    await dataProvider.updateOrganizationSettings({
      manager_cash_expenses: false,
    });
    loginAs("manager");
    await expect(
      dataProvider.create("account_operations", {
        data: {
          kind: "expense",
          amount: 1000,
          method: "cash",
          category_id: categoryId(db, "other"),
        },
      }),
    ).rejects.toThrow(/владелец/);
    await dataProvider.updateOrganizationSettings({
      manager_cash_expenses: true,
    });
    const { data } = await dataProvider.create<AccountOperation>(
      "account_operations",
      {
        data: {
          kind: "expense",
          amount: 1000,
          method: "cash",
          category_id: categoryId(db, "other"),
        },
      },
    );
    expect(data.kind).toBe("expense");
    await expect(
      dataProvider.recordLabPayment({
        lab_id: db.labs[0].id,
        month: "2026-09-01",
        amount: 100,
        method: "bank_transfer",
      }),
    ).rejects.toThrow();
    expect(await list<LabPayment>(dataProvider, "lab_payments")).toEqual([]);
    loginAs("integrator");
    expect(
      await list<AccountOperation>(dataProvider, "account_operations"),
    ).toEqual([]);
    expect(
      await list<CashExpenseCategory>(dataProvider, "cash_expense_categories"),
    ).toEqual([]);
  });

  it("gives a payout from the cash desk and keeps both sides in sync", async () => {
    const { db, dataProvider } = setup();
    await dataProvider.openCashShift(100000);
    const doctor = db.doctors[0];
    const month = monthStart(localDay());
    const result = await dataProvider.recordPayrollPayout({
      doctor_id: doctor.id,
      month,
      amount: 40000,
      note: "аванс",
      fromCash: true,
      method: "cash",
    });
    const op = (await ops(dataProvider)).find(
      (o) => o.id === result.operation_id,
    )!;
    expect(op.category_id).toBe(categoryId(db, "salary"));
    expect(op.amount).toBe(40000);
    const payout = (await payouts(dataProvider)).find(
      (a) => a.id === result.adjustment_id,
    )!;
    expect(payout.account_operation_id).toBe(op.id);
    await expect(
      dataProvider.update("payroll_adjustments", {
        id: payout.id,
        data: { amount: 1 },
        previousData: payout,
      }),
    ).rejects.toThrow(/кассу/);
    // Deleting the payout cancels the expense
    await dataProvider.delete("payroll_adjustments", {
      id: payout.id,
      previousData: payout,
    });
    expect((await ops(dataProvider)).some((o) => o.id === op.id)).toBe(false);
    // Cancelling the expense deletes the payout
    const second = await dataProvider.recordPayrollPayout({
      doctor_id: doctor.id,
      month,
      amount: 5000,
      fromCash: true,
      method: "card",
    });
    const secondOp = (await ops(dataProvider)).find(
      (o) => o.id === second.operation_id,
    )!;
    await dataProvider.delete("account_operations", {
      id: secondOp.id,
      previousData: secondOp,
    });
    expect(
      (await payouts(dataProvider)).some((a) => a.id === second.adjustment_id),
    ).toBe(false);
    // Without the cash desk (bank transfer)
    const transfer = await dataProvider.recordPayrollPayout({
      doctor_id: doctor.id,
      month,
      amount: 7000,
    });
    expect(transfer.operation_id).toBeNull();
  });

  it("pays a lab and shows owed, paid and balance", async () => {
    const { db, dataProvider } = setup();
    await dataProvider.openCashShift(0);
    const lab = db.labs.find((l) => !l.is_own)!;
    const month = monthStart(localDay());
    const before = (await labPayments(dataProvider)).length;
    const result = await dataProvider.recordLabPayment({
      lab_id: lab.id,
      month,
      amount: 15000,
      method: "cash",
      comment: "наличными",
      fromCash: true,
    });
    const payments = await labPayments(dataProvider);
    const payment = payments.find((p) => p.id === result.payment_id)!;
    expect(payment.account_operation_id).toBe(result.operation_id);
    expect(payments).toHaveLength(before + 1);
    const summary = await list<LabPayment & { lab_name: string }>(
      dataProvider,
      "lab_payments_summary",
    );
    expect(summary.find((p) => p.id === payment.id)?.lab_name).toBe(lab.name);
    const costs = await list<LabOrderCost>(dataProvider, "lab_order_costs");
    const rows = labSettlement(costs, db.labs, month, payments);
    const row = rows.find((r) => r.lab_id === lab.id)!;
    expect(row.paid).toBe(15000);
    expect(row.balance).toBe(row.amount - 15000);
    // Deleting the lab payment cancels its expense
    await dataProvider.delete("lab_payments", {
      id: payment.id,
      previousData: payment,
    });
    expect(
      (await ops(dataProvider)).some((o) => o.id === result.operation_id),
    ).toBe(false);
  });

  it("keeps the system categories", async () => {
    const { db, dataProvider } = setup();
    const rent = db.cash_expense_categories.find((c) => c.code === "rent")!;
    await expect(
      dataProvider.delete("cash_expense_categories", {
        id: rent.id,
        previousData: rent,
      }),
    ).rejects.toThrow(/Системную/);
    const { data } = await dataProvider.create<CashExpenseCategory>(
      "cash_expense_categories",
      { data: { name: " Реклама ", code: "rent" } },
    );
    expect(data.name).toBe("Реклама");
    expect(data.code).toBeNull();
  });
});
