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
  /** «Тип плана» (stage 34): a clinic dictionary */
  plan_type_id?: Identifier | null;
  /** «Основные жалобы» */
  complaints?: string | null;
  /** «Страховой полис», free text */
  insurance_policy?: string | null;
};

/** Stage statuses (stage 34): shown on the tab of the stage */
export const STAGE_STATUSES = [
  "new",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** A stage of a plan (stage 34, public.treatment_stages): a tab «Этап N» */
export type TreatmentStage = {
  id: Identifier;
  organization_id?: Identifier;
  plan_id: Identifier;
  /** The stage number, 1..20 */
  position: number;
  name: string;
  doctor_id?: Identifier | null;
  /** «Направление»: public.treatment_directions */
  direction_id?: Identifier | null;
  /** «Крайний срок», YYYY-MM-DD */
  deadline?: string | null;
  description?: string | null;
  status: StageStatus;
  /** The discount of the stage, % */
  discount_percent: number;
  created_at?: string;
  updated_at?: string;
};

/** A line of a stage template: no tooth */
export type StageTemplateItem = {
  service_id: Identifier | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
};

/** «Сохранить как шаблон этапа» (public.treatment_stage_templates) */
export type TreatmentStageTemplate = {
  id: Identifier;
  organization_id?: Identifier;
  name: string;
  direction_id?: Identifier | null;
  description?: string | null;
  items: StageTemplateItem[];
  created_by?: Identifier | null;
  created_at?: string;
  updated_at?: string;
};

/** «Тип плана» and «Направление»: clinic dictionaries */
export type PlanDictionaryItem = {
  id: Identifier;
  organization_id?: Identifier;
  name: string;
  position: number;
  is_archived: boolean;
  created_at?: string;
};

export type TreatmentPlanItem = {
  id: Identifier;
  organization_id?: Identifier;
  plan_id: Identifier;
  /** The stage of the item (stage 34) */
  stage_id?: Identifier | null;
  /** «Этап 1, 2…»: follows the number of the stage */
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
  /** Stage 34 */
  stages_count?: number;
  /** «Скидка в этапах»: gross − subtotal (items and stage discounts) */
  stages_discount_amount?: number;
  /** «Дополнительная скидка»: subtotal − total */
  extra_discount_amount?: number;
  /** «Оплачено» (private.treatment_plan_paid) */
  paid_amount?: number;
};

/** A row of the report «Согласованные планы по позициям» */
export type PlanServiceRow = {
  service_id: Identifier | null;
  name: string;
  quantity: number;
  amount: number;
  plans: number;
};
