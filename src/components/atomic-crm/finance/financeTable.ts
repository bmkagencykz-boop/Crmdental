import type { Identifier } from "ra-core";

import type {
  ArticleActivity,
  CashFlowReport,
  FinanceAccount,
  FinanceArticle,
  FinanceModelReport,
  PnlReport,
} from "./types";

/**
 * The tables of the finance pages (stage 44), as plain rows: the pages draw
 * them and the CSV export writes them. A row carries either a label key
 * (translated by the page) or a name (an article, an account).
 */
export type TableRow = {
  key: string;
  /** A translation key of the finance namespace, else `name` */
  labelKey?: string;
  name?: string;
  /** 0: a total / a section, 1: a line inside a section */
  level: 0 | 1;
  kind: "section" | "line" | "total" | "percent" | "count";
  /** The section it belongs to (collapsing) */
  section?: string;
  values: (number | null)[];
  total: number | null;
  /** The drill-down of a line of the ДДС */
  articleId?: Identifier;
  accountId?: Identifier | null;
  transfers?: boolean;
};

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const byPosition = <T extends { position: number; id: Identifier }>(
  a: T,
  b: T,
) => a.position - b.position || Number(a.id) - Number(b.id);

export const ACTIVITIES: ArticleActivity[] = [
  "operating",
  "investing",
  "financing",
];

/** «ДДС»: activities → inflows and outflows by article, net; balances */
export const cashFlowRows = (
  report: CashFlowReport,
  articles: FinanceArticle[],
  accounts: FinanceAccount[],
): TableRow[] => {
  const periods = report.periods;
  const valuesOf = (articleId: Identifier) =>
    periods.map(
      (period) =>
        report.rows.find(
          (r) => same(r.article_id, articleId) && r.period === period,
        )?.amount ?? 0,
    );
  const rows: TableRow[] = [];
  const sumRows = (list: TableRow[]) =>
    periods.map((_, i) =>
      list.reduce((sum, row) => sum + (row.values[i] ?? 0), 0),
    );
  const used = new Set(report.rows.map((r) => String(r.article_id)));
  for (const activity of ACTIVITIES) {
    const own = articles
      .filter(
        (a) =>
          a.activity === activity && (used.has(String(a.id)) || a.is_active),
      )
      .sort(byPosition);
    const lines = own
      .filter((a) => used.has(String(a.id)))
      .map((a): TableRow => {
        const values = valuesOf(a.id);
        return {
          key: `article-${a.id}`,
          name: a.name,
          level: 1,
          kind: "line",
          section: activity,
          values,
          total: values.reduce((s, v) => s + (v ?? 0), 0),
          articleId: a.id,
        };
      });
    if (!lines.length) continue;
    const net = sumRows(lines);
    rows.push({
      key: `activity-${activity}`,
      labelKey: `finance.activities.${activity}`,
      level: 0,
      kind: "section",
      section: activity,
      values: net,
      total: net.reduce((s, v) => s + v, 0),
    });
    const inflow = lines.filter(
      (row) => own.find((a) => same(a.id, row.articleId))?.section === "in",
    );
    const outflow = lines.filter(
      (row) => own.find((a) => same(a.id, row.articleId))?.section === "out",
    );
    rows.push(...inflow, ...outflow);
  }
  const net = report.totals.map((t) => t.net);
  rows.push({
    key: "net",
    labelKey: "finance.cash_flow.net",
    level: 0,
    kind: "total",
    values: net,
    total: report.total.net,
  });
  if (report.balances) {
    rows.push({
      key: "opening",
      labelKey: "finance.cash_flow.opening",
      level: 0,
      kind: "total",
      values: report.totals.map((t) => t.opening),
      total: report.total.opening,
    });
    rows.push({
      key: "closing",
      labelKey: "finance.cash_flow.closing",
      level: 0,
      kind: "total",
      values: report.totals.map((t) => t.closing),
      total: report.total.closing,
    });
    for (const row of report.accounts) {
      const account = accounts.find((a) => same(a.id, row.account_id));
      if (!account && row.account_id != null) continue;
      if (account && !account.is_active && row.flow === 0 && !row.closing)
        continue;
      let running = row.opening ?? 0;
      const closings = periods.map((period) => {
        running += row.flows.find((f) => f.period === period)?.amount ?? 0;
        return running;
      });
      rows.push({
        key: `account-${row.account_id ?? "none"}`,
        name: account?.name,
        labelKey: account ? undefined : "finance.cash_flow.no_account",
        level: 1,
        kind: "line",
        section: "balances",
        values: closings,
        total: row.closing,
        accountId: row.account_id,
      });
    }
  }
  return rows;
};

