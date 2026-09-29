import { describe, expect, it } from "vitest";

import type { AccountOperation } from "../payments/types";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../treatment/types";
import {
  bucketOf,
  cashFlowReport,
  computeModel,
  factRange,
  filterMovements,
  financeMovements,
  modelFacts,
  periodsOf,
  pnlFacts,
  pnlReport,
  share,
} from "./financeMath";
import type {
  FinanceAccount,
  FinanceArticle,
  FinanceModel,
  FinanceModelLine,
  FinanceTransaction,
} from "./types";

/**
 * The same clinic as supabase/tests/044_finance.test.sql: the same
 * numbers come out of the twin.
 */
const TZ = "Asia/Almaty";
const ARTICLES: FinanceArticle[] = (
  [
    ["services", "in", "operating", "revenue"],
    ["prepayments", "in", "operating", null],
    ["refunds", "in", "operating", null],
    ["other_in", "in", "operating", "other_income"],
    ["loans_in", "in", "financing", null],
    ["salary_doctors", "out", "operating", "doctors"],
    ["salary_staff", "out", "operating", "staff"],
    ["lab", "out", "operating", "lab"],
    ["materials", "out", "operating", "materials"],
    ["rent", "out", "operating", "opex"],
    ["utilities", "out", "operating", "opex"],
    ["marketing", "out", "operating", "marketing"],
    ["taxes", "out", "operating", "tax"],
    ["equipment", "out", "investing", null],
    ["dividends", "out", "financing", null],
    ["depreciation", "out", "operating", "depreciation"],
    ["other_out", "out", "operating", "opex"],
  ] as const
).map(([code, section, activity, pnl_line], index) => ({
  id: index + 1,
  name: code,
  code,
  section,
  activity,
  pnl_line,
  is_active: true,
  position: index,
}));
const art = (code: string) => ARTICLES.find((a) => a.code === code)!.id;
const ACCOUNTS: FinanceAccount[] = [
  { id: 1, name: "Касса", kind: "cash", code: "till", opening_balance: 100000, opening_date: "2026-06-01", is_active: true, position: 0 },
  { id: 2, name: "Kaspi", kind: "kaspi", code: "kaspi", opening_balance: 0, opening_date: null, is_active: true, position: 1 },
  { id: 3, name: "Банк", kind: "bank", code: "bank", opening_balance: 500000, opening_date: "2026-06-01", is_active: true, position: 2 },
];
const METHODS = [
  { method: "cash" as const, account_id: 1 },
  { method: "card" as const, account_id: 2 },
  { method: "kaspi_qr" as const, account_id: 2 },
  { method: "kaspi_transfer" as const, account_id: 2 },
  { method: "bank_transfer" as const, account_id: 3 },
  { method: "insurance" as const, account_id: 3 },
  { method: "other" as const, account_id: 3 },
];
const CATEGORIES = [
  { id: 1, name: "Зарплата", article_id: art("salary_staff") },
  { id: 2, name: "Лаборатория", article_id: art("lab") },
  { id: 4, name: "Аренда", article_id: art("rent") },
];
const op = (row: Partial<AccountOperation> & Pick<AccountOperation, "id" | "kind" | "amount" | "method" | "occurred_at">): AccountOperation => ({
  patient_id: 1,
  account: "services",
  ...row,
});
const OPERATIONS: AccountOperation[] = [
  op({ id: 1, kind: "payment", amount: 50000, method: "cash", occurred_at: "2026-06-10T12:00:00+05:00", branch_id: 1 }),
  op({
    id: 2,
    kind: "payment",
    amount: 50000,
    method: "mixed",
    parts: [
      { method: "card", amount: 30000 },
      { method: "kaspi_qr", amount: 20000 },
    ],
    occurred_at: "2026-06-11T12:00:00+05:00",
    branch_id: 1,
  }),
  op({ id: 3, kind: "deposit", account: "deposit", amount: 40000, method: "kaspi_transfer", occurred_at: "2026-06-12T12:00:00+05:00" }),
  op({ id: 4, kind: "deposit_payment", amount: 20000, method: "deposit", occurred_at: "2026-06-13T12:00:00+05:00", branch_id: 1 }),
  op({ id: 5, kind: "refund", amount: 5000, method: "cash", occurred_at: "2026-06-14T12:00:00+05:00", branch_id: 1 }),
  op({ id: 6, kind: "expense", patient_id: null, amount: 20000, method: "cash", category_id: 4, occurred_at: "2026-06-15T12:00:00+05:00" }),
  // The therapist's payout from the cash desk, the lab from the cash desk
  op({ id: 7, kind: "expense", patient_id: null, amount: 30000, method: "kaspi_transfer", category_id: 1, occurred_at: "2026-06-25T12:00:00+05:00" }),
  op({ id: 8, kind: "expense", patient_id: null, amount: 4000, method: "card", category_id: 2, occurred_at: "2026-06-28T12:00:00+05:00" }),
];
const tx = (row: Partial<FinanceTransaction> & Pick<FinanceTransaction, "id" | "kind" | "occurred_on" | "amount">): FinanceTransaction => ({
  account_id: 3,
  ...row,
});
const TRANSACTIONS: FinanceTransaction[] = [
  tx({ id: 1, kind: "in", occurred_on: "2026-05-20", article_id: art("other_in"), amount: 7777 }),
  tx({ id: 2, kind: "in", occurred_on: "2026-06-05", article_id: art("loans_in"), amount: 1000000 }),
  tx({ id: 3, kind: "out", occurred_on: "2026-06-07", article_id: art("equipment"), amount: 200000 }),
  tx({ id: 4, kind: "out", occurred_on: "2026-06-18", article_id: art("marketing"), amount: 5000 }),
  tx({ id: 5, kind: "out", occurred_on: "2026-06-25", article_id: art("taxes"), amount: 30000 }),
  tx({ id: 6, kind: "accrual", occurred_on: "2026-06-30", account_id: null, article_id: art("depreciation"), amount: 8000 }),
  tx({ id: 7, kind: "out", occurred_on: "2026-07-05", article_id: art("dividends"), amount: 100000 }),
  tx({ id: 8, kind: "out", occurred_on: "2026-06-20", article_id: art("utilities"), amount: 25000, branch_id: 1 }),
  tx({ id: 9, kind: "transfer", occurred_on: "2026-06-30", account_id: 1, to_account_id: 3, amount: 10000 }),
  // The linked transactions of the bank payout and the bank lab payment
  tx({ id: 10, kind: "out", occurred_on: "2026-06-30", article_id: art("salary_staff"), amount: 150000, payroll_adjustment_id: 2 }),
  tx({ id: 11, kind: "out", occurred_on: "2026-06-28", article_id: art("lab"), amount: 36000, lab_payment_id: 1 }),
];
const movements = (from?: string, to?: string) =>
  financeMovements({
    operations: OPERATIONS,
    transactions: TRANSACTIONS,
    articles: ARTICLES,
    methodAccounts: METHODS,
    categories: CATEGORIES,
    adjustments: [{ id: 1, doctor_id: 1, account_operation_id: 7 }],
    patients: [{ id: 1, first_name: "Асель", last_name: "Нурланова" }],
    timeZone: TZ,
    from,
    to,
  });
