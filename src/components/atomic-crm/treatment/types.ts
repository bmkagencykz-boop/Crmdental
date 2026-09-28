import type { Identifier } from "ra-core";

/** Treatment plans with an estimate (stage 29, 29_treatment_plans.sql) */
export const PLAN_STATUSES = [
  "draft",
  "presented",
  "agreed",
  "in_progress",
  "completed",
  "declined",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Statuses of an agreed plan: it can be the main plan of the deal */
export const AGREED_STATUSES: PlanStatus[] = [
  "agreed",
  "in_progress",
  "completed",
];

export type TreatmentPlan = {
  id: Identifier;
  organization_id?: Identifier;
  deal_id: Identifier;
  patient_id: Identifier;
  name: string;
  status: PlanStatus;
  /** The agreed plan of the deal: its total is the deal's plan amount */
  is_main: boolean;
  discount_percent: number;
  discount_amount: number;
  note?: string | null;
  doctor_id?: Identifier | null;
  created_by?: Identifier | null;
  agreed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type TreatmentPlanItem = {
  id: Identifier;
  organization_id?: Identifier;
  plan_id: Identifier;
  /** «Этап 1, 2…» */
  stage_no: number;
  service_id?: Identifier | null;
  name: string;
  /** Tooth number(s), free text: «36», «11-13» */
  tooth?: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  done: boolean;
  done_at?: string | null;
  position: number;
  /** Computed by the database (lineTotal) */
  line_total?: number;
  created_at?: string;
};

/** public.treatment_plans_summary */
export type TreatmentPlanSummary = TreatmentPlan & {
  items_count: number;
  done_count: number;
  gross_amount: number;
  subtotal_amount: number;
  done_amount: number;
  total_amount: number;
  discount_total: number;
  deal_name?: string | null;
  deal_paid_amount?: number;
};

/** A row of the report «Согласованные планы по позициям» */
export type PlanServiceRow = {
  service_id: Identifier | null;
  name: string;
  quantity: number;
  amount: number;
  plans: number;
};
