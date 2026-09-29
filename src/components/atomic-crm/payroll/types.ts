import type { Identifier } from "ra-core";

/** «Процент от»: the price of the work or the part the patient paid */
export const PERCENT_BASES = ["price", "paid"] as const;
export type PercentBase = (typeof PERCENT_BASES)[number];

/** A percentage of a section (or subsection) of the price list */
export type CategoryRate = { category_id: Identifier; percent: number };

/** public.payroll_schemes: the pay scheme of a doctor or an employee */
export type PayrollScheme = {
  id: Identifier;
  organization_id?: Identifier;
  doctor_id?: Identifier | null;
  sales_id?: Identifier | null;
  /** YYYY-MM-DD: the scheme of a day is the last one effective on it */
  effective_from: string;
  /** «Оклад» per month, ₸ */
  fixed_salary: number;
  /** Default percentage of the work */
  percent: number;
  percent_base: PercentBase;
  /** The cost price of the service (stage 35) is deducted first */
  deduct_materials: boolean;
  category_rates: CategoryRate[];
  /** ₸ per completed visit */
  visit_rate: number;
  /** «Минимум»: the month is topped up to it */
  min_guaranteed: number;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const ADJUSTMENT_KINDS = ["bonus", "penalty", "payout"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** public.payroll_adjustments: «премия», «штраф», «выплата» */
export type PayrollAdjustment = {
  id: Identifier;
  organization_id?: Identifier;
  doctor_id?: Identifier | null;
  sales_id?: Identifier | null;
  /** The first day of the month, YYYY-MM-01 */
  month: string;
  kind: AdjustmentKind;
  amount: number;
  note?: string | null;
  /** YYYY-MM-DD */
  occurred_on: string;
  /** A payout given from the cash desk: its expense (stage 42) */
  account_operation_id?: Identifier | null;
  created_by?: Identifier | null;
  created_at?: string;
};

/** public.payroll_months: a closed month */
export type PayrollMonthRow = {
  id: Identifier;
  organization_id?: Identifier;
  month: string;
  closed_at: string;
  closed_by?: Identifier | null;
};

export const LINE_SOURCES = [
  "plan_item",
  "visit",
  "payment",
  "visit_rate",
  "fixed",
  "minimum",
] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

/** A payroll line (private.payroll_compute) */
export type PayrollLine = {
  doctor_id: Identifier | null;
  sales_id: Identifier | null;
  scheme_id: Identifier | null;
  source: LineSource;
  /** The plan item, the visit or the account operation */
  source_id: Identifier | null;
  /** YYYY-MM-DD, null for the salary and the minimum */
  work_day: string | null;
  patient_id: Identifier | null;
  patient_name: string | null;
  service_name: string | null;
  category_name: string | null;
  /** The price of the work (or the payment) */
  amount: number;
  /** Deducted cost price */
  materials: number;
  /** What the percent applies to */
  base: number;
  percent: number | null;
  accrued: number;
};

/** A frozen line of a closed month (public.payroll_closed_lines) */
export type PayrollClosedLine = PayrollLine & {
  id: Identifier;
  month: string;
};

/** A day of the month calendar */
export type PayrollDay = {
  day: string;
  works: number;
  amount: number;
  overdue: number;
  off: boolean;
};

/** A doctor or an employee of the month (public.payroll_month) */
export type PayrollEmployee = {
  kind: "doctor" | "sales";
  doctor_id: Identifier | null;
  sales_id: Identifier | null;
  name: string;
  /** The doctor's specialty, the employee's role */
  specialty: string | null;
  color: string | null;
  is_active: boolean;
  /** The scheme of the last day of the month */
  scheme: PayrollScheme | null;
  works_count: number;
  work_amount: number;
  materials: number;
  work_accrued: number;
  visits_count: number;
  visits_accrued: number;
  fixed: number;
  minimum: number;
  bonuses: number;
  penalties: number;
  /** Lines + bonuses − penalties */
  accrued: number;
  paid_out: number;
  /** «Остаток к выплате» */
  balance: number;
  overdue_count: number;
  days_off: number;
  days: PayrollDay[];
  lines: PayrollLine[];
  adjustments: PayrollAdjustment[];
};

export type PayrollMonth = {
  /** YYYY-MM-01 */
  month: string;
  closed: boolean;
  closed_at: string | null;
  closed_by: Identifier | null;
  employees: PayrollEmployee[];
};