/** The P&L lines (report_pnl summary keys) in their order */
const PNL_STRUCTURE: {
  key: string;
  kind: TableRow["kind"];
  level: 0 | 1;
  section?: string;
  /** Rows by article of this line (cash and manual) */
  line?: string;
}[] = [
  { key: "revenue", kind: "section", level: 0, section: "revenue" },
  { key: "services", kind: "line", level: 1, section: "revenue" },
  { key: "refunds", kind: "line", level: 1, section: "revenue" },
  { key: "revenue_manual", kind: "line", level: 1, section: "revenue" },
  { key: "cogs", kind: "section", level: 0, section: "cogs" },
  { key: "materials", kind: "line", level: 1, section: "cogs" },
  { key: "lab", kind: "line", level: 1, section: "cogs" },
  { key: "doctors", kind: "line", level: 1, section: "cogs" },
  { key: "gross", kind: "total", level: 0 },
  { key: "gross_margin", kind: "percent", level: 0 },
  { key: "opex", kind: "section", level: 0, section: "opex" },
  { key: "staff", kind: "line", level: 1, section: "opex" },
  { key: "marketing", kind: "line", level: 1, section: "opex" },
  { key: "opex_other", kind: "line", level: 1, section: "opex", line: "opex" },
  { key: "other_income", kind: "line", level: 0, line: "other_income" },
  { key: "ebitda", kind: "total", level: 0 },
  {
    key: "interest",
    kind: "line",
    level: 1,
    section: "below",
    line: "interest",
  },
  {
    key: "depreciation",
    kind: "line",
    level: 1,
    section: "below",
    line: "depreciation",
  },
  { key: "tax", kind: "line", level: 1, section: "below", line: "tax" },
  { key: "net", kind: "total", level: 0 },
  { key: "net_margin", kind: "percent", level: 0 },
];

/** «ПиУ»: revenue → cost of sales → gross → operating → EBITDA → net */
export const pnlRows = (
  report: PnlReport,
  articles: FinanceArticle[],
): TableRow[] => {
  const months = report.months;
  const summary = (key: string) =>
    months.map((month) => {
      const row = report.summary.find((s) => s.month === month) as
        | Record<string, unknown>
        | undefined;
      return (row?.[key] as number | null | undefined) ?? 0;
    });
  const totalOf = (key: string) =>
    (report.total as unknown as Record<string, number | null>)[key] ?? null;
  const factRows = (filter: (r: PnlReport["rows"][number]) => boolean) =>
    months.map((month) =>
      report.rows
        .filter((r) => r.month === month && filter(r))
        .reduce((s, r) => s + r.amount, 0),
    );
  const rows: TableRow[] = [];
  for (const item of PNL_STRUCTURE) {
    let values: (number | null)[];
    let total: number | null;
    if (item.key === "services") {
      values = factRows((r) => r.line === "revenue" && r.source === "services");
      total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
    } else if (item.key === "revenue_manual") {
      values = factRows((r) => r.line === "revenue" && r.source !== "services");
      total = values.reduce<number>((s, v) => s + (v ?? 0), 0);
      if (!total && values.every((v) => !v)) continue;
    } else if (item.key === "refunds") {
      values = summary("refunds").map((v) => -(v ?? 0));
      total = -(totalOf("refunds") ?? 0);
    } else if (item.kind === "percent") {
      values = months.map((month) => {
        const row = report.summary.find((s) => s.month === month);
        return (row?.[item.key as "gross_margin"] as number | null) ?? null;
      });
      total = totalOf(item.key);
    } else {
      values = summary(item.key);
      total = totalOf(item.key);
    }
    if (item.key === "other_income" && !total && values.every((v) => !v))
      continue;
    rows.push({
      key: item.key,
      labelKey: `finance.pnl.lines.${item.key}`,
      level: item.level,
      kind: item.kind,
      section: item.section,
      values,
      total,
    });
    // The articles of a cash-basis line
    if (item.line) {
      const ids = [
        ...new Set(
          report.rows
            .filter((r) => r.line === item.line && r.article_id != null)
            .map((r) => String(r.article_id)),
        ),
      ];
      const own = articles
        .filter((a) => ids.includes(String(a.id)))
        .sort(byPosition);
      if (own.length > 1 || (own.length === 1 && item.line === "opex")) {
        for (const article of own) {
          const v = factRows(
            (r) => r.line === item.line && same(r.article_id, article.id),
          );
          rows.push({
            key: `${item.key}-${article.id}`,
            name: article.name,
            level: 1,
            kind: "line",
            section: item.section ?? item.key,
            values: v,
            total: v.reduce((s, x) => s + x, 0),
          });
        }
      }
    }
  }
  return rows;
};

