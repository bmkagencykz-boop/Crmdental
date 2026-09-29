import type { Identifier } from "ra-core";

import type { AccountOperation } from "../payments/types";
import type { PayrollAdjustment, PayrollLine } from "../payroll/types";
import { mulDiv, roundDiv } from "../payroll/payrollMath";
import { addDays, dayKeyOf, weekdayOf } from "../tasks/calendarLayout";
import { planTotal, stageTotal } from "../treatment/planMath";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../treatment/types";
import type { Service } from "../types";
import {
  CASH_LINES,
  MODEL_DRIVERS,
  type CashFlowReport,
  type FinanceAccount,
  type FinanceArticle,
  type FinanceMethodAccount,
  type FinanceModel,
  type FinanceModelLine,
  type FinanceModelMonth,
  type FinanceModelReport,
  type FinanceTransaction,
  type Granularity,
  type ModelFact,
  type ModelPlanMonth,
  type ModelPlanTotal,
  type Movement,
  type PnlFact,
  type PnlReport,
  type PnlSummary,
  type Scenario,
} from "./types";

/**
 * Finance (stage 44): the twin of supabase/schemas/44_finance.sql — the
 * money movements, the ДДС, the P&L facts and report, the financial model —
 * for the demo and the tests. Whole tenge, rounded half away from zero like
 * round() of PostgreSQL on numeric; BigInt keeps the products exact.
 */

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const int = (value: number | string | null | undefined) =>
  BigInt(Math.round(Number(value ?? 0)));
/** A value with up to two decimals, in hundredths */
const cents = (value: number | string | null | undefined) =>
  BigInt(Math.round(Number(value ?? 0) * 100));

/** ceil(n / d) for d > 0 */
const ceilDiv = (n: bigint, d: bigint): number => {
  const q = n / d;
  return Number(n % d !== 0n && n > 0n === d > 0n ? q + 1n : q);
};

/** round(part × 100 / whole, 1), null without a whole (private.finance_share) */
export const share = (part: number, whole: number | null | undefined) =>
  whole ? roundDiv(int(part) * 1000n, int(whole)) / 10 : null;

/** round(a / b), null when b is 0 (private.finance_ratio) */
export const ratio = (a: number, b: number | null | undefined) =>
  b ? roundDiv(int(a), int(b)) : null;

// --- dates -------------------------------------------------------------

/** YYYY-MM-01 of a day */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

export const addMonths = (month: string, count: number) => {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
};

/** The months from `from` (included) to `to` (excluded) */
export const monthsBetween = (from: string, to: string) => {
  const months: string[] = [];
  for (let m = monthOf(from); m < to; m = addMonths(m, 1)) months.push(m);
  return months;
};

/** The bucket of a day (private.finance_bucket): the day, its Monday, its month */
export const bucketOf = (day: string, granularity: Granularity) =>
  granularity === "day"
    ? day
    : granularity === "week"
      ? addDays(day, -weekdayOf(day))
      : monthOf(day);

const nextBucket = (bucket: string, granularity: Granularity) =>
  granularity === "day"
    ? addDays(bucket, 1)
    : granularity === "week"
      ? addDays(bucket, 7)
      : addMonths(bucket, 1);

/** The buckets of a half-open period of days */
export const periodsOf = (
  from: string,
  to: string,
  granularity: Granularity,
) => {
  const last = bucketOf(addDays(to, -1), granularity);
  const periods: string[] = [];
  for (
    let bucket = bucketOf(from, granularity);
    bucket <= last;
    bucket = nextBucket(bucket, granularity)
  ) {
    periods.push(bucket);
  }
  return periods;
};

/** Days between two days (b − a) */
const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );

// --- movements -----------------------------------------------------------

export type MovementInput = {
  operations: AccountOperation[];
  transactions: FinanceTransaction[];
  articles: FinanceArticle[];
  methodAccounts: FinanceMethodAccount[];
  categories: {
    id: Identifier;
    name: string;
    article_id?: Identifier | null;
  }[];
  adjustments: Pick<
    PayrollAdjustment,
    "id" | "doctor_id" | "account_operation_id"
  >[];
  patients: {
    id: Identifier;
    first_name?: string | null;
    last_name?: string | null;
  }[];
  timeZone?: string | null;
  /** Half-open, null: no bound */
  from?: string | null;
  to?: string | null;
};

