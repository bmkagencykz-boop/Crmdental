import { describe, expect, it } from "vitest";

import { canAccess } from "../providers/commons/canAccess";
import { cashFlowRows, csvRows, pnlRows } from "./financeTable";
import type { CashFlowReport, FinanceArticle, PnlReport } from "./types";

const article = (
  id: number,
  code: string,
  section: "in" | "out",
  activity: FinanceArticle["activity"],
  pnl_line: FinanceArticle["pnl_line"] = null,
): FinanceArticle => ({
  id,
  name: code,
  code: code as FinanceArticle["code"],
  section,
  activity,
  pnl_line,
  is_active: true,
  position: id,
});
const ARTICLES = [
  article(1, "services", "in", "operating", "revenue"),
  article(2, "rent", "out", "operating", "opex"),
  article(3, "utilities", "out", "operating", "opex"),
  article(4, "dividends", "out", "financing"),
];

describe("finance tables", () => {
  it("ДДС: activities, articles, net and balances", () => {
    const report: CashFlowReport = {
      granularity: "month",
      from: "2026-06-01",
      to: "2026-08-01",
      periods: ["2026-06-01", "2026-07-01"],
      balances: true,
      rows: [
        { article_id: 1, period: "2026-06-01", amount: 100 },
        { article_id: 2, period: "2026-06-01", amount: -30 },
        { article_id: 4, period: "2026-07-01", amount: -50 },
      ],
      accounts: [
        {
          account_id: 1,
          opening: 10,
          closing: 30,
          flow: 20,
          flows: [
            { period: "2026-06-01", amount: 70 },
            { period: "2026-07-01", amount: -50 },
          ],
        },
      ],
      totals: [
        {
          period: "2026-06-01",
          inflow: 100,
          outflow: 30,
          net: 70,
          opening: 10,
          closing: 80,
        },
        {
          period: "2026-07-01",
          inflow: 0,
          outflow: 50,
          net: -50,
          opening: 80,
          closing: 30,
        },
      ],
      total: { inflow: 100, outflow: 80, net: 20, opening: 10, closing: 30 },
    };
    const rows = cashFlowRows(report, ARTICLES, [
      {
        id: 1,
        name: "Касса",
        kind: "cash",
        opening_balance: 10,
        is_active: true,
        position: 0,
      },
    ]);
    expect(rows.map((r) => r.key)).toEqual([
      "activity-operating",
      "article-1",
      "article-2",
      "activity-financing",
      "article-4",
      "net",
      "opening",
      "closing",
      "account-1",
    ]);
    expect(rows[0].values).toEqual([70, 0]);
    expect(rows.at(-1)!.values).toEqual([80, 30]);
    const csv = csvRows(
      rows,
      ["июн", "июл"],
      (r) => r.name ?? r.key,
      "Статья",
      "Итого",
    );
    expect(csv[1]).toEqual({
      Статья: "services",
      июн: 100,
      июл: 0,
      Итого: 100,
    });
  });

  it("ПиУ: lines and the articles of the operating expenses", () => {
    const zero = {
      revenue: 0,
      refunds: 0,
      materials: 0,
      lab: 0,
      doctors: 0,
      staff: 0,
      marketing: 0,
      opex_other: 0,
      other_income: 0,
      interest: 0,
      depreciation: 0,
      tax: 0,
      cogs: 0,
      gross: 0,
      opex: 0,
      ebitda: 0,
      net: 0,
      gross_margin: null,
      net_margin: null,
      visits: 0,
      avg_check: null,
      revenue_per_chair: null,
      lab_share: null,
      payroll_share: null,
    };
    const report: PnlReport = {
      from: "2026-06-01",
      to: "2026-07-01",
      chairs: 1,
      months: ["2026-06-01"],
      rows: [
        {
          month: "2026-06-01",
          line: "revenue",
          source: "services",
          article_id: null,
          amount: 1000,
        },
        {
          month: "2026-06-01",
          line: "opex",
          source: "cash",
          article_id: 2,
          amount: 200,
        },
        {
          month: "2026-06-01",
          line: "opex",
          source: "cash",
          article_id: 3,
          amount: 50,
        },
      ],
      summary: [
        {
          ...zero,
          month: "2026-06-01",
          revenue: 1000,
          opex_other: 250,
          opex: 250,
          gross: 1000,
          ebitda: 750,
          net: 750,
          gross_margin: 100,
        },
      ],
      total: {
        ...zero,
        revenue: 1000,
        opex_other: 250,
        opex: 250,
        gross: 1000,
        ebitda: 750,
        net: 750,
        gross_margin: 100,
      },
    };
    const rows = pnlRows(report, ARTICLES);
    expect(rows.find((r) => r.key === "services")?.values).toEqual([1000]);
    expect(rows.find((r) => r.key === "opex_other-2")?.values).toEqual([200]);
    expect(rows.find((r) => r.key === "gross_margin")?.values).toEqual([100]);
    expect(rows.some((r) => r.key === "revenue_manual")).toBe(false);
  });

  it("rights of the menu", () => {
    expect(canAccess("owner", { resource: "finance", action: "menu" })).toBe(
      true,
    );
    expect(canAccess("head", { resource: "finance", action: "menu" })).toBe(
      true,
    );
    expect(canAccess("manager", { resource: "finance", action: "menu" })).toBe(
      false,
    );
    expect(
      canAccess("integrator", { resource: "finance", action: "menu" }),
    ).toBe(false);
    expect(
      canAccess("manager", { resource: "finance_pnl", action: "list" }),
    ).toBe(false);
  });
});