const row = (report: ReturnType<typeof cashFlowReport>, code: string, period: string) =>
  report.rows.find((r) => r.article_id === art(code) && r.period === period)?.amount ?? 0;

describe("ДДС", () => {
  const report = cashFlowReport({
    movements: movements(null as never, "2026-08-01"),
    accounts: ACCOUNTS,
    articles: ARTICLES,
    from: "2026-06-01",
    to: "2026-08-01",
  });

  it("counts every movement once, the deposit payment not at all", () => {
    expect(row(report, "services", "2026-06-01")).toBe(100000);
    expect(row(report, "prepayments", "2026-06-01")).toBe(40000);
    expect(row(report, "refunds", "2026-06-01")).toBe(-5000);
    expect(row(report, "salary_doctors", "2026-06-01")).toBe(-30000);
    expect(row(report, "salary_staff", "2026-06-01")).toBe(-150000);
    expect(row(report, "lab", "2026-06-01")).toBe(-40000);
    expect(row(report, "rent", "2026-06-01")).toBe(-20000);
  });

  it("totals and balances; a transfer is neutral", () => {
    expect(report.totals[0]).toEqual({
      period: "2026-06-01",
      inflow: 1135000,
      outflow: 500000,
      net: 635000,
      opening: 600000,
      closing: 1235000,
    });
    expect(report.totals[1]).toMatchObject({ net: -100000, opening: 1235000, closing: 1135000 });
    const account = (id: number) => report.accounts.find((a) => a.account_id === id)!;
    expect([account(1).opening, account(1).closing]).toEqual([100000, 115000]);
    expect([account(2).opening, account(2).closing]).toEqual([0, 56000]);
    expect([account(3).opening, account(3).closing]).toEqual([500000, 964000]);
    expect(report.accounts.reduce((sum, a) => sum + a.flow, 0)).toBe(report.total.net);
  });

  it("before the opening date ends at the opening balance", () => {
    const may = cashFlowReport({
      movements: movements(undefined, "2026-06-01"),
      accounts: ACCOUNTS,
      articles: ARTICLES,
      from: "2026-05-01",
      to: "2026-06-01",
    });
    const bank = may.accounts.find((a) => a.account_id === 3)!;
    expect([bank.opening, bank.closing]).toEqual([492223, 500000]);
  });

  it("by day and by week", () => {
    const days = cashFlowReport({ movements: movements(), accounts: ACCOUNTS, articles: ARTICLES, from: "2026-06-01", to: "2026-07-01", granularity: "day" });
    expect(days.periods).toHaveLength(30);
    expect(row(days, "services", "2026-06-11")).toBe(50000);
    const weeks = cashFlowReport({ movements: movements(), accounts: ACCOUNTS, articles: ARTICLES, from: "2026-06-01", to: "2026-07-01", granularity: "week" });
    expect(weeks.periods[0]).toBe("2026-06-01");
    expect(row(weeks, "services", "2026-06-08")).toBe(100000);
    expect(bucketOf("2026-06-14", "week")).toBe("2026-06-08");
    expect(periodsOf("2026-06-03", "2026-06-10", "week")).toEqual(["2026-06-01", "2026-06-08"]);
  });

  it("the branch filter: no balances", () => {
    const branch = cashFlowReport({ movements: movements(), accounts: ACCOUNTS, articles: ARTICLES, from: "2026-06-01", to: "2026-07-01", branchId: 1 });
    expect(branch.balances).toBe(false);
    expect(branch.total.opening).toBeNull();
    expect(row(branch, "utilities", "2026-06-01")).toBe(-25000);
    expect(row(branch, "services", "2026-06-01")).toBe(100000);
    expect(row(branch, "taxes", "2026-06-01")).toBe(0);
  });

  it("the drill-down", () => {
    const all = movements();
    const services = filterMovements(all, { from: "2026-06-01", to: "2026-07-01", article_id: art("services") });
    expect(services).toHaveLength(3);
    expect(services.reduce((sum, m) => sum + m.amount, 0)).toBe(100000);
    const transfers = filterMovements(all, { from: "2026-06-01", to: "2026-07-01", transfers: true });
    expect(transfers.map((m) => m.amount).sort()).toEqual([-10000, 10000]);
    const till = filterMovements(all, { from: "2026-06-01", to: "2026-07-01", account_id: 1 });
    expect(till.reduce((sum, m) => sum + m.amount, 0)).toBe(15000);
  });
});

