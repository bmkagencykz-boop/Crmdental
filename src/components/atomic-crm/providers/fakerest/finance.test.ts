import { beforeAll, describe, expect, it } from "vitest";

import { addMonths, monthOf } from "../../finance/financeMath";
import type {
  FinanceAccount,
  FinanceArticle,
  FinanceTransaction,
} from "../../finance/types";
import type { PayrollAdjustment } from "../../payroll/types";
import { todayKey } from "../../tasks/calendarLayout";
import type { Sale } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";
import { DEMO_REPORTS_EMAIL } from "./dataGenerator/accessRights";

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
      getIdentity: async () => ({ id: current.id, fullName: current.first_name }),
    },
  }) as CrmDataProvider;
  const loginAs = (pick: (sale: Sale) => boolean) => {
    current = db.sales.find((sale) => pick(sale) && !sale.disabled)!;
    return current;
  };
  return { db, dataProvider, loginAs };
};

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

const current = monthOf(todayKey("Asia/Almaty"));
const yearAgo = addMonths(current, -11);
const nextMonth = addMonths(current, 1);

describe("demo finance (stage 44)", () => {
  it("has the accounts, the articles, the method map and mapped categories", async () => {
    const { db, dataProvider } = setup();
    expect(db.finance_accounts.map((a) => a.code)).toEqual(["till", "kaspi", "bank"]);
    expect(db.finance_articles).toHaveLength(20);
    const map = await dataProvider.getFinanceMethodAccounts();
    expect(map.find((row) => row.method === "card")?.account_id).toBe(
      db.finance_accounts.find((a) => a.code === "kaspi")!.id,
    );
    expect(db.cash_expense_categories.every((c) => c.article_id != null)).toBe(true);
  });

  it("a year of ДДС that looks real", async () => {
    const { dataProvider } = setup();
    const report = await dataProvider.getCashFlow({ from: yearAgo, to: nextMonth });
    expect(report.periods).toHaveLength(12);
    const full = report.totals.slice(0, 11);
    for (const month of full) {
      expect(month.inflow).toBeGreaterThan(20_000_000);
      expect(month.inflow).toBeLessThan(45_000_000);
    }
    for (const account of report.accounts) {
      expect(account.closing ?? 0).toBeGreaterThanOrEqual(0);
    }
    expect(report.accounts.reduce((sum, a) => sum + a.flow, 0)).toBe(report.total.net);
  });

  it("a year of P&L with revenue 20–40 млн ₸", async () => {
    const { dataProvider } = setup();
    const report = await dataProvider.getPnl({ from: yearAgo, to: current });
    expect(report.summary).toHaveLength(11);
    for (const month of report.summary) {
      expect(month.revenue).toBeGreaterThan(20_000_000);
      expect(month.revenue).toBeLessThan(40_000_000);
      expect(month.gross_margin).toBeGreaterThan(30);
      expect(month.net).toBeGreaterThan(0);
    }
    const now = await dataProvider.getPnl({ from: current, to: nextMonth });
    // The CRM's own work of the month is revenue too
    expect(now.rows.some((row) => row.source === "services" && row.line === "revenue")).toBe(true);
  });

  it("the models: plan vs fact and the forecast with an investment", async () => {
    const { db, dataProvider } = setup();
    const budget = await dataProvider.getFinanceModelReport(db.finance_models[0].id);
    expect(budget.months[0].revenue).toBeGreaterThan(20_000_000);
    expect(budget.fact.length).toBeGreaterThan(0);
    expect(budget.fact.at(-1)?.partial).toBe(true);
    const forecast = await dataProvider.getFinanceModelReport(db.finance_models[1].id, "pessimistic");
    expect(forecast.investment).toBe(9_000_000);
    expect(forecast.payback_months).toBeGreaterThan(0);
    expect(forecast.months[5].chairs).toBe(4);
    expect(forecast.fact).toEqual([]);
  });

  it("a payout by bank gets its transaction; the linked one is locked", async () => {
    const { db, dataProvider } = setup();
    const doctor = db.doctors[0];
    const { data: payout } = await dataProvider.create<PayrollAdjustment>("payroll_adjustments", {
      data: { doctor_id: doctor.id, month: current, kind: "payout", amount: 70_000, occurred_on: todayKey("Asia/Almaty") },
    });
    const linked = (await list<FinanceTransaction>(dataProvider, "finance_transactions")).find(
      (row) => String(row.payroll_adjustment_id) === String(payout.id),
    )!;
    expect(linked).toMatchObject({ kind: "out", amount: 70_000 });
    await expect(
      dataProvider.update("finance_transactions", { id: linked.id, data: { amount: 1 }, previousData: linked }),
    ).rejects.toThrow();
    await expect(
      dataProvider.delete("finance_transactions", { id: linked.id, previousData: linked }),
    ).rejects.toThrow();
    await dataProvider.update("payroll_adjustments", { id: payout.id, data: { amount: 60_000 }, previousData: payout });
    expect(
      (await list<FinanceTransaction>(dataProvider, "finance_transactions")).find((row) => row.id === linked.id)?.amount,
    ).toBe(60_000);
    await dataProvider.delete("payroll_adjustments", { id: payout.id, previousData: payout });
    expect(
      (await list<FinanceTransaction>(dataProvider, "finance_transactions")).some((row) => row.id === linked.id),
    ).toBe(false);
  });

  it("the rules of a transaction and of the system rows", async () => {
    const { db, dataProvider } = setup();
    const article = (code: string) => db.finance_articles.find((a) => a.code === code)!.id;
    const bank = db.finance_accounts.find((a) => a.code === "bank")!.id;
    await expect(
      dataProvider.create("finance_transactions", {
        data: { kind: "in", occurred_on: current, account_id: bank, article_id: article("rent"), amount: 100 },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.create("finance_transactions", {
        data: { kind: "accrual", occurred_on: current, article_id: article("dividends"), amount: 100 },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.create("finance_transactions", {
        data: { kind: "transfer", occurred_on: current, account_id: bank, to_account_id: bank, amount: 100 },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.delete("finance_articles", { id: article("rent"), previousData: {} as FinanceArticle }),
    ).rejects.toThrow();
    const before = await dataProvider.getCashFlow({ from: yearAgo, to: nextMonth });
    await dataProvider.create("finance_transactions", {
      data: { kind: "transfer", occurred_on: current, account_id: bank, to_account_id: db.finance_accounts[0].id, amount: 500_000 },
    });
    const after = await dataProvider.getCashFlow({ from: yearAgo, to: nextMonth });
    expect(after.total.net).toBe(before.total.net);
    const audit = await list<{ entity: string }>(dataProvider, "audit_log");
    expect(audit.some((row) => row.entity === "finance_transaction")).toBe(true);
  });

  it("rights: ДДС with «Отчёты», P&L and the model for the owner and the head", async () => {
    const { dataProvider, loginAs } = setup();
    loginAs((sale) => sale.email === DEMO_REPORTS_EMAIL);
    await expect(dataProvider.getCashFlow({ from: yearAgo, to: nextMonth })).resolves.toBeTruthy();
    await expect(dataProvider.getPnl({ from: yearAgo, to: nextMonth })).rejects.toThrow();
    expect(await list<FinanceAccount>(dataProvider, "finance_accounts")).toHaveLength(3);
    expect(await list(dataProvider, "finance_models")).toHaveLength(0);
    loginAs((sale) => sale.role === "manager" && sale.email !== DEMO_REPORTS_EMAIL);
    await expect(dataProvider.getCashFlow({ from: yearAgo, to: nextMonth })).rejects.toThrow();
    expect(await list(dataProvider, "finance_transactions")).toHaveLength(0);
  });
});
