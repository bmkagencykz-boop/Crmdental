import type { Identifier } from "ra-core";

/**
 * Dental lab work orders (stage 40): the rows of
 * supabase/schemas/40_lab_orders.sql.
 */

export const LAB_STATUSES = [
  "clinic",
  "lab",
  "courier",
  "fitting",
  "ready",
  "delivered",
  "remake",
] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];

export type Lab = {
  id: Identifier;
  name: string;
  /** The clinic's own lab (no courier) */
  is_own: boolean;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  note?: string | null;
  is_active: boolean;
  position: number;
  created_at?: string;
};

export type LabTechnician = {
  id: Identifier;
  lab_id: Identifier;
  name: string;
  phone?: string | null;
  is_active: boolean;
  position: number;
};

export type LabWorkType = {
  id: Identifier;
  name: string;
  is_active: boolean;
  position: number;
};

/** The lab price of a work type: the owner and the head only */
export type LabWorkTypePrice = {
  id: Identifier;
  work_type_id: Identifier;
  price: number;
  updated_at?: string;
};

export type LabOrder = {
  id: Identifier;
  /** «Наряд №…», per clinic */
  number: number;
  patient_id: Identifier;
  deal_id?: Identifier | null;
  plan_id?: Identifier | null;
  stage_id?: Identifier | null;
  doctor_id?: Identifier | null;
  lab_id?: Identifier | null;
  technician_id?: Identifier | null;
  responsible_id?: Identifier | null;
  branch_id?: Identifier | null;
  /** FDI numbers */
  teeth: number[];
  /** VITA shade: A1…D4 */
  shade?: string | null;
  material?: string | null;
  comment?: string | null;
  status: LabStatus;
  /** YYYY-MM-DD */
  sent_at?: string | null;
  fitting1_at?: string | null;
  fitting2_at?: string | null;
  due_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  remake_count: number;
  created_by?: Identifier | null;
  created_at: string;
  updated_at?: string;
};

/** public.lab_orders_summary */
export type LabOrderSummary = LabOrder & {
  patient_name: string | null;
  patient_phone?: string | null;
  doctor_name: string | null;
  lab_name: string | null;
  technician_name: string | null;
  responsible_name: string | null;
  items_count: number;
  units: number;
  works: string | null;
  overdue_days: number;
  /** null: the prices are hidden (not the owner or the head) */
  lab_cost: number | null;
};

export type LabOrderItem = {
  id: Identifier;
  order_id: Identifier;
  work_type_id?: Identifier | null;
  name: string;
  qty: number;
  plan_item_id?: Identifier | null;
  position: number;
  created_at?: string;
};

/** The lab price of a line (owner and head) */
export type LabOrderItemPrice = {
  id: Identifier;
  item_id: Identifier;
  price: number;
  updated_at?: string;
};

/** public.lab_order_costs: one row per line with its price */
export type LabOrderCost = {
  id: Identifier;
  order_id: Identifier;
  order_number: number;
  patient_id: Identifier;
  doctor_id?: Identifier | null;
  lab_id?: Identifier | null;
  technician_id?: Identifier | null;
  branch_id?: Identifier | null;
  plan_id?: Identifier | null;
  plan_item_id?: Identifier | null;
  work_type_id?: Identifier | null;
  name: string;
  qty: number;
  price: number;
  amount: number;
  status: LabStatus;
  ready_at?: string | null;
  /** YYYY-MM-01 of ready_at */
  month?: string | null;
};

/** public.report_lab_settlement */
export type LabSettlementRow = {
  lab_id: Identifier;
  lab_name: string;
  is_own: boolean;
  orders_count: number;
  items_count: number;
  amount: number;
  /** Paid for the month (lab payments, stage 42) */
  paid: number;
  /** amount − paid */
  balance: number;
  /** Owed minus paid over every month up to this one */
  total_balance: number;
};

/** public.lab_payments: «Оплата лаборатории» (stage 42) */
export type LabPayment = {
  id: Identifier;
  organization_id?: Identifier;
  lab_id: Identifier;
  /** The month of the settlement it pays, YYYY-MM-01 */
  month: string;
  amount: number;
  method: LabPaymentMethod;
  paid_at: string;
  comment?: string | null;
  /** The expense of the cash desk («из кассы») */
  account_operation_id?: Identifier | null;
  created_by?: Identifier | null;
  created_at?: string;
};

export const LAB_PAYMENT_METHODS = [
  "bank_transfer",
  "kaspi_transfer",
  "cash",
  "card",
  "kaspi_qr",
  "other",
] as const;
export type LabPaymentMethod = (typeof LAB_PAYMENT_METHODS)[number];

/** public.lab_payments_summary */
export type LabPaymentSummary = LabPayment & {
  lab_name?: string | null;
  created_by_name?: string | null;
};