/** The P&L ratios (the tiles and the CSV) */
export const PNL_RATIOS = [
  "revenue_per_chair",
  "avg_check",
  "lab_share",
  "payroll_share",
] as const;

/** «Финмодель»: the plan by month */
export const modelRows = (report: FinanceModelReport): TableRow[] => {
  const structure: {
    key: string;
    kind: TableRow["kind"];
    level: 0 | 1;
    section?: string;
  }[] = [
    { key: "visits", kind: "count", level: 0 },
    { key: "revenue", kind: "total", level: 0 },
    { key: "cogs", kind: "section", level: 0, section: "cogs" },
    { key: "doctors", kind: "line", level: 1, section: "cogs" },
    { key: "lab", kind: "line", level: 1, section: "cogs" },
    { key: "materials", kind: "line", level: 1, section: "cogs" },
    { key: "gross", kind: "total", level: 0 },
    { key: "opex", kind: "section", level: 0, section: "opex" },
    { key: "staff", kind: "line", level: 1, section: "opex" },
    { key: "marketing", kind: "line", level: 1, section: "opex" },
    { key: "opex_other", kind: "line", level: 1, section: "opex" },
    { key: "ebitda", kind: "total", level: 0 },
    { key: "interest", kind: "line", level: 1, section: "below" },
    { key: "depreciation", kind: "line", level: 1, section: "below" },
    { key: "tax", kind: "line", level: 1, section: "below" },
    { key: "net", kind: "total", level: 0 },
    { key: "cash_flow", kind: "line", level: 0 },
    { key: "cash", kind: "total", level: 0 },
    { key: "break_even_revenue", kind: "line", level: 0 },
    { key: "break_even_utilization", kind: "percent", level: 0 },
  ];
  return structure.map((item) => {
    const values = report.months.map(
      (month) =>
        (month as unknown as Record<string, number | null>)[item.key] ?? null,
    );
    const total =
      item.key === "cash"
        ? report.total.closing_cash
        : item.key in report.total
          ? ((report.total as unknown as Record<string, number | null>)[
              item.key
            ] ?? null)
          : null;
    return {
      key: item.key,
      labelKey: `finance.model.rows.${item.key}`,
      level: item.level,
      kind: item.kind,
      section: item.section,
      values,
      total,
    };
  });
};

/** A table as CSV rows: the label column, one per period, the total */
export const csvRows = (
  rows: TableRow[],
  headers: string[],
  labelOf: (row: TableRow) => string,
  labelHeader: string,
  totalHeader: string,
) =>
  rows.map((row) => {
    const out: Record<string, string | number> = {
      [labelHeader]: labelOf(row),
    };
    headers.forEach((header, i) => {
      out[header] = row.values[i] ?? "";
    });
    out[totalHeader] = row.total ?? "";
    return out;
  });