/** The till effect of an operation (the generated column till_delta) */
export const tillDelta = (op: AccountOperation) => {
  if (op.till_delta != null) return op.till_delta;
  if (op.method === "deposit" || op.kind === "correction") return 0;
  if (op.kind === "payment" || op.kind === "deposit") return op.amount;
  if (op.kind === "refund" || op.kind === "expense") return -op.amount;
  return 0;
};

/** Every money movement (private.finance_movements) */
export const financeMovements = (input: MovementInput): Movement[] => {
  const code = (value: string) =>
    input.articles.find((article) => article.code === value)?.id ?? null;
  const services = code("services");
  const prepayments = code("prepayments");
  const refunds = code("refunds");
  const doctors = code("salary_doctors");
  const staff = code("salary_staff");
  const other = code("other_out");
  const accountOf = (method: string) =>
    input.methodAccounts.find((row) => row.method === method)?.account_id ??
    null;
  const inside = (day: string) =>
    (!input.from || day >= input.from) && (!input.to || day < input.to);
  const movements: Movement[] = [];
  for (const op of input.operations) {
    const delta = tillDelta(op);
    if (delta === 0) continue;
    const day = dayKeyOf(op.occurred_at, input.timeZone);
    if (!inside(day)) continue;
    let article: Identifier | null;
    if (op.kind === "payment") article = op.prepayment ? prepayments : services;
    else if (op.kind === "deposit") article = prepayments;
    else if (op.kind === "refund") article = refunds;
    else {
      const payout = input.adjustments.find((row) =>
        same(row.account_operation_id, op.id),
      );
      const category = input.categories.find((row) =>
        same(row.id, op.category_id),
      );
      article = payout
        ? payout.doctor_id != null
          ? doctors
          : staff
        : (category?.article_id ?? other);
    }
    const patient = input.patients.find((row) => same(row.id, op.patient_id));
    const patientName =
      [patient?.last_name, patient?.first_name]
        .filter(Boolean)
        .join(" ")
        .trim() || null;
    const category = input.categories.find((row) =>
      same(row.id, op.category_id),
    );
    const parts =
      op.method === "mixed"
        ? (op.parts ?? []).map((part) => ({
            method: part.method,
            amount: part.amount,
          }))
        : [{ method: op.method, amount: op.amount }];
    for (const part of parts) {
      if (!part.amount) continue;
      movements.push({
        source: "operation",
        source_id: op.id,
        day,
        account_id: accountOf(part.method),
        article_id: article,
        amount: Math.sign(delta) * part.amount,
        branch_id: op.branch_id ?? null,
        transfer: false,
        counterparty: patientName ?? category?.name ?? null,
        comment: op.comment ?? null,
      });
    }
  }
  for (const t of input.transactions) {
    if (t.kind === "accrual" || !inside(t.occurred_on)) continue;
    const base = {
      source: "transaction" as const,
      source_id: t.id,
      day: t.occurred_on,
      branch_id: t.branch_id ?? null,
      transfer: t.kind === "transfer",
      counterparty: t.counterparty ?? null,
      comment: t.comment ?? null,
    };
    movements.push({
      ...base,
      account_id: t.account_id ?? null,
      article_id: t.article_id ?? null,
      amount: t.kind === "in" ? t.amount : -t.amount,
    });
    if (t.kind === "transfer") {
      movements.push({
        ...base,
        account_id: t.to_account_id ?? null,
        article_id: null,
        amount: t.amount,
      });
    }
  }
  return movements;
};

/** The drill-down (public.report_cash_flow_movements) */
export const filterMovements = (
  movements: Movement[],
  filters: {
    from: string;
    to: string;
    branch_id?: Identifier | null;
    article_id?: Identifier | null;
    account_id?: Identifier | null;
    transfers?: boolean;
  },
) =>
  movements
    .filter(
      (m) =>
        m.day >= filters.from &&
        m.day < filters.to &&
        (filters.branch_id == null || same(m.branch_id, filters.branch_id)) &&
        (filters.article_id == null ||
          same(m.article_id, filters.article_id)) &&
        (filters.account_id == null ||
          same(m.account_id, filters.account_id)) &&
        (!filters.transfers || m.transfer),
    )
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        a.source.localeCompare(b.source) ||
        Number(b.source_id) - Number(a.source_id),
    )
    .slice(0, 1000);

// --- ДДС -----------------------------------------------------------------