describe("ПиУ", () => {
  const plan = {
    id: 1,
    deal_id: 1,
    patient_id: 1,
    status: "agreed",
    discount_percent: 10,
    discount_amount: 0,
    doctor_id: 1,
  } as unknown as TreatmentPlan;
  const stage = { id: 1, plan_id: 1, status: "in_progress", discount_percent: 0 } as unknown as TreatmentStage;
  const item = (id: number, quantity: number, done_at: string | null) =>
    ({
      id,
      plan_id: 1,
      stage_id: 1,
      service_id: 1,
      quantity,
      unit_price: 30000,
      line_total: 30000 * quantity,
      done: done_at != null,
      done_at,
    }) as unknown as TreatmentPlanItem;
  const input = (branch = false) => ({
    plans: [plan],
    stages: [stage],
    items: [
      item(1, 2, "2026-06-10T11:00:00+05:00"),
      item(2, 1, "2026-06-30T23:30:00+05:00"),
      item(3, 1, null),
    ],
    visits: [
      { id: 1, status: "completed", source: "crm", service_id: 2, deal_id: null, doctor_id: 1, branch_id: 1, starts_at: "2026-06-20T10:00:00+05:00" },
    ],
    services: [
      { id: 1, price: 30000 },
      { id: 2, price: 10000 },
    ],
    costs: [{ service_id: 1, cost_price: 5000 }],
    deals: [{ id: 1, branch_id: 1 }],
    timeZone: TZ,
    operations: OPERATIONS,
    labCosts: [{ month: "2026-06-01", amount: 36000, branch_id: 1 }],
    payrollLines: (month: string) =>
      month === "2026-06-01"
        ? [
            { doctor_id: 1, source: "plan_item" as const, accrued: 16200 },
            { doctor_id: 1, source: "plan_item" as const, accrued: 8100 },
            { doctor_id: 1, source: "visit" as const, accrued: 3000 },
            { doctor_id: null, source: "fixed" as const, accrued: 200000 },
          ]
        : [{ doctor_id: null, source: "fixed" as const, accrued: 200000 }],
    adjustments: [{ doctor_id: 1, month: "2026-06-01", kind: "bonus" as const, amount: 5000 }],
    doctors: [{ id: 1, branch_id: branch ? 1 : 1 }],
    adSpend: [{ spent_from: "2026-06-16", spent_to: "2026-07-15", amount: 30000 }],
    movements: movements("2026-06-01", "2026-08-01"),
    transactions: TRANSACTIONS,
    articles: ARTICLES,
  });
  const report = (branchId?: number) =>
    pnlReport({
      facts: pnlFacts(input(), "2026-06-01", "2026-08-01"),
      from: "2026-06-01",
      to: "2026-08-01",
      branchId,
      visits: input().visits,
      chairs: [
        { is_active: true, branch_id: 1 },
        { is_active: true, branch_id: 1 },
        { is_active: true, branch_id: 2 },
      ],
      timeZone: TZ,
    });

  it("revenue, cost of sales, operating, net — like the SQL test", () => {
    const june = report().summary[0];
    expect(june).toMatchObject({
      revenue: 86000,
      refunds: 5000,
      materials: 15000,
      lab: 36000,
      doctors: 32300,
      cogs: 83300,
      gross: 2700,
      gross_margin: 3.1,
      staff: 200000,
      marketing: 20000,
      opex_other: 45000,
      opex: 265000,
      ebitda: -262300,
      depreciation: 8000,
      tax: 30000,
      interest: 0,
      net: -300300,
      visits: 1,
      avg_check: 86000,
      revenue_per_chair: 28667,
      lab_share: 41.9,
      payroll_share: 270.1,
    });
    const july = report().summary[1];
    expect(july).toMatchObject({ revenue: 0, marketing: 15000, staff: 200000, net: -215000 });
    expect(report().total.net).toBe(-515300);
    expect(
      report().rows.find((r) => r.line === "opex" && r.article_id === art("rent")),
    ).toMatchObject({ amount: 20000, source: "cash" });
  });

  it("the branch filter", () => {
    const june = report(1).summary[0];
    expect(june).toMatchObject({ revenue: 86000, lab: 36000, doctors: 32300, staff: 0, opex_other: 25000, marketing: 0, revenue_per_chair: 43000 });
    expect(report(2).summary[0]).toMatchObject({ revenue: 0, net: 0 });
  });

  it("an accrual on a revenue article is revenue", () => {
    const facts = pnlFacts(
      { ...input(), transactions: [...TRANSACTIONS, tx({ id: 20, kind: "accrual", occurred_on: "2026-07-10", account_id: null, article_id: art("services"), amount: 1000000 })] },
      "2026-07-01",
      "2026-08-01",
    );
    const july = pnlReport({ facts, from: "2026-07-01", to: "2026-08-01", visits: [], chairs: [], timeZone: TZ });
    expect(july.summary[0].revenue).toBe(1000000);
  });

  it("shares", () => {
    expect(share(1, 3)).toBe(33.3);
    expect(share(2, 3)).toBe(66.7);
    expect(share(1, 0)).toBeNull();
  });
});

