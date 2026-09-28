import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  type Identifier,
} from "ra-core";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import { useCurrentSale } from "../quick-replies/useQuickReplies";
import { canExceedLimits } from "./planMath";
import type {
  PlanDictionaryItem,
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentPlanSummary,
  TreatmentStage,
  TreatmentStageTemplate,
} from "./types";

const everything = { page: 1, perPage: 500 };

/** Plans with their totals (public.treatment_plans_summary) */
export const usePlans = (filter: {
  deal_id?: Identifier;
  patient_id?: Identifier;
}) =>
  useGetList<TreatmentPlanSummary>(
    "treatment_plans_summary",
    {
      filter,
      sort: { field: "created_at", order: "ASC" },
      pagination: everything,
    },
    { enabled: filter.deal_id != null || filter.patient_id != null },
  );

/** One plan with its totals, by its id (the plan page) */
export const usePlan = (planId: Identifier | undefined) => {
  const { data, ...rest } = useGetList<TreatmentPlanSummary>(
    "treatment_plans_summary",
    {
      filter: { id: planId },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: planId != null },
  );
  return { ...rest, data: data?.[0] };
};

export const usePlanItems = (planId: Identifier | undefined) =>
  useGetList<TreatmentPlanItem>(
    "treatment_plan_items",
    {
      filter: { plan_id: planId },
      sort: { field: "position", order: "ASC" },
      pagination: everything,
    },
    { enabled: planId != null },
  );

/** The stages of a plan, in order (stage 34) */
export const usePlanStages = (planId: Identifier | undefined) =>
  useGetList<TreatmentStage>(
    "treatment_stages",
    {
      filter: { plan_id: planId },
      sort: { field: "position", order: "ASC" },
      pagination: everything,
    },
    { enabled: planId != null },
  );

/** «Сохранить как шаблон этапа» → «Добавить этап из шаблона» */
export const useStageTemplates = (enabled = true) =>
  useGetList<TreatmentStageTemplate>(
    "treatment_stage_templates",
    {
      sort: { field: "name", order: "ASC" },
      pagination: everything,
    },
    { enabled },
  );

const dictionaryOptions = { staleTime: 5 * 60 * 1000 };
const byPosition = { field: "position", order: "ASC" as const };
/** «Тип плана»: a clinic dictionary */
export const usePlanTypes = () =>
  useGetList<PlanDictionaryItem>(
    "treatment_plan_types",
    { sort: byPosition, pagination: everything },
    dictionaryOptions,
  );
/** «Направление» of a stage: a clinic dictionary */
export const useDirections = () =>
  useGetList<PlanDictionaryItem>(
    "treatment_directions",
    { sort: byPosition, pagination: everything },
    dictionaryOptions,
  );

/** Everything a change of a plan can touch: totals, deal amount, stage, feed */
const REFRESHED = [
  "treatment_plans_summary",
  "treatment_plans",
  "treatment_plan_items",
  "treatment_stages",
  "treatment_plan_stages",
  "treatment_stage_templates",
  "deals",
  "deal_events",
  "stage_trigger_runs",
  "audit_log",
];

export const useRefreshPlans = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      REFRESHED.map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
};

/**
 * Writes of plans and items through the data provider: the database (or
 * the demo) keeps the totals, the deal amount and the stage. Errors (the
 * discount limit, the price list) are shown as they come.
 */
