import type { Identifier } from "ra-core";

/**
 * Payments, deposits and the cash desk (stage 36, 36_payments.sql).
 */

/** The methods money really comes in by (a mixed payment splits in them) */
export const PAYMENT_METHODS = [
  "cash",
  "card",
  "kaspi_qr",
  "kaspi_transfer",
  "bank_transfer",
  "insurance",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * The method of an operation: a real one, «deposit» (paid from / returned
 * to the deposit), «mixed» (parts) or «other» (a deal payment written
 * without a method: MIS, import, API; a correction)
 */
export type OperationMethod = PaymentMethod | "deposit" | "mixed" | "other";

export const OPERATION_KINDS = [
  "payment",
  "deposit",
  "deposit_payment",
  "refund",
  "correction",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

/** services: the paid services; deposit: the patient's advance */
export type OperationAccount = "services" | "deposit";

export type MethodPart = { method: PaymentMethod; amount: number };

/** A row of public.account_operations */
export type AccountOperation = {
  id: Identifier;
  organization_id?: Identifier;
  patient_id: Identifier;
  kind: OperationKind;
  account: OperationAccount;
  /** Positive; a correction is signed */
  amount: number;
  method: OperationMethod;
  parts?: MethodPart[] | null;
  /** Cash handed over by the patient (the change is given back) */
  cash_received?: number | null;
  /** The deal payment is a prepayment */
  prepayment?: boolean;
  occurred_at: string;
  /** The cashier */
  sales_id?: Identifier | null;
  branch_id?: Identifier | null;
  shift_id?: Identifier | null;
  deal_id?: Identifier | null;
  plan_id?: Identifier | null;
  plan_item_ids?: Identifier[];
  visit_id?: Identifier | null;
  comment?: string | null;
  source?: "cash_desk" | "deal" | "import";
  deal_payment_id?: Identifier | null;
  created_at?: string;
  /** Generated: the effect on the deposit, the paid services, the till */
  deposit_delta?: number;
  paid_delta?: number;
  till_delta?: number;
};

/** public.account_operations_summary */
export type AccountOperationSummary = AccountOperation & {
  patient_name?: string | null;
  patient_phone?: string | null;
  cashier_name?: string | null;
  deal_name?: string | null;
  plan_name?: string | null;
  branch_name?: string | null;
};

/** public.patient_accounts: «Счёт» of a patient */
export type PatientAccount = {
  id: Identifier;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  phones?: string[] | null;
  sales_id?: Identifier | null;
  deposit: number;
  paid: number;
  /** Services done: done plan items, completed priced visits */
  charged: number;
  debt: number;
  advance: number;
  balance: number;
  last_payment_at?: string | null;
  operations_count: number;
  last_visit_at?: string | null;
  last_deal_id?: Identifier | null;
};

/** public.cash_shifts: «смена кассира» */
export type CashShift = {
  id: Identifier;
  sales_id: Identifier;
  branch_id?: Identifier | null;
  opened_at: string;
  opening_cash: number;
  closed_at?: string | null;
  closed_by?: Identifier | null;
  expected_cash?: number | null;
  counted_cash?: number | null;
  discrepancy?: number | null;
  note?: string | null;
};

/** public.treatment_plan_payments */
export type TreatmentPlanPayment = {
  id: Identifier;
  deal_id: Identifier;
  patient_id: Identifier;
  status: string;
  is_main: boolean;
  total_amount: number;
  done_amount: number;
  paid_amount: number;
  due_amount: number;
  debt_amount: number;
};

/** A line of public.report_cash_methods */
export type CashMethodRow = {
  method: PaymentMethod;
  income: number;
  refunds: number;
  net: number;
  operations: number;
};

/** The result of public.close_cash_shift */
export type ShiftClosing = {
  shift_id: Identifier;
  expected_cash: number;
  counted_cash: number;
  discrepancy: number;
};