describe("Финмодель", () => {
  const model: FinanceModel = {
    id: 1,
    name: "База 2026",
    start_month: "2026-06-01",
    chairs: 2,
    working_days: 20,
    hours_per_day: 10,
    utilization: 50,
    visits_per_chair_hour: 1,
    avg_check: 20000,
    optimistic_factor: 1.15,
    pessimistic_factor: 0.85,
    opening_cash: 1000000,
    investment_amount: 3000000,
    investment_month: 0,
  };
  const line = (id: number, name: string, pnl_line: FinanceModelLine["pnl_line"], kind: "fixed" | "percent", value: number): FinanceModelLine => ({
    id,
    model_id: 1,
    name,
    pnl_line,
    kind,
    amount: kind === "fixed" ? value : 0,
    percent: kind === "percent" ? value : 0,
    from_index: 0,
    to_index: 11,
    position: id,
  });
  const lines = [
    line(1, "Врачи", "doctors", "percent", 30),
    line(2, "Лаборатория", "lab", "percent", 8),
    line(3, "Материалы", "materials", "percent", 6),
    line(4, "Аренда", "opex", "fixed", 500000),
    line(5, "Персонал", "staff", "fixed", 800000),
    line(6, "Налог 3 %", "tax", "percent", 3),
    line(7, "Амортизация", "depreciation", "fixed", 50000),
  ];
  const months = [{ id: 1, model_id: 1, month_index: 1, utilization: 75 }];

  it("a month, break-even, cash plan and payback — like the SQL test", () => {
    const plan = computeModel(model, months, lines);
    expect(plan.months[0]).toMatchObject({
      visits: 200,
      revenue: 4000000,
      doctors: 1200000,
      lab: 320000,
      materials: 240000,
      cogs: 1760000,
      gross: 2240000,
      opex: 1300000,
      ebitda: 940000,
      net: 770000,
      break_even_revenue: 2547170,
      break_even_utilization: 31.8,
      cash_flow: -2180000,
      cash: -1180000,
    });
    expect(plan.payback_months).toBe(3);
    expect(plan.payback_in_horizon).toBe(true);
    expect(plan.months[1]).toMatchObject({ visits: 300, revenue: 6000000 });
    expect(plan.total.revenue).toBe(50000000);
  });

  it("scenarios and limited lines", () => {
    expect(computeModel(model, months, lines, "pessimistic").months[0]).toMatchObject({ visits: 170, revenue: 3400000 });
    expect(computeModel(model, months, lines, "optimistic").months[0].visits).toBe(230);
    const limited = lines.map((l) => (l.id === 7 ? { ...l, to_index: 0 } : l));
    expect(computeModel(model, months, limited).months[1].depreciation).toBe(0);
  });

  it("payback beyond the horizon is estimated", () => {
    const plan = computeModel({ ...model, investment_amount: 30000000 }, [], lines);
    expect(plan.payback_in_horizon).toBe(false);
    // 820 000 a month: 12 + ceil((30 000 000 − 9 840 000) / 820 000) = 12 + 25
    expect(plan.payback_months).toBe(37);
    expect(computeModel({ ...model, investment_amount: 0 }, [], lines).payback_months).toBeNull();
  });

  it("plan vs fact", () => {
    const plan = computeModel(model, months, lines);
    const facts = modelFacts(
      plan,
      {
        summary: [{ month: "2026-06-01", revenue: 86000, gross: 2700, ebitda: -262300, net: -300300, visits: 1 }],
      } as never,
      "2026-09-01",
    );
    expect(facts[0]).toMatchObject({ revenue_delta: 86000 - 4000000, net_delta: -300300 - 770000, revenue_percent: 2.2, partial: false });
    expect(factRange("2026-06-01", "2026-09-01")).toEqual({ from: "2026-06-01", to: "2026-10-01" });
    expect(factRange("2026-10-01", "2026-09-01")).toBeNull();
  });
});