/**
 * «ДДС» (public.report_cash_flow): movements (all of them up to `to`) by
 * article and period, the accounts with their balances, the totals
 */
export const cashFlowReport = (input: {
  movements: Movement[];
  accounts: FinanceAccount[];
  articles: FinanceArticle[];
  from: string;
  to: string;
  branchId?: Identifier | null;
  granularity?: Granularity;
}): CashFlowReport => {
  const granularity = input.granularity ?? "month";
  const periods = periodsOf(input.from, input.to, granularity);
  const balances = input.branchId == null;
  const mv = input.movements
    .filter(
      (m) =>
        m.day < input.to &&
        (input.branchId == null || same(m.branch_id, input.branchId)),
    )
    .map((m) => ({ ...m, period: bucketOf(m.day, granularity) }));
  const inside = mv.filter((m) => m.day >= input.from);

  const rowMap = new Map<
    string,
    { article_id: Identifier; period: string; amount: number }
  >();
  for (const m of inside) {
    if (m.transfer || m.article_id == null) continue;
    const key = `${m.article_id}|${m.period}`;
    const row = rowMap.get(key) ?? {
      article_id: m.article_id,
      period: m.period,
      amount: 0,
    };
    row.amount += m.amount;
    rowMap.set(key, row);
  }
  const rows = [...rowMap.values()].sort(
    (a, b) =>
      Number(a.article_id) - Number(b.article_id) ||
      a.period.localeCompare(b.period),
  );

  const accountRows: {
    account_id: Identifier | null;
    opening_balance: number;
    opening_date: string | null;
    position: number;
  }[] = input.accounts.map((a) => ({
    account_id: a.id,
    opening_balance: a.opening_balance ?? 0,
    opening_date: a.opening_date ?? null,
    position: a.position,
  }));
  if (mv.some((m) => m.account_id == null)) {
    accountRows.push({
      account_id: null,
      opening_balance: 0,
      opening_date: null,
      position: 1_000_000,
    });
  }
  const sameAccount = (m: Movement, account: Identifier | null) =>
    account == null ? m.account_id == null : same(m.account_id, account);
  const accounts = accountRows
    .sort(
      (a, b) =>
        a.position - b.position ||
        Number(a.account_id ?? 0) - Number(b.account_id ?? 0),
    )
    .map((a) => {
      const opening = balances
        ? a.opening_balance +
          mv
            .filter((m) => sameAccount(m, a.account_id) && m.day < input.from)
            .reduce((sum, m) => sum + m.amount, 0) -
          mv
            .filter(
              (m) =>
                sameAccount(m, a.account_id) &&
                a.opening_date != null &&
                m.day < a.opening_date,
            )
            .reduce((sum, m) => sum + m.amount, 0)
        : null;
      const own = inside.filter((m) => sameAccount(m, a.account_id));
      const flow = own.reduce((sum, m) => sum + m.amount, 0);
      const flowMap = new Map<string, number>();
      for (const m of own)
        flowMap.set(m.period, (flowMap.get(m.period) ?? 0) + m.amount);
      return {
        account_id: a.account_id,
        opening,
        closing: opening == null ? null : opening + flow,
        flow,
        flows: [...flowMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([period, amount]) => ({ period, amount })),
      };
    });

  const sectionOf = (id: Identifier | null) =>
    input.articles.find((article) => same(article.id, id))?.section;
  const openingTotal = balances
    ? accounts.reduce((sum, a) => sum + (a.opening ?? 0), 0)
    : null;
  let running = openingTotal;
  const totals = periods.map((period) => {
    const own = inside.filter((m) => m.period === period && !m.transfer);
    const inflow = own
      .filter((m) => sectionOf(m.article_id) === "in")
      .reduce((sum, m) => sum + m.amount, 0);
    const outflow = -own
      .filter((m) => sectionOf(m.article_id) === "out")
      .reduce((sum, m) => sum + m.amount, 0);
    const net = own.reduce((sum, m) => sum + m.amount, 0);
    const opening = running;
    running = running == null ? null : running + net;
    return {
      period,
      inflow: inflow || 0,
      outflow: outflow || 0,
      net,
      opening,
      closing: running,
    };
  });
  const sum = (key: "inflow" | "outflow" | "net") =>
    totals.reduce((total, row) => total + row[key], 0);
  return {
    granularity,
    from: input.from,
    to: input.to,
    periods,
    balances,
    rows,
    accounts,
    totals,
    total: {
      inflow: sum("inflow"),
      outflow: sum("outflow"),
      net: sum("net"),
      opening: openingTotal,
      closing: openingTotal == null ? null : openingTotal + sum("net"),
    },
  };
};