export const usePlanMutations = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const refresh = useRefreshPlans();
  const onError = (error: Error) =>
    notify(error?.message || "treatment.notify.error", { type: "error" });

  const createPlan = useMutation({
    mutationFn: async (data: Partial<TreatmentPlan>) =>
      (await dataProvider.create<TreatmentPlan>("treatment_plans", { data }))
        .data,
    onSuccess: () => refresh(),
    onError,
  });
  const updatePlan = useMutation({
    mutationFn: async ({
      plan,
      data,
    }: {
      plan: TreatmentPlan;
      data: Partial<TreatmentPlan>;
    }) =>
      (
        await dataProvider.update<TreatmentPlan>("treatment_plans", {
          id: plan.id,
          data,
          previousData: plan,
        })
      ).data,
    onSettled: () => refresh(),
    onError,
  });
  const deletePlan = useMutation({
    mutationFn: (plan: TreatmentPlan) =>
      dataProvider.delete("treatment_plans", {
        id: plan.id,
        previousData: plan,
      }),
    onSuccess: () => {
      notify("treatment.notify.deleted", { type: "info" });
      return refresh();
    },
    onError,
  });
  const duplicatePlan = useMutation({
    mutationFn: (plan: TreatmentPlan) =>
      dataProvider.duplicateTreatmentPlan(plan.id),
    onSuccess: () => {
      notify("treatment.notify.duplicated", { type: "info" });
      return refresh();
    },
    onError,
  });
  const createItem = useMutation({
    mutationFn: (data: Partial<TreatmentPlanItem>) =>
      dataProvider.create("treatment_plan_items", { data }),
    onSettled: () => refresh(),
    onError,
  });
  const updateItem = useMutation({
    mutationFn: ({
      item,
      data,
    }: {
      item: TreatmentPlanItem;
      data: Partial<TreatmentPlanItem>;
    }) =>
      dataProvider.update("treatment_plan_items", {
        id: item.id,
        data,
        previousData: item,
      }),
    onSettled: () => refresh(),
    onError,
  });
  const deleteItem = useMutation({
    mutationFn: (item: TreatmentPlanItem) =>
      dataProvider.delete("treatment_plan_items", {
        id: item.id,
        previousData: item,
      }),
    onSettled: () => refresh(),
    onError,
  });
  const createStage = useMutation({
    mutationFn: async (data: Partial<TreatmentStage>) =>
      (await dataProvider.create<TreatmentStage>("treatment_stages", { data }))
        .data,
    onSettled: () => refresh(),
    onError,
  });
  const updateStage = useMutation({
    mutationFn: async ({
      stage,
      data,
    }: {
      stage: TreatmentStage;
      data: Partial<TreatmentStage>;
    }) =>
      (
        await dataProvider.update<TreatmentStage>("treatment_stages", {
          id: stage.id,
          data,
          previousData: stage,
        })
      ).data,
    onSettled: () => refresh(),
    onError,
  });
  const deleteStage = useMutation({
    mutationFn: (stage: TreatmentStage) =>
      dataProvider.delete("treatment_stages", {
        id: stage.id,
        previousData: stage,
      }),
    onSuccess: () => {
      notify("plan_editor.notify.stage_deleted", { type: "info" });
    },
    onSettled: () => refresh(),
    onError,
  });
  const saveTemplate = useMutation({
    mutationFn: ({ stage, name }: { stage: TreatmentStage; name?: string }) =>
      dataProvider.saveStageTemplate(stage.id, name ?? null),
    onSuccess: () => {
      notify("plan_editor.notify.template_saved", { type: "info" });
    },
    onSettled: () => refresh(),
    onError,
  });
  const addFromTemplate = useMutation({
    mutationFn: ({
      plan,
      template,
    }: {
      plan: TreatmentPlan;
      template: TreatmentStageTemplate;
    }) => dataProvider.addStageFromTemplate(plan.id, template.id),
    onSettled: () => refresh(),
    onError,
  });
  return {
    createPlan,
    updatePlan,
    deletePlan,
    duplicatePlan,
    createItem,
    updateItem,
    deleteItem,
    createStage,
    updateStage,
    deleteStage,
    saveTemplate,
    addFromTemplate,
  };
};

/**
 * May the employee edit plans, and go beyond the discount limit and below
 * the price list? (The database checks the same.)
 */
export const usePlanRights = () => {
  const { canAccess: canEdit = false } = useCanAccess({
    resource: "treatment_plans",
    action: "edit",
  });
  const sale = useCurrentSale();
  const { data: settings } = useOrganizationSettings();
  return {
    canEdit,
    unlimited: canExceedLimits(sale?.role),
    maxDiscount: Number(settings?.max_discount_percent ?? 10),
  };
};
