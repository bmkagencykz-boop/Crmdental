import { beforeAll, describe, expect, it } from "vitest";

import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentPlanSummary,
  TreatmentStage,
  TreatmentStageTemplate,
} from "../../treatment/types";
import type { Deal } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
});

const setup = () => {
  const db = generateData();
  // An open deal without plans
  const deal = db.deals.find(
    (d) =>
      d.pipeline_id === 1 &&
      !d.archived_at &&
      !d.unsorted_at &&
      !db.treatment_plans.some((p) => p.deal_id === d.id),
  )! as Deal;
  deal.plan_amount = 0;
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({ id: 0, fullName: "Владелец" }),
    },
  }) as CrmDataProvider;
  return { db, deal, dataProvider };
};

const list = async <T>(
  dataProvider: CrmDataProvider,
  resource: string,
  filter: Record<string, unknown> = {},
) =>
  (
    await dataProvider.getList(resource, {
      filter,
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

describe("demo plan editor (stage 34)", () => {
  it("has plans with stages, teeth, templates and the dictionaries", () => {
    const { db } = setup();
    expect(db.treatment_plan_types.map((t) => t.name)).toEqual([
      "Основной",
      "Альтернативный",
      "Эконом",
      "Премиум",
    ]);
    expect(db.treatment_directions).toHaveLength(8);
    expect(db.treatment_stage_templates.length).toBeGreaterThanOrEqual(3);
    for (const plan of db.treatment_plans) {
      const stages = db.treatment_stages.filter((s) => s.plan_id === plan.id);
      expect(stages.length, plan.name).toBeGreaterThanOrEqual(1);
      for (const item of db.treatment_plan_items.filter(
        (i) => i.plan_id === plan.id,
      )) {
        const stage = stages.find((s) => s.id === item.stage_id);
        expect(stage?.position).toBe(item.stage_no);
      }
    }
    expect(
      db.treatment_plans.some(
        (plan) =>
          db.treatment_stages.filter((s) => s.plan_id === plan.id).length >= 3,
      ),
    ).toBe(true);
    expect(db.treatment_plan_items.some((i) => i.tooth === "36")).toBe(true);
  });

  it("a new plan gets «Этап 1»; stages, discounts and cancelled stages count in the totals", async () => {
    const { db, deal, dataProvider } = setup();
    const { data: plan } = await dataProvider.create<TreatmentPlan>(
      "treatment_plans",
      { data: { deal_id: deal.id, name: "План лечения, 28.09.2026" } },
    );
    let stages = await list<TreatmentStage>(dataProvider, "treatment_stages", {
      plan_id: plan.id,
    });
    expect(stages.map((s) => [s.position, s.name, s.status])).toEqual([
      [1, "Этап 1", "new"],
    ]);
    const { data: second } = await dataProvider.create<TreatmentStage>(
      "treatment_stages",
      { data: { plan_id: plan.id, name: " " } },
    );
    expect([second.position, second.name]).toEqual([2, "Этап 2"]);
    const caries = db.services.find((s) => s.code === "T-01")!;
    for (const tooth of ["16", "17"]) {
      await dataProvider.create("treatment_plan_items", {
        data: {
          plan_id: plan.id,
          stage_id: stages[0].id,
          service_id: caries.id,
          name: "",
          tooth,
          quantity: 2,
          unit_price: 25_000,
          discount_percent: 10,
        },
      });
    }
    await dataProvider.create("treatment_plan_items", {
      data: {
        plan_id: plan.id,
        stage_id: second.id,
        name: "Имплант",
        tooth: "36",
        quantity: 1,
        unit_price: 100_000,
        discount_percent: 0,
      },
    });
    // A stage number only (stage 29 clients): the stage is created
    await dataProvider.create("treatment_plan_items", {
      data: { plan_id: plan.id, stage_no: 3, name: "Гигиена", unit_price: 999 },
    });
    stages = await list<TreatmentStage>(dataProvider, "treatment_stages", {
      plan_id: plan.id,
    });
    expect(stages.map((s) => s.name)).toEqual(["Этап 1", "Этап 2", "Этап 3"]);
    await dataProvider.update("treatment_stages", {
      id: stages[0].id,
      data: { discount_percent: 5 },
      previousData: stages[0],
    });
    await dataProvider.update("treatment_stages", {
      id: stages[2].id,
      data: { status: "cancelled" },
      previousData: stages[2],
    });
    await dataProvider.update("treatment_plans", {
      id: plan.id,
      data: { discount_percent: 0, discount_amount: 5_500 },
      previousData: plan,
    });
    const [summary] = await list<TreatmentPlanSummary>(
      dataProvider,
      "treatment_plans_summary",
      { id: plan.id },
    );
    expect(summary).toMatchObject({
      // Stage 1: 2 × (2 × 25 000 − 10 %) − 5 % = 85 500; stage 2: 100 000;
      // stage 3 is cancelled
      gross_amount: 200_000,
      subtotal_amount: 185_500,
      stages_discount_amount: 14_500,
      extra_discount_amount: 5_500,
      total_amount: 180_000,
    });
  });

  it("follows the items, renumbers, saves and adds templates, duplicates stages", async () => {
    const { db, deal, dataProvider } = setup();
    const { data: plan } = await dataProvider.create<TreatmentPlan>(
      "treatment_plans",
      { data: { deal_id: deal.id, name: "План" } },
    );
    const [first] = await list<TreatmentStage>(
      dataProvider,
      "treatment_stages",
      { plan_id: plan.id },
    );
    const { data: second } = await dataProvider.create<TreatmentStage>(
      "treatment_stages",
      { data: { plan_id: plan.id, name: "Имплантация" } },
    );
    const { data: third } = await dataProvider.create<TreatmentStage>(
      "treatment_stages",
      { data: { plan_id: plan.id, name: "Коронки" } },
    );
    const caries = db.services.find((s) => s.code === "T-01")!;
    const { data: item } = await dataProvider.create<TreatmentPlanItem>(
      "treatment_plan_items",
      {
        data: {
          plan_id: plan.id,
          stage_id: first.id,
          service_id: caries.id,
          name: "",
          tooth: "16",
          quantity: 1,
          unit_price: caries.price,
        },
      },
    );
    await dataProvider.create("treatment_plan_items", {
      data: {
        plan_id: plan.id,
        stage_id: third.id,
        name: "Коронка",
        tooth: "36",
        quantity: 1,
        unit_price: 60_000,
      },
    });
    await dataProvider.update("treatment_plan_items", {
      id: item.id,
      data: { done: true },
      previousData: item,
    });
    const stageStatus = async (id: unknown) =>
      (
        await list<TreatmentStage>(dataProvider, "treatment_stages", {
          plan_id: plan.id,
        })
      ).find((s) => s.id === id)?.status;
    expect(await stageStatus(first.id)).toBe("done");

    // «Сохранить как шаблон этапа» → «Добавить этап из шаблона»
    const templateId = await dataProvider.saveStageTemplate(first.id, "Кариес");
    const template = (
      await list<TreatmentStageTemplate>(
        dataProvider,
        "treatment_stage_templates",
      )
    ).find((t) => t.id === templateId)!;
    expect(template.items).toEqual([
      {
        service_id: caries.id,
        name: caries.name,
        quantity: 1,
        unit_price: caries.price,
        discount_percent: 0,
      },
    ]);
    const stageId = await dataProvider.addStageFromTemplate(
      plan.id,
      templateId,
    );
    const added = await list<TreatmentPlanItem>(
      dataProvider,
      "treatment_plan_items",
      { stage_id: stageId },
    );
    expect(added.map((i) => [i.tooth, i.stage_no, i.done])).toEqual([
      [null, 4, false],
    ]);

    // Deleting a stage: the next ones move up, the items follow
    await dataProvider.delete("treatment_stages", {
      id: second.id,
      previousData: second,
    });
    const stages = await list<TreatmentStage>(
      dataProvider,
      "treatment_stages",
      { plan_id: plan.id },
    );
    expect(
      stages
        .sort((a, b) => a.position - b.position)
        .map((s) => [s.position, s.name]),
    ).toEqual([
      [1, "Этап 1"],
      [2, "Коронки"],
      [3, "Кариес"],
    ]);
    const crown = (
      await list<TreatmentPlanItem>(dataProvider, "treatment_plan_items", {
        plan_id: plan.id,
      })
    ).find((i) => i.name === "Коронка")!;
    expect(crown.stage_no).toBe(2);

    // «Дублировать план» copies the stages
    const copyId = await dataProvider.duplicateTreatmentPlan(plan.id);
    const copied = await list<TreatmentStage>(
      dataProvider,
      "treatment_stages",
      { plan_id: copyId },
    );
    expect(copied.map((s) => [s.position, s.name, s.status])).toEqual([
      [1, "Этап 1", "new"],
      [2, "Коронки", "new"],
      [3, "Кариес", "new"],
    ]);
  });
});