// --- P&L -------------------------------------------------------------------

export type RevenueInput = {
  plans: TreatmentPlan[];
  stages: TreatmentStage[];
  items: (TreatmentPlanItem & { doctor_id?: Identifier | null })[];
  visits: {
    id: Identifier;
    status: string;
    source?: string | null;
    service_id?: Identifier | null;
    deal_id?: Identifier | null;
    doctor_id?: Identifier | null;
    branch_id?: Identifier | null;
    starts_at: string;
  }[];
  services: Pick<Service, "id" | "price">[];
  costs: { service_id: Identifier; cost_price: number }[];
  deals: { id: Identifier; branch_id?: Identifier | null }[];
  timeZone?: string | null;
};

export type RevenueItem = {
  source: "plan_item" | "visit";
  source_id: Identifier;
  day: string;
  amount: number;
  cost: number;
  branch_id: Identifier | null;
  doctor_id: Identifier | null;
};

/**
 * Services rendered between two days (private.finance_revenue_items): done
 * plan items at their net price, completed priced CRM visits of deals
 * without a plan; with the cost price of the materials
 */
export const revenueItems = (
  input: RevenueInput,
  from: string,
  to: string,
): RevenueItem[] => {
  const dayOf = (value: string | null | undefined) =>
    value ? dayKeyOf(value, input.timeZone) : null;
  const inRange = (value: string | null | undefined) => {
    const day = dayOf(value);
    return day != null && day >= from && day < to ? day : null;
  };
  const costOf = (serviceId: Identifier | null | undefined, quantity = 1) => {
    const cost = input.costs.find((row) => same(row.service_id, serviceId));
    return cost ? roundDiv(cents(cost.cost_price) * int(quantity), 100n) : 0;
  };
  const result: RevenueItem[] = [];
  const planIds = new Set(
    input.items
      .filter((item) => item.done && inRange(item.done_at))
      .map((item) => String(item.plan_id)),
  );
  for (const plan of input.plans) {
    if (!planIds.has(String(plan.id)) || plan.status === "declined") continue;
    const stages = input.stages.filter((stage) => same(stage.plan_id, plan.id));
    const items = input.items.filter((item) => same(item.plan_id, plan.id));
    const linesOf = (stageId: Identifier) =>
      items
        .filter((item) => same(item.stage_id, stageId))
        .reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
    const subtotal = stages
      .filter((stage) => stage.status !== "cancelled")
      .reduce(
        (sum, stage) =>
          sum + stageTotal(linesOf(stage.id), stage.discount_percent),
        0,
      );
    const total = planTotal(
      subtotal,
      plan.discount_percent,
      plan.discount_amount,
    );
    const deal = input.deals.find((row) => same(row.id, plan.deal_id));
    for (const item of items) {
      const stage = stages.find((row) => same(row.id, item.stage_id));
      const day = item.done ? inRange(item.done_at) : null;
      if (!day || !stage || stage.status === "cancelled") continue;
      const stageLines = linesOf(stage.id);
      result.push({
        source: "plan_item",
        source_id: item.id,
        day,
        amount: roundDiv(
          int(item.line_total) *
            int(stageTotal(stageLines, stage.discount_percent)) *
            int(total),
          int(stageLines) * int(subtotal),
        ),
        cost: costOf(item.service_id, item.quantity),
        branch_id: deal?.branch_id ?? null,
        doctor_id: item.doctor_id ?? stage.doctor_id ?? plan.doctor_id ?? null,
      });
    }
  }
  for (const visit of input.visits) {
    const day = inRange(visit.starts_at);
    const service = input.services.find((row) =>
      same(row.id, visit.service_id),
    );
    if (
      !day ||
      visit.status !== "completed" ||
      (visit.source ?? "crm") !== "crm" ||
      !service ||
      !(Number(service.price) > 0) ||
      input.plans.some(
        (plan) =>
          same(plan.deal_id, visit.deal_id) && plan.status !== "declined",
      )
    )
      continue;
    result.push({
      source: "visit",
      source_id: visit.id,
      day,
      amount: roundDiv(cents(service.price), 100n),
      cost: costOf(service.id),
      branch_id: visit.branch_id ?? null,
      doctor_id: visit.doctor_id ?? null,
    });
  }
  return result;
};

