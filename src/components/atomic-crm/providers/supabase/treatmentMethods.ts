import type { Identifier } from "ra-core";

import type { ReportFilters } from "../../reports/reportMath";
import type { PlanServiceRow } from "../../treatment/types";
import { getSupabaseClient } from "./supabase";

/**
 * Treatment plans (stage 29): the plans and items are plain resources
 * (treatment_plans, treatment_plan_items, treatment_plans_summary); the
 * database keeps the totals, the plan amount of the deal and the stage.
 */
export const getTreatmentMethods = () => ({
  /** «Дублировать план»: a draft copy (public.duplicate_treatment_plan) */
  async duplicateTreatmentPlan(planId: Identifier): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc(
      "duplicate_treatment_plan",
      { source_plan_id: planId },
    );
    if (error) throw error;
    return data as Identifier;
  },
  /** «Сохранить как шаблон этапа» (public.save_stage_template, stage 34) */
  async saveStageTemplate(
    stageId: Identifier,
    name?: string | null,
  ): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc(
      "save_stage_template",
      { source_stage_id: stageId, template_name: name ?? null },
    );
    if (error) throw error;
    return data as Identifier;
  },
  /** «Добавить этап из шаблона»: the new stage (public.add_stage_from_template) */
  async addStageFromTemplate(
    planId: Identifier,
    templateId: Identifier,
  ): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc(
      "add_stage_from_template",
      { target_plan_id: planId, source_template_id: templateId },
    );
    if (error) throw error;
    return data as Identifier;
  },
  /** Reports «Деньги» → «Согласованные планы по позициям» */
  async getPlanServicesReport(
    filters: ReportFilters,
  ): Promise<PlanServiceRow[]> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_plan_services",
      {
        period_from: filters.from ?? null,
        period_to: filters.to ?? null,
        filter_pipeline_id: filters.pipeline_id ?? null,
        filter_sales_id: filters.sales_id ?? null,
        filter_source_id: filters.source_id ?? null,
        filter_doctor_id: filters.doctor_id ?? null,
        filter_branch_id: filters.branch_id ?? null,
      },
    );
    if (error) throw error;
    return (data as PlanServiceRow[]) ?? [];
  },
});
