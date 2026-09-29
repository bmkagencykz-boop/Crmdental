import type { Identifier } from "ra-core";

/** Finance (stage 44): see supabase/schemas/44_finance.sql */

export type FinanceAccountKind = "cash" | "bank" | "kaspi" | "other";
export type FinanceAccountCode = "till" | "kaspi" | "bank";

export type FinanceAccount = {
  id: Identifier;
  organization_id?: Identifier;
  name: string;
  kind: FinanceAccountKind;
  code?: FinanceAccountCode | null;
  /** «Остаток на начало» at the start of opening_date */
  opening_balance: number;
  opening_date?: string | null;
  is_active: boolean;
  position: number;
  created_at?: string;
};

export type ArticleSection = "in" | "out";
export type ArticleActivity = "operating" | "investing" | "financing";
export const PNL_LINES = [
  "revenue",
  "other_income",
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
export type PnlLine = (typeof PNL_LINES)[number];

/** P&L lines computed by accrual: payments on their articles are no P&L */
export const ACCRUAL_LINES: PnlLine[] = [
  "revenue",
  "materials",
  "lab",
  "doctors",
  "staff",
];
/** P&L lines that take the payments of their articles (cash basis) */
export const CASH_LINES: PnlLine[] = [
  "other_income",
  "marketing",
  "opex",
  "interest",
  "depreciation",
  "tax",
];

export type ArticleCode =
  | "services"
  | "prepayments"
  | "refunds"
  | "other_in"
  | "loans_in"
  | "owner_in"
  | "salary_doctors"
  | "salary_staff"
  | "lab"
  | "materials"
  | "rent"
  | "utilities"
  | "marketing"
  | "taxes"
  | "loans"
  | "interest"
  | "equipment"
  | "dividends"
  | "depreciation"
  | "other_out";

export type FinanceArticle = {
  id: Identifier;
  organization_id?: Identifier;
  name: string;
  code?: ArticleCode | null;
  section: ArticleSection;
  activity: ArticleActivity;
  pnl_line?: PnlLine | null;
  is_active: boolean;
  position: number;
  created_at?: string;
};

export const FINANCE_METHODS = [
  "cash",
  "card",
  "kaspi_qr",
  "kaspi_transfer",
  "bank_transfer",
  "insurance",
  "other",
] as const;
export type FinanceMethod = (typeof FINANCE_METHODS)[number];

export type FinanceMethodAccount = {
  method: FinanceMethod;
  account_id: Identifier;
};

export type FinanceTransactionKind = "in" | "out" | "transfer" | "accrual";

export type FinanceTransaction = {
  id: Identifier;
  organization_id?: Identifier;
  kind: FinanceTransactionKind;
  /** YYYY-MM-DD */
  occurred_on: string;
  account_id?: Identifier | null;
  to_account_id?: Identifier | null;
  article_id?: Identifier | null;
  amount: number;
  counterparty?: string | null;
  comment?: string | null;
  branch_id?: Identifier | null;
  /** The payout / lab payment paid without the cash desk */
  payroll_adjustment_id?: Identifier | null;
  lab_payment_id?: Identifier | null;
  created_by?: Identifier | null;
  created_at?: string;
};

/** A money movement (private.finance_movements): + in, − out */
export type Movement = {
  source: "operation" | "transaction";
  source_id: Identifier;
  day: string;
  account_id: Identifier | null;
  article_id: Identifier | null;
  amount: number;
  branch_id: Identifier | null;
  transfer: boolean;
  counterparty: string | null;
  comment: string | null;
};

export type Granularity = "day" | "week" | "month";

/** public.report_cash_flow */
export type CashFlowReport = {
  granularity: Granularity;
  from: string;
  to: string;
  periods: string[];
  balances: boolean;
  rows: { article_id: Identifier; period: string; amount: number }[];
  accounts: {
    account_id: Identifier | null;
    opening: number | null;
    closing: number | null;
    flow: number;
    flows: { period: string; amount: number }[];
  }[];
  totals: {
    period: string;
    inflow: number;
    outflow: number;
    net: number;
    opening: number | null;
    closing: number | null;
  }[];
  total: {
    inflow: number;
    outflow: number;
    net: number;
    opening: number | null;
    closing: number | null;
  };
};

export type PnlFactSource =
  | "services"
  | "refunds"
  | "lab"
  | "payroll"
  | "ad_spend"
  | "cash"
  | "manual";
export type PnlFactLine = PnlLine | "refunds";

/** A P&L amount (private.finance_pnl_facts) */
export type PnlFact = {
  month: string;
  line: PnlFactLine;
  source: PnlFactSource;
  article_id: Identifier | null;
  branch_id: Identifier | null;
  amount: number;
};

export type PnlSummary = {
  revenue: number;
  refunds: number;
  materials: number;
  lab: number;
  doctors: number;
  staff: number;
  marketing: number;
  opex_other: number;
  other_income: number;
  interest: number;
  depreciation: number;
  tax: number;
  cogs: number;
  gross: number;
  opex: number;
  ebitda: number;
  net: number;
  gross_margin: number | null;
  net_margin: number | null;
  visits: number;
  avg_check: number | null;
  revenue_per_chair: number | null;
  lab_share: number | null;
  payroll_share: number | null;
};

/** public.report_pnl */
export type PnlReport = {
  from: string;
  to: string;
  chairs: number;
  months: string[];
  rows: {
    month: string;
    line: PnlFactLine;
    source: PnlFactSource;
    article_id: Identifier | null;
    amount: number;
  }[];
  summary: (PnlSummary & { month: string })[];
  total: PnlSummary;
};

export type Scenario = "base" | "optimistic" | "pessimistic";

export type FinanceModel = {
  id: Identifier;
  organization_id?: Identifier;
  name: string;
  /** YYYY-MM-01 */
  start_month: string;
  chairs: number;
  working_days: number;
  hours_per_day: number;
  /** % */
  utilization: number;
  visits_per_chair_hour: number;
  avg_check: number;
  optimistic_factor: number;
  pessimistic_factor: number;
  opening_cash: number;
  investment_amount: number;
  /** 0..11 */
  investment_month: number;
  note?: string | null;
  created_by?: Identifier | null;
  created_at?: string;
  updated_at?: string;
};

export type ModelDriver =
  | "chairs"
  | "working_days"
  | "hours_per_day"
  | "utilization"
  | "visits_per_chair_hour"
  | "avg_check";
export const MODEL_DRIVERS: ModelDriver[] = [
  "chairs",
  "working_days",
  "hours_per_day",
  "utilization",
  "visits_per_chair_hour",
  "avg_check",
];

export type FinanceModelMonth = {
  id: Identifier;
  organization_id?: Identifier;
  model_id: Identifier;
  month_index: number;
} & Partial<Record<ModelDriver, number | null>>;

export type ModelLinePnl =
  | "materials"
  | "lab"
  | "doctors"
  | "staff"
  | "marketing"
  | "opex"
  | "interest"
  | "depreciation"
  | "tax";
export const MODEL_LINE_PNL: ModelLinePnl[] = [
  "doctors",
  "lab",
  "materials",
  "staff",
  "marketing",
  "opex",
  "interest",
  "depreciation",
  "tax",
];

export type FinanceModelLine = {
  id: Identifier;
  organization_id?: Identifier;
  model_id: Identifier;
  name: string;
  article_id?: Identifier | null;
  pnl_line: ModelLinePnl;
  kind: "fixed" | "percent";
  amount: number;
  percent: number;
  from_index: number;
  to_index: number;
  position: number;
};

export type ModelPlanMonth = {
  index: number;
  month: string;
  chairs: number;
  working_days: number;
  hours_per_day: number;
  utilization: number;
  visits_per_chair_hour: number;
  avg_check: number;
  visits: number;
  revenue: number;
  materials: number;
  lab: number;
  doctors: number;
  staff: number;
  marketing: number;
  opex_other: number;
  interest: number;
  depreciation: number;
  tax: number;
  cogs: number;
  gross: number;
  opex: number;
  ebitda: number;
  net: number;
  cash_flow: number;
  cash: number;
  fixed_costs: number;
  variable_percent: number;
  break_even_revenue: number | null;
  break_even_utilization: number | null;
  lines: { line_id: Identifier; amount: number }[];
};

export type ModelPlanTotal = {
  visits: number;
  revenue: number;
  materials: number;
  lab: number;
  doctors: number;
  staff: number;
  marketing: number;
  opex_other: number;
  interest: number;
  depreciation: number;
  tax: number;
  cogs: number;
  gross: number;
  opex: number;
  ebitda: number;
  net: number;
  cash_flow: number;
  closing_cash: number;
  gross_margin: number | null;
  net_margin: number | null;
};

export type ModelFact = {
  month: string;
  revenue: number;
  gross: number;
  ebitda: number;
  net: number;
  visits: number;
  revenue_delta: number;
  net_delta: number;
  revenue_percent: number | null;
  partial: boolean;
};

/** public.report_finance_model */
export type FinanceModelReport = {
  model_id: Identifier;
  scenario: Scenario;
  factor: number;
  start_month: string;
  months: ModelPlanMonth[];
  total: ModelPlanTotal;
  investment: number;
  payback_months: number | null;
  payback_in_horizon: boolean;
  current_month: string;
  fact: ModelFact[];
};