export type PnlInput = RevenueInput & {
  operations: AccountOperation[];
  labCosts: {
    month?: string | null;
    amount: number;
    branch_id?: Identifier | null;
  }[];
  /** The payroll lines of a month (frozen or computed) */
  payrollLines: (
    month: string,
  ) => Pick<PayrollLine, "doctor_id" | "source" | "accrued">[];
  adjustments: Pick<
    PayrollAdjustment,
    "doctor_id" | "month" | "kind" | "amount"
  >[];
  doctors: { id: Identifier; branch_id?: Identifier | null }[];
  adSpend: { spent_from: string; spent_to: string; amount: number }[];
  /** The movements of the period (financeMovements) */
  movements: Movement[];
  transactions: FinanceTransaction[];
  articles: FinanceArticle[];
};

/** Every amount of the P&L between two months (private.finance_pnl_facts) */
export const pnlFacts = (
  input: PnlInput,
  fromMonth: string,
  toMonth: string,
): PnlFact[] => {
  const facts: PnlFact[] = [];
  const push = (fact: PnlFact) => {
    if (
      fact.amount !== 0 ||
      fact.source === "refunds" ||
      fact.source === "payroll"
    )
      facts.push(fact);
  };
  for (const item of revenueItems(input, fromMonth, toMonth)) {
    const month = monthOf(item.day);
    push({
      month,
      line: "revenue",
      source: "services",
      article_id: null,
      branch_id: item.branch_id,
      amount: item.amount,
    });
    push({
      month,
      line: "materials",
      source: "services",
      article_id: null,
      branch_id: item.branch_id,
      amount: item.cost,
    });
  }
  for (const op of input.operations) {
    if (op.kind !== "refund" || op.account !== "services") continue;
    const day = dayKeyOf(op.occurred_at, input.timeZone);
    if (day < fromMonth || day >= toMonth) continue;
    push({
      month: monthOf(day),
      line: "refunds",
      source: "refunds",
      article_id: null,
      branch_id: op.branch_id ?? null,
      amount: op.amount,
    });
  }
  for (const cost of input.labCosts) {
    if (
      !cost.month ||
      cost.month < fromMonth ||
      cost.month >= toMonth ||
      !cost.amount
    )
      continue;
    push({
      month: cost.month,
      line: "lab",
      source: "lab",
      article_id: null,
      branch_id: cost.branch_id ?? null,
      amount: cost.amount,
    });
  }
  const branchOfDoctor = (id: Identifier | null | undefined) =>
    input.doctors.find((row) => same(row.id, id))?.branch_id ?? null;
  for (const month of monthsBetween(fromMonth, toMonth)) {
    for (const line of input.payrollLines(month)) {
      if (!line.accrued) continue;
      facts.push({
        month,
        line:
          line.doctor_id != null && line.source !== "fixed"
            ? "doctors"
            : "staff",
        source: "payroll",
        article_id: null,
        branch_id: branchOfDoctor(line.doctor_id),
        amount: line.accrued,
      });
    }
  }
  for (const a of input.adjustments) {
    if (
      (a.kind !== "bonus" && a.kind !== "penalty") ||
      a.month < fromMonth ||
      a.month >= toMonth
    )
      continue;
    facts.push({
      month: a.month,
      line: a.doctor_id != null ? "doctors" : "staff",
      source: "payroll",
      article_id: null,
      branch_id: branchOfDoctor(a.doctor_id),
      amount: a.kind === "bonus" ? a.amount : -a.amount,
    });
  }
  for (const spend of input.adSpend) {
    if (
      spend.spent_to < fromMonth ||
      spend.spent_from >= toMonth ||
      !(spend.amount > 0)
    )
      continue;
    const total = daysBetween(spend.spent_from, spend.spent_to) + 1;
    const first = monthOf(
      spend.spent_from > fromMonth ? spend.spent_from : fromMonth,
    );
    const lastDay =
      spend.spent_to < addDays(toMonth, -1)
        ? spend.spent_to
        : addDays(toMonth, -1);
    for (
      let month = first;
      month <= monthOf(lastDay);
      month = addMonths(month, 1)
    ) {
      const end = addMonths(month, 1);
      const upto =
        addDays(spend.spent_to, 1) < end ? addDays(spend.spent_to, 1) : end;
      const since = spend.spent_from > month ? spend.spent_from : month;
      facts.push({
        month,
        line: "marketing",
        source: "ad_spend",
        article_id: null,
        branch_id: null,
        amount: roundDiv(
          int(spend.amount) * BigInt(daysBetween(since, upto)),
          BigInt(total),
        ),
      });
    }
  }
  const articleOf = (id: Identifier | null | undefined) =>
    input.articles.find((row) => same(row.id, id));
  for (const m of input.movements) {
    if (m.transfer || m.day < fromMonth || m.day >= toMonth) continue;
    const article = articleOf(m.article_id);
    if (!article?.pnl_line || !CASH_LINES.includes(article.pnl_line)) continue;
    facts.push({
      month: monthOf(m.day),
      line: article.pnl_line,
      source: "cash",
      article_id: article.id,
      branch_id: m.branch_id,
      amount: article.pnl_line === "other_income" ? m.amount : -m.amount,
    });
  }
  for (const t of input.transactions) {
    if (
      t.kind !== "accrual" ||
      t.occurred_on < fromMonth ||
      t.occurred_on >= toMonth
    )
      continue;
    const article = articleOf(t.article_id);
    if (!article?.pnl_line) continue;
    facts.push({
      month: monthOf(t.occurred_on),
      line: article.pnl_line,
      source: "manual",
      article_id: article.id,
      branch_id: t.branch_id ?? null,
      amount: t.amount,
    });
  }
  return facts;
};

