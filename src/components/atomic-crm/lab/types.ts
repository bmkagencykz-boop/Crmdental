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
  /** ISO weekdays the lab works (1 = Monday), stage 43 */
  work_weekdays?: number[];
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
  /** Standard terms (stage 43): working days from sending to the fitting */
  fitting_days?: number | null;
  /** ... and to the ready work */
  ready_days?: number | null;
  /** Warranty of a delivered work, months (0: none) */
  warranty_months?: number;
};

/** A lab's own terms of a work type (stage 43) */
export type LabWorkTypeTerm = {
  id: Identifier;
  lab_id: Identifier;
  work_type_id: Identifier;
  fitting_days?: number | null;
  ready_days?: number | null;
};

/** «Причина переделки» (stage 43) */
export type LabRemakeReason = {
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
  /** Stage 43: the price of one lab (null: the default of every lab) */
  lab_id?: Identifier | null;
  /** ... from this day of the order on, YYYY-MM-DD */
  effective_from?: string;
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
  /** Stage 43: the first ready day (the lab bills it), kept by a remake */
  first_ready_at?: string | null;
  /** The first delivery: the start of the warranty */
  first_delivered_at?: string | null;
  /** The visit of the fitting in the schedule */
  fitting_visit_id?: Identifier | null;
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
  // Stage 43
  fitting_visit_at?: string | null;
  warranty_months?: number;
  /** YYYY-MM-DD: first delivery + the longest warranty of the works */
  warranty_until?: string | null;
  last_remake_reason?: string | null;
  last_remake_fault?: LabFault | null;
  last_remake_warranty?: boolean | null;
  /** The paid remakes (null: prices hidden) */
  remakes_cost?: number | null;
  /** Cost with the paid remakes minus the allocated payments */
  due_amount?: number | null;
};

export const LAB_FAULTS = ["lab", "clinic", "patient"] as const;
export type LabFault = (typeof LAB_FAULTS)[number];

/** public.lab_order_remakes: a remake of an order (stage 43) */
export type LabOrderRemake = {
  id: Identifier;
  order_id: Identifier;
  reason_id?: Identifier | null;
  reason?: string | null;
  fault?: LabFault | null;
  is_warranty: boolean;
  /** The lab charges it (the lines' cost again) */
  is_paid: boolean;
  comment?: string | null;
  from_status?: LabStatus | null;
  /** YYYY-MM-DD */
  occurred_on: string;
  /** The remade work came back (the day a paid remake is billed) */
  ready_at?: string | null;
  created_by?: Identifier | null;
  created_at?: string;
};

export type LabOrderEventKind =
  | "created"
  | "status"
  | "remake"
  | "fitting_visit"
  | "invite";

/** public.lab_order_events: the history of an order (stage 43) */
export type LabOrderEvent = {
  id: Identifier;
  order_id: Identifier;
  kind: LabOrderEventKind;
  from_status?: LabStatus | null;
  to_status?: LabStatus | null;
  note?: string | null;
  sales_id?: Identifier | null;
  created_at: string;
};

/** public.lab_payment_allocations: a payment allocated to an order */
export type LabPaymentAllocation = {
  id: Identifier;
  payment_id: Identifier;
  order_id: Identifier;
  amount: number;
  created_at?: string;
};

/** public.lab_order_balances: cost, allocated payments and due per order */
export type LabOrderBalance = {
  id: Identifier;
  number: number;
  lab_id?: Identifier | null;
  patient_id: Identifier;
  status: LabStatus;
  billed_on?: string | null;
  patient_name?: string | null;
  cost: number;
  allocated: number;
  due: number;
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
  /** YYYY-MM-01 of billed_on */
  month?: string | null;
  /** Stage 43: a work line, or a paid remake (id = −remake id) */
  kind?: "work" | "remake";
  remake_id?: Identifier | null;
  /** The day the lab bills it: first ready (work), back ready (remake) */
  billed_on?: string | null;
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

/** A row of public.report_lab_quality (a lab, a technician, a doctor) */
export type LabQualityRow = {
  id: Identifier | null;
  name: string | null;
  orders: number;
  remade_orders: number;
  /** % of the orders of the period remade, null without orders */
  remake_rate: number | null;
  ready: number;
  ready_with_due: number;
  on_time: number;
  on_time_pct: number | null;
  /** Sent → first ready, days */
  avg_lead_days: number | null;
  remakes: number;
  lab_fault: number;
  clinic_fault: number;
  patient_fault: number;
  warranty: number;
  reasons: Array<{ reason: string | null; count: number }>;
  overdue_now: number;
  cost: number;
};

/** public.report_lab_quality */
export type LabQualityReport = {
  labs: LabQualityRow[];
  technicians: LabQualityRow[];
  doctors: LabQualityRow[];
  reasons: Array<{ reason: string | null; count: number }>;
  totals: LabQualityRow;
};

export type LabReconciliationLine = {
  day: string;
  kind: "work" | "remake" | "payment";
  order_id?: Identifier | null;
  number?: number | null;
  remake_id?: Identifier | null;
  patient_name?: string | null;
  works?: string | null;
  payment_id?: Identifier | null;
  method?: string | null;
  comment?: string | null;
  month?: string | null;
  /** «№3, №5»: the orders the payment was allocated to */
  orders?: string | null;
  debit: number;
  credit: number;
};

/** public.report_lab_reconciliation: «Акт сверки» */
export type LabReconciliation = {
  lab_id: Identifier;
  lab_name: string;
  period_from: string;
  period_to: string;
  opening: number;
  charged: number;
  paid: number;
  closing: number;
  lines: LabReconciliationLine[];
};
