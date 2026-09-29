import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import type { StageTriggerRun } from "../../pipeline-automation/types";
import type { ReportFilters } from "../../reports/reportMath";
import {
  canExceedLimits,
  discountExceeds,
  lineTotal,
  planTotals,
  stageStatusAfterProgress,
  statusAfterProgress,
} from "../../treatment/planMath";
import {
  itemsFromTemplate,
  MAX_STAGES,
  nextStagePosition,
  templateLines,
} from "../../treatment/planStages";
import type {
  PlanServiceRow,
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentPlanSummary,
  TreatmentStage,
  TreatmentStageTemplate,
} from "../../treatment/types";
import type {
  AuditLogEntry,
  Deal,
  Doctor,
  OrganizationSettings,
  Sale,
  Service,
  Stage,
} from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);
const nowIso = () => new Date().toISOString();
const OPEN_STATUSES = ["draft", "presented", "declined"];
const AUDITED = [
  "name",
  "status",
  "is_main",
  "discount_percent",
  "discount_amount",
  "doctor_id",
  "note",
  "plan_type_id",
  "complaints",
  "insurance_policy",
] as const;
const STAGE_AUDITED = [
  "name",
  "position",
  "status",
  "doctor_id",
  "direction_id",
  "deadline",
  "discount_percent",
  "description",
] as const;
/** Columns of treatment_plans_summary, never written to a plan */
const SUMMARY_KEYS = [
  "items_count",
  "done_count",
  "gross_amount",
  "subtotal_amount",
  "done_amount",
  "total_amount",
  "discount_total",
  "deal_name",
  "deal_paid_amount",
  "stages_count",
  "stages_discount_amount",
  "extra_discount_amount",
  "paid_amount",
] as const;

const forbidden = (message: string) =>
  Object.assign(new Error(message), { code: "42501" });

/**
 * Treatment plans of the demo (stage 29): the same rules as
 * supabase/schemas/29_treatment_plans.sql — totals (planMath.ts), the main
 * agreed plan of the deal and its plan amount, the move to «План
 * согласован» (the stage checklist may refuse it: skipped, in the feed),
 * progress, the discount limit and the price list per role. The stages of
 * a plan and the stage templates of stage 34 (34_plan_editor.sql): numbers,
 * status after the items, discounts, cancelled stages aside, templates.
 */