const summaryOf = (
  sums: Record<string, number>,
  visits: number,
  chairs: number,
): PnlSummary => {
  const revenue = (sums.revenue ?? 0) - (sums.refunds ?? 0);
  const materials = sums.materials ?? 0;
  const lab = sums.lab ?? 0;
  const doctors = sums.doctors ?? 0;
  const staff = sums.staff ?? 0;
  const marketing = sums.marketing ?? 0;
  const opexOther = sums.opex ?? 0;
  const otherIncome = sums.other_income ?? 0;
  const interest = sums.interest ?? 0;
  const depreciation = sums.depreciation ?? 0;
  const tax = sums.tax ?? 0;
  const cogs = materials + lab + doctors;
  const gross = revenue - cogs;
  const opex = staff + marketing + opexOther;
  const ebitda = gross - opex + otherIncome;
  const net = ebitda - interest - depreciation - tax;
  return {
    revenue,
    refunds: sums.refunds ?? 0,
    materials,
    lab,
    doctors,
    staff,
    marketing,
    opex_other: opexOther,
    other_income: otherIncome,
    interest,
    depreciation,
    tax,
    cogs,
    gross,
    opex,
    ebitda,
    net,
    gross_margin: share(gross, revenue),
    net_margin: share(net, revenue),
    visits,
    // The work of the CRM per visit (accruals from another system aside)
    avg_check: ratio((sums.services ?? 0) - (sums.refunds ?? 0), visits),
    revenue_per_chair: ratio(revenue, chairs),
    lab_share: share(lab, revenue),
    payroll_share: share(doctors + staff, revenue),
  };
};

/** «ПиУ» (private.finance_pnl): facts → rows, months, total, ratios */
export const pnlReport = (input: {
  facts: PnlFact[];
  from: string;
  to: string;
  branchId?: Identifier | null;
  /** Completed visits (the average check), any source */
  visits: {
    status: string;
    starts_at: string;
    branch_id?: Identifier | null;
  }[];
  chairs: { is_active: boolean; branch_id?: Identifier | null }[];
  timeZone?: string | null;
}): PnlReport => {
  const months = monthsBetween(input.from, input.to);
  const facts = input.facts.filter(
    (fact) => input.branchId == null || same(fact.branch_id, input.branchId),
  );
  const chairs = input.chairs.filter(
    (chair) =>
      chair.is_active &&
      (input.branchId == null || same(chair.branch_id, input.branchId)),
  ).length;
  const rowMap = new Map<string, PnlReport["rows"][number]>();
  for (const fact of facts) {
    const key = `${fact.month}|${fact.line}|${fact.source}|${fact.article_id ?? ""}`;
    const row = rowMap.get(key) ?? {
      month: fact.month,
      line: fact.line,
      source: fact.source,
      article_id: fact.article_id,
      amount: 0,
    };
    row.amount += fact.amount;
    rowMap.set(key, row);
  }
  const rows = [...rowMap.values()].sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      a.line.localeCompare(b.line) ||
      a.source.localeCompare(b.source) ||
      Number(a.article_id ?? Infinity) - Number(b.article_id ?? Infinity),
  );
  const visitsOf = (month: string) =>
    input.visits.filter((visit) => {
      if (visit.status !== "completed") return false;
      if (input.branchId != null && !same(visit.branch_id, input.branchId))
        return false;
      return monthOf(dayKeyOf(visit.starts_at, input.timeZone)) === month;
    }).length;
  const totalSums: Record<string, number> = {};
  let totalVisits = 0;
  const summary = months.map((month) => {
    const sums: Record<string, number> = {};
    for (const fact of facts) {
      if (fact.month !== month) continue;
      sums[fact.line] = (sums[fact.line] ?? 0) + fact.amount;
      totalSums[fact.line] = (totalSums[fact.line] ?? 0) + fact.amount;
      if (fact.line === "revenue" && fact.source === "services") {
        sums.services = (sums.services ?? 0) + fact.amount;
        totalSums.services = (totalSums.services ?? 0) + fact.amount;
      }
    }
    const visits = visitsOf(month);
    totalVisits += visits;
    return { month, ...summaryOf(sums, visits, chairs) };
  });
  return {
    from: input.from,
    to: input.to,
    chairs,
    months,
    rows,
    summary,
    total: summaryOf(totalSums, totalVisits, chairs * months.length),
  };
};

// --- the financial model --------------------------------------------------

const LINE_KEYS = [
  "materials",
  "lab",
  "doctors",
  "staff",
  "marketing",
  "opex",
  "interest",
  "depreciation",
  "tax",
] as const;

/** The factor of a scenario */
export const scenarioFactor = (model: FinanceModel, scenario: Scenario) =>
  scenario === "optimistic"
    ? Number(model.optimistic_factor)
    : scenario === "pessimistic"
      ? Number(model.pessimistic_factor)
      : 1;

/**
 * The plan of a model (private.finance_model_plan): visits =
 * round(chairs × days × hours × visits per chair-hour × utilization % ×
 * factor), revenue = visits × check; lines; break-even; cash; payback
 */