export const createTreatmentDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
  logAudit,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getDataProvider: () => DataProvider;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
}) => {
  // «Дублировать план» copies the discounts as they are
  let copying = false;
  const previousPlans = new Map<string, TreatmentPlan>();
  const previousStages = new Map<string, TreatmentStage>();
  const previousItems = new Map<string, TreatmentPlanItem>();

  const myRole = async () => {
    const salesId = await currentSalesId();
    // The demo user is the owner of the clinic
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, salesId))?.role ??
      "owner"
    );
  };
  const checkRights = async () => {
    if (!["owner", "head", "manager"].includes(await myRole())) {
      throw forbidden(
        "Планы лечения меняют администраторы, руководитель и владелец",
      );
    }
  };
  const maxDiscount = async () =>
    Number(
      (await all<OrganizationSettings>("organization_settings"))[0]
        ?.max_discount_percent ?? 10,
    );
  /** Same as private.check_treatment_discount */
  const checkDiscount = async (percent: number, subtotal = 0, amount = 0) => {
    if (copying || canExceedLimits(await myRole())) return;
    const max = await maxDiscount();
    if (discountExceeds({ percent, amount, subtotal, max })) {
      throw Object.assign(
        new Error(`Скидка больше ${max} % — только владелец или руководитель`),
        { code: "42501" },
      );
    }
  };

  const getDeal = async (id: Identifier) =>
    (await baseDataProvider.getOne<Deal>("deals", { id })).data;
  const getPlan = async (id: Identifier) =>
    (await all<TreatmentPlan>("treatment_plans")).find((plan) =>
      same(plan.id, id),
    );
  const itemsOf = async (planId: Identifier) =>
    (await all<TreatmentPlanItem>("treatment_plan_items")).filter((item) =>
      same(item.plan_id, planId),
    );
  const stagesOf = async (planId: Identifier) =>
    (await all<TreatmentStage>("treatment_stages"))
      .filter((stage) => same(stage.plan_id, planId))
      .sort((a, b) => a.position - b.position);
  const getStage = async (id: Identifier) =>
    (await all<TreatmentStage>("treatment_stages")).find((stage) =>
      same(stage.id, id),
    );
  /** The totals of a plan with its stages (treatment_plans_summary) */
  const totalsOf = async (plan: TreatmentPlan) =>
    planTotals(plan, await itemsOf(plan.id), await stagesOf(plan.id));
  const auditStage = async (
    action: "create" | "update" | "delete",
    stage: TreatmentStage,
    previous?: TreatmentStage,
  ) => {
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of STAGE_AUDITED) {
      const before = action === "create" ? null : (previous ?? stage)[field];
      const after = action === "delete" ? null : stage[field];
      if (
        (action !== "update" ||
          JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) &&
        (before != null || after != null)
      ) {
        changes[field] = [before, after];
      }
    }
    if (!Object.keys(changes).length) return;
    await logAudit({
      entity: "treatment_stage" as AuditLogEntry["entity"],
      entity_id: stage.id,
      action,
      changes: changes as AuditLogEntry["changes"],
    });
  };
  /** The stage of a plan with this number, created («Этап N») when missing */
  const stageAt = async (plan: TreatmentPlan, position: number) => {
    const found = (await stagesOf(plan.id)).find(
      (stage) => stage.position === position,
    );
    if (found) return found;
    const { data } = await baseDataProvider.create<TreatmentStage>(
      "treatment_stages",
      {
        data: {
          plan_id: plan.id,
          position,
          name: `Этап ${position}`,
          doctor_id: plan.doctor_id ?? null,
          direction_id: null,
          deadline: null,
          description: null,
          status: "new",
          discount_percent: 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      },
    );
    return data;
  };
  /** Same as private.treatment_stage_progress */
  const stageProgress = async (stageId: Identifier | null | undefined) => {
    if (stageId == null) return;
    const stage = await getStage(stageId);
    if (!stage) return;
    const items = (await all<TreatmentPlanItem>("treatment_plan_items")).filter(
      (item) => same(item.stage_id, stage.id),
    );
    const next = stageStatusAfterProgress(stage.status, items);
    if (next !== stage.status) {
      await baseDataProvider.update("treatment_stages", {
        id: stage.id,
        data: { status: next, updated_at: nowIso() },
        previousData: stage,
      });
    }
  };

  /** Same as private.sync_treatment_plan_amount */
  const syncAmount = async (planId: Identifier) => {
    const plan = await getPlan(planId);
    if (!plan?.is_main) return;
    const { total } = await totalsOf(plan);
    const deal = await getDeal(plan.deal_id);
    if (!deal || deal.plan_amount === total) return;
    await getDataProvider().update("deals", {
      id: deal.id,
      data: { plan_amount: total },
      previousData: deal,
    });
  };

  /** Same as private.treatment_plan_move_stage */
  const moveStage = async (plan: TreatmentPlan) => {
    const deal = await getDeal(plan.deal_id);
    if (!deal || deal.archived_at || deal.unsorted_at) return null;
    const stages = await all<Stage>("stages");
    const current = stages.find((stage) => same(stage.id, deal.stage_id));
    const target = stages
      .filter(
        (stage) =>
          same(stage.pipeline_id, deal.pipeline_id) &&
          stage.kind === "open" &&
          stage.name === "План согласован",
      )
      .sort((a, b) => a.position - b.position)[0];
    if (
      !target ||
      !current ||
      current.kind !== "open" ||
      target.position <= current.position
    ) {
      return null;
    }
    let error: string | null = null;
    try {
      await getDataProvider().update("deals", {
        id: deal.id,
        data: { stage_id: target.id },
        previousData: deal,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await baseDataProvider.create<StageTriggerRun>("stage_trigger_runs", {
      data: {
        deal_id: deal.id,
        trigger_id: null,
        trigger_name: `План лечения «${plan.name}»`,
        event: "treatment_plan" as StageTriggerRun["event"],
        event_key: `treatment_plan:${plan.id}:${Date.now()}`,
        action: "move_stage",
        status: error ? "skipped" : "done",
        details: { from_stage_id: deal.stage_id, to_stage_id: target.id },
        error,
        created_at: nowIso(),
      },
    });
    return error ? "skipped" : "done";
  };

  /** The status rules of handle_treatment_plan_before_write */
  const applyStatusRules = async (
    next: TreatmentPlan,
    previous: TreatmentPlan | undefined,
  ) => {
    if (OPEN_STATUSES.includes(next.status)) {
      next.is_main = false;
      if (next.status !== "declined") next.agreed_at = null;
    } else if (!previous) {
      next.agreed_at = next.agreed_at ?? nowIso();
      next.is_main = true;
    } else if (OPEN_STATUSES.includes(previous.status)) {
      next.agreed_at = nowIso();
      next.is_main = true;
    }
    if (next.is_main && !previous?.is_main) {
      const others = (await all<TreatmentPlan>("treatment_plans")).filter(
        (plan) =>
          same(plan.deal_id, next.deal_id) &&
          plan.is_main &&
          !same(plan.id, next.id),
      );
      for (const other of others) {
        await baseDataProvider.update("treatment_plans", {
          id: other.id,
          data: { is_main: false },
          previousData: other,
        });
      }
    }
  };

  const auditPlan = async (
    action: "create" | "update" | "delete",
    plan: TreatmentPlan,
    previous?: TreatmentPlan,
  ) => {
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of AUDITED) {
      const before = action === "create" ? null : (previous ?? plan)[field];
      const after = action === "delete" ? null : plan[field];
      if (
        action !== "update" ||
        JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)
      ) {
        if (before != null || after != null) changes[field] = [before, after];
      }
    }
    if (!Object.keys(changes).length) return;
    await logAudit({
      entity: "treatment_plan" as AuditLogEntry["entity"],
      entity_id: plan.id,
      action,
      changes: changes as AuditLogEntry["changes"],
      deal_id: plan.deal_id,
      patient_id: plan.patient_id,
    });
  };

  /** Same as private.refresh_treatment_plan: cancelled stages aside */
  const afterItemsChanged = async (planId: Identifier) => {
    const plan = await getPlan(planId);
    if (!plan) return;
    const cancelled = new Set(
      (await stagesOf(plan.id))
        .filter((stage) => stage.status === "cancelled")
        .map((stage) => String(stage.id)),
    );
    const next = statusAfterProgress(
      plan.status,
      (await itemsOf(plan.id)).filter(
        (item) => !cancelled.has(String(item.stage_id)),
      ),
    );
    if (next !== plan.status) {
      await getDataProvider().update("treatment_plans", {
        id: plan.id,
        data: { status: next },
        previousData: plan,
      });
    }
    await syncAmount(plan.id);
  };

  /** Name, tooth, done time, limits and line total of an item */
  const prepareItem = async (
    data: Partial<TreatmentPlanItem>,
    previous?: TreatmentPlanItem,
  ): Promise<Partial<TreatmentPlanItem>> => {
    const next = { ...previous, ...data } as TreatmentPlanItem;
    const service = next.service_id
      ? (await all<Service>("services")).find((s) =>
          same(s.id, next.service_id),
        )
      : undefined;
    const name = next.name?.trim() || service?.name;
    if (!name) throw new Error("Укажите название позиции");
    // The doctor of the item (else the stage's, the plan's): of the clinic
    if (
      next.doctor_id != null &&
      !(await all<Doctor>("doctors")).some((d) => same(d.id, next.doctor_id))
    ) {
      throw new Error("Врач не найден");
    }
    const role = await myRole();
    if (!copying && !canExceedLimits(role)) {
      if (
        Number(next.discount_percent) > 0 &&
        (!previous ||
          Number(next.discount_percent) !== Number(previous.discount_percent))
      ) {
        await checkDiscount(Number(next.discount_percent));
      }
      if (
        service?.price != null &&
        next.unit_price < Math.round(service.price) &&
        (!previous ||
          next.unit_price !== previous.unit_price ||
          !same(next.service_id, previous.service_id))
      ) {
        throw forbidden("Цена ниже прайса — только владелец или руководитель");
      }
    }
    const done = !!next.done;
    return {
      ...data,
      name,
      tooth: next.tooth?.trim() || null,
      done,
      done_at: done ? (previous?.done ? previous.done_at : nowIso()) : null,
      line_total: lineTotal(
        next.quantity,
        next.unit_price,
        next.discount_percent,
      ),
    };
  };

  const summaries = async (): Promise<TreatmentPlanSummary[]> => {
    const [plans, items, deals, stages] = await Promise.all([
      all<TreatmentPlan>("treatment_plans"),
      all<TreatmentPlanItem>("treatment_plan_items"),
      all<Deal>("deals"),
      all<TreatmentStage>("treatment_stages"),
    ]);
    return plans.map((plan) => {
      const planStages = stages.filter((stage) => same(stage.plan_id, plan.id));
      const totals = planTotals(
        plan,
        items.filter((item) => same(item.plan_id, plan.id)),
        planStages,
      );
      const deal = deals.find((d) => same(d.id, plan.deal_id));
      return {
        ...plan,
        items_count: totals.itemsCount,
        done_count: totals.doneCount,
        gross_amount: totals.gross,
        subtotal_amount: totals.subtotal,
        done_amount: totals.doneAmount,
        total_amount: totals.total,
        discount_total: totals.discountTotal,
        deal_name: deal?.name ?? null,
        deal_paid_amount: deal?.paid_amount ?? 0,
        stages_count: planStages.filter((stage) => stage.status !== "cancelled")
          .length,
        stages_discount_amount: totals.stagesDiscount,
        extra_discount_amount: totals.planDiscount,
        // private.treatment_plan_paid: the payments of the deal
        paid_amount: deal?.paid_amount ?? 0,
      };
    });
  };

  const methods = {
    /** Same as public.duplicate_treatment_plan */
    duplicateTreatmentPlan: async (planId: Identifier): Promise<Identifier> => {
      const source = await getPlan(planId);
      if (!source) throw new Error("План не найден");
      copying = true;
      try {
        const { data: plan } = await getDataProvider().create<TreatmentPlan>(
          "treatment_plans",
          {
            data: {
              deal_id: source.deal_id,
              name: `${source.name.slice(0, 180)} (копия)`,
              status: "draft",
              discount_percent: source.discount_percent,
              discount_amount: source.discount_amount,
              note: source.note ?? null,
              doctor_id: source.doctor_id ?? null,
              plan_type_id: source.plan_type_id ?? null,
              complaints: source.complaints ?? null,
              insurance_policy: source.insurance_policy ?? null,
            },
          },
        );
        const items = await itemsOf(source.id);
        for (const stage of await stagesOf(source.id)) {
          const { data: copy } = await getDataProvider().create<TreatmentStage>(
            "treatment_stages",
            {
              data: {
                plan_id: plan.id,
                position: stage.position,
                name: stage.name,
                doctor_id: stage.doctor_id ?? null,
                direction_id: stage.direction_id ?? null,
                deadline: stage.deadline ?? null,
                description: stage.description ?? null,
                status: stage.status === "cancelled" ? "cancelled" : "new",
                discount_percent: stage.discount_percent,
              },
            },
          );
          for (const item of items.filter((i) => same(i.stage_id, stage.id))) {
            await getDataProvider().create("treatment_plan_items", {
              data: {
                plan_id: plan.id,
                stage_id: copy.id,
                stage_no: copy.position,
                service_id: item.service_id ?? null,
                name: item.name,
                tooth: item.tooth ?? null,
                quantity: item.quantity,
                unit_price: item.unit_price,
                discount_percent: item.discount_percent,
                position: item.position,
                // The item's own doctor (stage 39, editable since stage 42)
                doctor_id: item.doctor_id ?? null,
                done: false,
              },
            });
          }
        }
        return plan.id;
      } finally {
        copying = false;
      }
    },
    /** Same as public.save_stage_template */
    saveStageTemplate: async (
      stageId: Identifier,
      name?: string | null,
    ): Promise<Identifier> => {
      await checkRights();
      const stage = await getStage(stageId);
      if (!stage) throw new Error("Этап не найден");
      const items = (
        await all<TreatmentPlanItem>("treatment_plan_items")
      ).filter((item) => same(item.stage_id, stage.id));
      const { data } = await getDataProvider().create<TreatmentStageTemplate>(
        "treatment_stage_templates",
        {
          data: {
            name: name?.trim() || stage.name,
            direction_id: stage.direction_id ?? null,
            description: stage.description ?? null,
            items: templateLines(items),
          },
        },
      );
      return data.id;
    },
    /** Same as public.add_stage_from_template */
    addStageFromTemplate: async (
      planId: Identifier,
      templateId: Identifier,
    ): Promise<Identifier> => {
      const plan = await getPlan(planId);
      if (!plan) throw new Error("План не найден");
      const template = (
        await all<TreatmentStageTemplate>("treatment_stage_templates")
      ).find((t) => same(t.id, templateId));
      if (!template) throw new Error("Шаблон не найден");
      const { data: stage } = await getDataProvider().create<TreatmentStage>(
        "treatment_stages",
        {
          data: {
            plan_id: plan.id,
            name: template.name,
            direction_id: template.direction_id ?? null,
            description: template.description ?? null,
          },
        },
      );
      const lines = itemsFromTemplate(template, await all<Service>("services"));
      copying = true;
      try {
        for (const [position, line] of lines.entries()) {
          await getDataProvider().create("treatment_plan_items", {
            data: {
              ...line,
              plan_id: plan.id,
              stage_id: stage.id,
              stage_no: stage.position,
              tooth: null,
              done: false,
              position,
            },
          });
        }
      } finally {
        copying = false;
      }
      return stage.id;
    },
    /** Same as public.report_plan_services */
    getPlanServicesReport: async (
      filters: ReportFilters,
    ): Promise<PlanServiceRow[]> => {
      if (!canExceedLimits(await myRole())) {
        throw new Error("reports.forbidden");
      }
      const [plans, allItems, deals, services, stages] = await Promise.all([
        all<TreatmentPlan>("treatment_plans"),
        all<TreatmentPlanItem>("treatment_plan_items"),
        all<Deal>("deals"),
        all<Service>("services"),
        all<TreatmentStage>("treatment_stages"),
      ]);
      // Cancelled stages aside (stage 34)
      const cancelled = new Set(
        stages
          .filter((stage) => stage.status === "cancelled")
          .map((stage) => String(stage.id)),
      );
      const items = allItems.filter(
        (item) => !cancelled.has(String(item.stage_id)),
      );
      const rows = new Map<string, PlanServiceRow & { planIds: Set<string> }>();
      for (const plan of plans) {
        if (!plan.is_main || !plan.agreed_at) continue;
        if (filters.from && plan.agreed_at < filters.from) continue;
        if (filters.to && plan.agreed_at >= filters.to) continue;
        const deal = deals.find((d) => same(d.id, plan.deal_id));
        if (!deal) continue;
        if (
          filters.pipeline_id != null &&
          !same(deal.pipeline_id, filters.pipeline_id)
        )
          continue;
        if (filters.sales_id != null && !same(deal.sales_id, filters.sales_id))
          continue;
        if (
          filters.source_id != null &&
          !same(deal.source_id, filters.source_id)
        )
          continue;
        if (
          filters.doctor_id != null &&
          !same(plan.doctor_id ?? deal.doctor_id, filters.doctor_id)
        ) {
          continue;
        }
        if (
          filters.branch_id != null &&
          !same(deal.branch_id, filters.branch_id)
        ) {
          continue;
        }
        for (const item of items.filter((i) => same(i.plan_id, plan.id))) {
          const name =
            services.find((s) => same(s.id, item.service_id))?.name ??
            item.name;
          const key = `${item.service_id ?? ""}|${name}`;
          const row = rows.get(key) ?? {
            service_id: item.service_id ?? null,
            name,
            quantity: 0,
            amount: 0,
            plans: 0,
            planIds: new Set<string>(),
          };
          row.quantity += item.quantity;
          row.amount += lineTotal(
            item.quantity,
            item.unit_price,
            item.discount_percent,
          );
          row.planIds.add(String(plan.id));
          row.plans = row.planIds.size;
          rows.set(key, row);
        }
      }
      return [...rows.values()]
        .sort(
          (a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"),
        )
        .slice(0, 20)
        .map(({ planIds: _planIds, ...row }) => row);
    },
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "treatment_plans",
      beforeCreate: async (params) => {
        await checkRights();
        const data = params.data as Partial<TreatmentPlan>;
        const deal = await getDeal(data.deal_id!);
        if (!deal) throw new Error("Сделка не найдена");
        const plan = {
          is_main: false,
          note: null,
          agreed_at: null,
          plan_type_id: null,
          complaints: null,
          insurance_policy: null,
          ...data,
          name: data.name?.trim() || "План лечения",
          status: data.status ?? "draft",
          discount_percent: Number(data.discount_percent ?? 0),
          discount_amount: Math.round(Number(data.discount_amount ?? 0)),
          patient_id: deal.patient_id,
          doctor_id: data.doctor_id ?? deal.doctor_id ?? null,
          created_by: (await currentSalesId()) ?? null,
          created_at: nowIso(),
          updated_at: nowIso(),
        } as TreatmentPlan;
        if (plan.discount_percent > 0 || plan.discount_amount > 0) {
          await checkDiscount(plan.discount_percent, 0, plan.discount_amount);
        }
        await applyStatusRules(plan, undefined);
        return { ...params, data: plan };
      },
      afterCreate: async (result) => {
        const plan = result.data as TreatmentPlan;
        // A new plan starts with «Этап 1» (a duplicate copies its stages)
        if (!copying) await stageAt(plan, 1);
        await auditPlan("create", plan);
        if (plan.is_main) await syncAmount(plan.id);
        if (plan.status === "agreed") await moveStage(plan);
        return result;
      },
      beforeUpdate: async (params) => {
        await checkRights();
        const previous = await getPlan(params.id);
        if (!previous) throw new Error("План не найден");
        const data = { ...params.data } as Partial<TreatmentPlan> &
          Partial<TreatmentPlanSummary>;
        for (const key of SUMMARY_KEYS) {
          delete data[key];
        }
        if (data.deal_id != null && !same(data.deal_id, previous.deal_id)) {
          throw new Error("План лечения не переносится в другую сделку");
        }
        const next = { ...previous, ...data } as TreatmentPlan;
        if (
          Number(next.discount_percent) !== Number(previous.discount_percent) ||
          Number(next.discount_amount) !== Number(previous.discount_amount)
        ) {
          const { subtotal } = await totalsOf(next);
          await checkDiscount(
            Number(next.discount_percent),
            subtotal,
            Number(next.discount_amount),
          );
        }
        next.name = next.name?.trim() || "План лечения";
        await applyStatusRules(next, previous);
        previousPlans.set(String(params.id), previous);
        return {
          ...params,
          data: {
            ...data,
            name: next.name,
            is_main: next.is_main,
            agreed_at: next.agreed_at ?? null,
            updated_at: nowIso(),
          },
        };
      },
      afterUpdate: async (result) => {
        const plan = result.data as TreatmentPlan;
        const previous = previousPlans.get(String(plan.id));
        previousPlans.delete(String(plan.id));
        if (!previous) return result;
        await auditPlan("update", plan, previous);
        if (
          plan.is_main &&
          (!previous.is_main ||
            Number(plan.discount_percent) !==
              Number(previous.discount_percent) ||
            Number(plan.discount_amount) !== Number(previous.discount_amount))
        ) {
          await syncAmount(plan.id);
        }
        if (
          plan.status === "agreed" &&
          OPEN_STATUSES.includes(previous.status)
        ) {
          await moveStage(plan);
        }
        return result;
      },
      beforeDelete: async (params) => {
        await checkRights();
        return params;
      },
      afterDelete: async (result) => {
        const plan = result.data as TreatmentPlan;
        for (const item of await itemsOf(plan.id)) {
          await baseDataProvider.delete("treatment_plan_items", {
            id: item.id,
            previousData: item,
          });
        }
        for (const stage of await stagesOf(plan.id)) {
          await baseDataProvider.delete("treatment_stages", {
            id: stage.id,
            previousData: stage,
          });
        }
        await auditPlan("delete", plan);
        return result;
      },
    },
    {
      resource: "treatment_plan_items",
      beforeCreate: async (params) => {
        await checkRights();
        const data = params.data as Partial<TreatmentPlanItem>;
        const plan = await getPlan(data.plan_id!);
        if (!plan) throw new Error("План не найден");
        const items = await itemsOf(plan.id);
        // Written by the id of its stage, or by a stage number only
        const stage =
          data.stage_id != null
            ? await getStage(data.stage_id)
            : await stageAt(plan, Number(data.stage_no ?? 1));
        if (!stage || !same(stage.plan_id, plan.id)) {
          throw new Error("Этап не найден в плане");
        }
        const stage_no = stage.position;
        const item = {
          quantity: 1,
          unit_price: 0,
          discount_percent: 0,
          done: false,
          position:
            Math.max(
              -1,
              ...items
                .filter((i) => i.stage_no === stage_no)
                .map((i) => i.position),
            ) + 1,
          created_at: nowIso(),
          ...data,
          stage_id: stage.id,
          stage_no,
        } as TreatmentPlanItem;
        return { ...params, data: { ...item, ...(await prepareItem(item)) } };
      },
      afterCreate: async (result) => {
        const item = result.data as TreatmentPlanItem;
        await stageProgress(item.stage_id);
        await afterItemsChanged(item.plan_id);
        return result;
      },
      beforeUpdate: async (params) => {
        await checkRights();
        const previous = (
          await all<TreatmentPlanItem>("treatment_plan_items")
        ).find((item) => same(item.id, params.id));
        if (!previous) throw new Error("Позиция не найдена");
        const data = { ...params.data } as Partial<TreatmentPlanItem>;
        if (data.plan_id != null && !same(data.plan_id, previous.plan_id)) {
          throw new Error("Позиция не переносится в другой план");
        }
        // Moved by a stage number only (stage 29): the stage of that number
        if (
          data.stage_no != null &&
          data.stage_no !== previous.stage_no &&
          (data.stage_id == null || same(data.stage_id, previous.stage_id))
        ) {
          const plan = await getPlan(previous.plan_id);
          if (plan) data.stage_id = (await stageAt(plan, data.stage_no)).id;
        }
        if (data.stage_id != null) {
          const stage = await getStage(data.stage_id);
          if (!stage || !same(stage.plan_id, previous.plan_id)) {
            throw new Error("Этап не найден в плане");
          }
          data.stage_no = stage.position;
        }
        previousItems.set(String(params.id), previous);
        return { ...params, data: await prepareItem(data, previous) };
      },
      afterUpdate: async (result) => {
        const item = result.data as TreatmentPlanItem;
        const previous = previousItems.get(String(item.id));
        previousItems.delete(String(item.id));
        if (previous && !same(previous.stage_id, item.stage_id)) {
          await stageProgress(previous.stage_id);
        }
        await stageProgress(item.stage_id);
        await afterItemsChanged(item.plan_id);
        return result;
      },
      beforeDelete: async (params) => {
        await checkRights();
        return params;
      },
      afterDelete: async (result) => {
        const item = result.data as TreatmentPlanItem;
        await stageProgress(item.stage_id);
        await afterItemsChanged(item.plan_id);
        return result;
      },
    },
    {
      resource: "treatment_stages",
      beforeCreate: async (params) => {
        await checkRights();
        const data = params.data as Partial<TreatmentStage>;
        const plan = await getPlan(data.plan_id!);
        if (!plan) throw new Error("План не найден");
        const position =
          Number(data.position ?? 0) >= 1
            ? Number(data.position)
            : nextStagePosition(await stagesOf(plan.id));
        if (position > MAX_STAGES) {
          throw new Error("В плане не больше 20 этапов");
        }
        const discount = Number(data.discount_percent ?? 0);
        if (discount > 0) await checkDiscount(discount);
        return {
          ...params,
          data: {
            status: "new",
            direction_id: null,
            deadline: null,
            created_at: nowIso(),
            ...data,
            position,
            name: data.name?.trim() || `Этап ${position}`,
            description: data.description?.trim() || null,
            doctor_id: data.doctor_id ?? plan.doctor_id ?? null,
            discount_percent: discount,
            updated_at: nowIso(),
          },
        };
      },
      afterCreate: async (result) => {
        await auditStage("create", result.data as TreatmentStage);
        return result;
      },
      beforeUpdate: async (params) => {
        await checkRights();
        const previous = await getStage(params.id);
        if (!previous) throw new Error("Этап не найден");
        const data = { ...params.data } as Partial<TreatmentStage>;
        if (data.plan_id != null && !same(data.plan_id, previous.plan_id)) {
          throw new Error("Этап не переносится в другой план");
        }
        const next = { ...previous, ...data };
        if (
          Number(next.discount_percent) > 0 &&
          Number(next.discount_percent) !== Number(previous.discount_percent)
        ) {
          await checkDiscount(Number(next.discount_percent));
        }
        previousStages.set(String(params.id), previous);
        return {
          ...params,
          data: {
            ...data,
            ...("name" in data
              ? { name: data.name?.trim() || `Этап ${next.position}` }
              : {}),
            ...("description" in data
              ? { description: data.description?.trim() || null }
              : {}),
            ...("discount_percent" in data
              ? { discount_percent: Number(data.discount_percent ?? 0) }
              : {}),
            updated_at: nowIso(),
          },
        };
      },
      afterUpdate: async (result) => {
        const stage = result.data as TreatmentStage;
        const previous = previousStages.get(String(stage.id));
        previousStages.delete(String(stage.id));
        if (!previous) return result;
        await auditStage("update", stage, previous);
        if (stage.position !== previous.position) {
          const items = (
            await all<TreatmentPlanItem>("treatment_plan_items")
          ).filter((item) => same(item.stage_id, stage.id));
          for (const item of items) {
            await baseDataProvider.update("treatment_plan_items", {
              id: item.id,
              data: { stage_no: stage.position },
              previousData: item,
            });
          }
        }
        if (
          stage.status !== previous.status ||
          Number(stage.discount_percent) !== Number(previous.discount_percent)
        ) {
          await afterItemsChanged(stage.plan_id);
        }
        return result;
      },
      beforeDelete: async (params) => {
        await checkRights();
        return params;
      },
      afterDelete: async (result) => {
        const stage = result.data as TreatmentStage;
        const items = (
          await all<TreatmentPlanItem>("treatment_plan_items")
        ).filter((item) => same(item.stage_id, stage.id));
        for (const item of items) {
          await baseDataProvider.delete("treatment_plan_items", {
            id: item.id,
            previousData: item,
          });
        }
        // The next stages move up
        for (const next of await stagesOf(stage.plan_id)) {
          if (next.position <= stage.position) continue;
          await getDataProvider().update("treatment_stages", {
            id: next.id,
            data: { position: next.position - 1 },
            previousData: next,
          });
        }
        await auditStage("delete", stage);
        await afterItemsChanged(stage.plan_id);
        return result;
      },
    },
    {
      resource: "treatment_stage_templates",
      beforeCreate: async (params) => {
        await checkRights();
        return {
          ...params,
          data: {
            description: null,
            direction_id: null,
            items: [],
            ...params.data,
            name: params.data.name?.trim() || "Этап",
            created_by: (await currentSalesId()) ?? null,
            created_at: nowIso(),
            updated_at: nowIso(),
          },
        };
      },
      afterCreate: async (result) => {
        const template = result.data as TreatmentStageTemplate;
        await logAudit({
          entity: "treatment_stage_template" as AuditLogEntry["entity"],
          entity_id: template.id,
          action: "create",
          changes: { name: [null, template.name] } as AuditLogEntry["changes"],
        });
        return result;
      },
      beforeUpdate: async (params) => {
        await checkRights();
        return params;
      },
      beforeDelete: async (params) => {
        await checkRights();
        return params;
      },
    },
    {
      // A deal moved to another patient (merge) takes its plans along
      resource: "deals",
      afterUpdate: async (result) => {
        const deal = result.data as Deal;
        const plans = (await all<TreatmentPlan>("treatment_plans")).filter(
          (plan) =>
            same(plan.deal_id, deal.id) &&
            !same(plan.patient_id, deal.patient_id),
        );
        for (const plan of plans) {
          await baseDataProvider.update("treatment_plans", {
            id: plan.id,
            data: { patient_id: deal.patient_id },
            previousData: plan,
          });
        }
        return result;
      },
    },
  ];

  // "treatment_plans_summary" reaches the demo as "treatment_plans" (the
  // filter adapter drops the suffix): reads of the plans give the totals
  const views = {
    treatment_plans: summaries,
    treatment_plan_stages: async () => {
      const [stages, items] = await Promise.all([
        all<TreatmentStage>("treatment_stages"),
        all<TreatmentPlanItem>("treatment_plan_items"),
      ]);
      return stages.map((stage) => {
        const own = items.filter((item) => same(item.stage_id, stage.id));
        const [group] = planTotals(
          { discount_percent: 0, discount_amount: 0 },
          own,
          [stage],
        ).stages;
        return {
          id: stage.id,
          plan_id: stage.plan_id,
          stage_no: stage.position,
          items_count: own.length,
          done_count: own.filter((item) => item.done).length,
          subtotal_amount: group?.subtotal ?? 0,
          stage_id: stage.id,
          name: stage.name,
          status: stage.status,
          discount_percent: stage.discount_percent,
          total_amount: group?.total ?? 0,
        };
      });
    },
  };

  return { methods, callbacks, views };
};