export const computeModel = (
  model: FinanceModel,
  monthRows: FinanceModelMonth[],
  lines: FinanceModelLine[],
  scenario: Scenario = "base",
): Omit<FinanceModelReport, "current_month" | "fact"> => {
  const factor = scenarioFactor(model, scenario);
  const sorted = [...lines].sort(
    (a, b) => a.position - b.position || Number(a.id) - Number(b.id),
  );
  let cash = Number(model.opening_cash);
  let paybackCum = 0;
  let payback: number | null = null;
  let afterCount = 0;
  let afterSum = 0;
  const investment = Number(model.investment_amount);
  const months: ModelPlanMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const override = monthRows.find((row) => Number(row.month_index) === i);
    const driver = Object.fromEntries(
      MODEL_DRIVERS.map((key) => [key, Number(override?.[key] ?? model[key])]),
    ) as Record<(typeof MODEL_DRIVERS)[number], number>;
    const capacity =
      cents(driver.chairs) *
      cents(driver.working_days) *
      cents(driver.hours_per_day) *
      cents(driver.visits_per_chair_hour);
    const visits = roundDiv(
      capacity * cents(driver.utilization) * cents(factor),
      100n ** 6n * 100n,
    );
    const revenue = visits * driver.avg_check;
    const sums: Record<string, number> = Object.fromEntries(
      LINE_KEYS.map((key) => [key, 0]),
    );
    const lineValues: ModelPlanMonth["lines"] = [];
    let fixed = 0;
    let percentCents = 0n;
    for (const line of sorted) {
      if (i < line.from_index || i > line.to_index) continue;
      let amount: number;
      if (line.kind === "percent") {
        amount = mulDiv(revenue, line.percent, 100);
        percentCents += cents(line.percent);
      } else {
        amount = Number(line.amount);
        fixed += amount;
      }
      sums[line.pnl_line] += amount;
      lineValues.push({ line_id: line.id, amount });
    }
    const cogs = sums.materials + sums.lab + sums.doctors;
    const gross = revenue - cogs;
    const opex = sums.staff + sums.marketing + sums.opex;
    const ebitda = gross - opex;
    const net = ebitda - sums.interest - sums.depreciation - sums.tax;
    const cashFlow =
      net +
      sums.depreciation -
      (i === Number(model.investment_month) ? investment : 0);
    cash += cashFlow;
    const beRevenue =
      percentCents < 10000n
        ? ceilDiv(int(fixed) * 10000n, 10000n - percentCents)
        : null;
    const capacityRevenue = capacity * int(driver.avg_check);
    const beUtilization =
      beRevenue != null && capacityRevenue > 0n
        ? roundDiv(int(beRevenue) * 1000n * 100n ** 4n, capacityRevenue) / 10
        : null;
    if (investment > 0 && i >= Number(model.investment_month)) {
      paybackCum += net + sums.depreciation;
      afterCount += 1;
      afterSum += net + sums.depreciation;
      if (payback == null && paybackCum >= investment) {
        payback = i - Number(model.investment_month) + 1;
      }
    }
    months.push({
      index: i,
      month: addMonths(monthOf(model.start_month), i),
      chairs: driver.chairs,
      working_days: driver.working_days,
      hours_per_day: driver.hours_per_day,
      utilization: driver.utilization,
      visits_per_chair_hour: driver.visits_per_chair_hour,
      avg_check: driver.avg_check,
      visits,
      revenue,
      materials: sums.materials,
      lab: sums.lab,
      doctors: sums.doctors,
      staff: sums.staff,
      marketing: sums.marketing,
      opex_other: sums.opex,
      interest: sums.interest,
      depreciation: sums.depreciation,
      tax: sums.tax,
      cogs,
      gross,
      opex,
      ebitda,
      net,
      cash_flow: cashFlow,
      cash,
      fixed_costs: fixed,
      variable_percent: Number(percentCents) / 100,
      break_even_revenue: beRevenue,
      break_even_utilization: beUtilization,
      lines: lineValues,
    });
  }
  const sum = (key: keyof ModelPlanMonth) =>
    months.reduce((total, month) => total + Number(month[key]), 0);
  const total: ModelPlanTotal = {
    visits: sum("visits"),
    revenue: sum("revenue"),
    materials: sum("materials"),
    lab: sum("lab"),
    doctors: sum("doctors"),
    staff: sum("staff"),
    marketing: sum("marketing"),
    opex_other: sum("opex_other"),
    interest: sum("interest"),
    depreciation: sum("depreciation"),
    tax: sum("tax"),
    cogs: sum("cogs"),
    gross: sum("gross"),
    opex: sum("opex"),
    ebitda: sum("ebitda"),
    net: sum("net"),
    cash_flow: sum("cash_flow"),
    closing_cash: cash,
    gross_margin: null,
    net_margin: null,
  };
  total.gross_margin = share(total.gross, total.revenue);
  total.net_margin = share(total.net, total.revenue);
  return {
    model_id: model.id,
    scenario,
    factor,
    start_month: monthOf(model.start_month),
    months,
    total,
    investment,
    payback_months:
      investment === 0
        ? null
        : payback != null
          ? payback
          : afterCount > 0 && afterSum > 0
            ? afterCount +
              ceilDiv(
                int(investment - paybackCum) * BigInt(afterCount),
                int(afterSum),
              )
            : null,
    payback_in_horizon: payback != null,
  };
};

/** Plan vs fact (public.report_finance_model): the P&L months of the model up to the current one */
export const modelFacts = (
  plan: Pick<FinanceModelReport, "months">,
  pnl: PnlReport | null,
  currentMonth: string,
): ModelFact[] =>
  (pnl?.summary ?? []).flatMap((s) => {
    const p = plan.months.find((month) => month.month === s.month);
    if (!p) return [];
    return [
      {
        month: s.month,
        revenue: s.revenue,
        gross: s.gross,
        ebitda: s.ebitda,
        net: s.net,
        visits: s.visits,
        revenue_delta: s.revenue - p.revenue,
        net_delta: s.net - p.net,
        revenue_percent: share(s.revenue, p.revenue),
        partial: s.month === currentMonth,
      },
    ];
  });

/** The months of a model with a fact: from its start to the current month, at most 12 */
export const factRange = (startMonth: string, currentMonth: string) => {
  const to = [
    addMonths(currentMonth, 1),
    addMonths(monthOf(startMonth), 12),
  ].sort()[0];
  return to > monthOf(startMonth) ? { from: monthOf(startMonth), to } : null;
};
