import { beforeAll, describe, expect, it } from "vitest";

import type { StageTriggerRun } from "../../pipeline-automation/types";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentPlanSummary,
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

/** identity 0 is the owner, 1..5 are managers */
const setup = (
  identity = 0,
  prepare: (db: ReturnType<typeof generateData>) => void = () => undefined,
) => {
  const db = generateData();
  prepare(db);
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({ id: identity, fullName: "Сотрудник" }),
    },
  });
  return { db, dataProvider };
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

/**
 * An open deal of the main pipeline without plans, put at a stage before
 * the demo provider is created (it copies the data)
 */
const freshDeal = (db: ReturnType<typeof generateData>, stageName = "Записан") => {
  const stage = db.stages.find((s) => s.name === stageName && s.pipeline_id === 1)!;
  const deal = db.deals.find(
    (d) =>
      d.pipeline_id === 1 &&
      !d.archived_at &&
      !d.unsorted_at &&
      !db.treatment_plans.some((p) => p.deal_id === d.id),
  )!;
  Object.assign(deal, {
    stage_id: stage.id,
    plan_amount: 0,
    lost_reason_id: null,
    closed_at: null,
  });
  return deal;
};

const withFreshDeal = (identity = 0, stageName = "Записан") => {
  let deal!: Deal;
  const context = setup(identity, (db) => {
    deal = freshDeal(db, stageName);
  });
  return { ...context, deal };
};

describe("demo treatment plans", () => {
  it("has a price list of about forty services and plans in every status", () => {
    const { db } = setup();
    const priced = db.services.filter((s) => s.price != null && s.code);
    expect(priced.length).toBeGreaterThanOrEqual(40);
    expect(new Set(priced.map((s) => s.category)).size).toBe(8);
    const statuses = new Set(db.treatment_plans.map((p) => p.status));
    for (const status of ["draft", "presented", "agreed", "in_progress", "completed", "declined"]) {
      expect(statuses.has(status as TreatmentPlan["status"]), status).toBe(true);
    }
    // One deal with two variants
    const perDeal = new Map<string, number>();
    for (const plan of db.treatment_plans) {
      perDeal.set(String(plan.deal_id), (perDeal.get(String(plan.deal_id)) ?? 0) + 1);
    }
    expect([...perDeal.values()].some((n) => n >= 2)).toBe(true);
    // At most one main plan per deal; the deal amount covers it
    for (const [dealId] of perDeal) {
      expect(
        db.treatment_plans.filter((p) => String(p.deal_id) === dealId && p.is_main)
          .length,
      ).toBeLessThanOrEqual(1);
    }
    expect(db.patients.some((p) => p.allergies)).toBe(true);
  });

  it("agreeing a plan sets the deal amount and moves the deal", async () => {
    const { db, dataProvider, deal } = withFreshDeal();
    const implant = db.services.find((s) => s.code === "I-01")!;
    const { data: plan } = await dataProvider.create<TreatmentPlan>(
      "treatment_plans",
      { data: { deal_id: deal.id, name: "Вариант эконом" } },
    );
    expect(plan).toMatchObject({ status: "draft", is_main: false, patient_id: deal.patient_id });
    await dataProvider.create("treatment_plan_items", {
      data: {
        plan_id: plan.id,
        service_id: implant.id,
        name: "",
        tooth: " 36 ",
        quantity: 2,
        unit_price: implant.price,
        discount_percent: 5,
      },
    });
    const [item] = await list<TreatmentPlanItem>(dataProvider, "treatment_plan_items", {
      plan_id: plan.id,
    });
    expect(item).toMatchObject({ name: implant.name, tooth: "36", line_total: 342_000 });

    await dataProvider.update("treatment_plans", {
      id: plan.id,
      data: { status: "agreed" },
      previousData: plan,
    });
    const { data: after } = await dataProvider.getOne<Deal>("deals", { id: deal.id });
    expect(after.plan_amount).toBe(342_000);
    expect(db.stages.find((s) => s.id === after.stage_id)?.name).toBe("План согласован");
    const runs = await list<StageTriggerRun>(dataProvider, "stage_trigger_runs", {
      deal_id: deal.id,
    });
    expect(runs.some((run) => run.status === "done" && run.action === "move_stage")).toBe(true);

    // Items of the agreed plan change the amount; progress moves the status
    await dataProvider.update("treatment_plan_items", {
      id: item.id,
      data: { quantity: 1, done: true },
      previousData: item,
    });
    const [summary] = await list<TreatmentPlanSummary>(
      dataProvider,
      "treatment_plans_summary",
      { id: plan.id },
    );
    expect(summary).toMatchObject({ status: "completed", total_amount: 171_000, done_count: 1 });
    expect((await dataProvider.getOne<Deal>("deals", { id: deal.id })).data.plan_amount).toBe(
      171_000,
    );

    // A second variant agreed becomes the main plan
    const copyId = await dataProvider.duplicateTreatmentPlan(plan.id);
    const { data: copy } = await dataProvider.getOne<TreatmentPlan>("treatment_plans", {
      id: copyId,
    });
    expect(copy).toMatchObject({ status: "draft", name: "Вариант эконом (копия)" });
    await dataProvider.update("treatment_plans", {
      id: copyId,
      data: { status: "agreed" },
      previousData: copy,
    });
    const plans = await list<TreatmentPlan>(dataProvider, "treatment_plans", { deal_id: deal.id });
    expect(plans.filter((p) => p.is_main).map((p) => p.id)).toEqual([copyId]);
  });

  it("a move refused by the stage checklist is skipped and logged", async () => {
    // The demo checklist of «Пришёл на консультацию» is not done
    const { db, dataProvider, deal } = withFreshDeal(0, "Пришёл на консультацию");
    const consultation = db.stages.find((s) => s.name === "Пришёл на консультацию")!;
    const { data: plan } = await dataProvider.create<TreatmentPlan>("treatment_plans", {
      data: { deal_id: deal.id, name: "План" },
    });
    await dataProvider.create("treatment_plan_items", {
      data: { plan_id: plan.id, name: "Коронка", unit_price: 120_000 },
    });
    await dataProvider.update("treatment_plans", {
      id: plan.id,
      data: { status: "agreed" },
      previousData: plan,
    });
    const { data: after } = await dataProvider.getOne<Deal>("deals", { id: deal.id });
    expect(after.stage_id).toBe(consultation.id);
    expect(after.plan_amount).toBe(120_000);
    const runs = await list<StageTriggerRun>(dataProvider, "stage_trigger_runs", {
      deal_id: deal.id,
    });
    expect(runs.find((run) => run.status === "skipped")?.error).toMatch(/чек-лист/);
  });

  it("a manager keeps to the discount limit and the price list", async () => {
    const { db, dataProvider, deal } = withFreshDeal(1);
    const crown = db.services.find((s) => s.code === "O-02")!;
    const { data: plan } = await dataProvider.create<TreatmentPlan>("treatment_plans", {
      data: { deal_id: deal.id, name: "План" },
    });
    await expect(
      dataProvider.create("treatment_plan_items", {
        data: { plan_id: plan.id, name: "Скидка", unit_price: 10_000, discount_percent: 15 },
      }),
    ).rejects.toThrow(/Скидка больше 10/);
    await expect(
      dataProvider.create("treatment_plan_items", {
        data: { plan_id: plan.id, service_id: crown.id, unit_price: 100_000 },
      }),
    ).rejects.toThrow(/ниже прайса/);
    await dataProvider.create("treatment_plan_items", {
      data: { plan_id: plan.id, service_id: crown.id, unit_price: 120_000, discount_percent: 10 },
    });
    await expect(
      dataProvider.update("treatment_plans", {
        id: plan.id,
        data: { discount_percent: 5, discount_amount: 20_000 },
        previousData: plan,
      }),
    ).rejects.toThrow(/Скидка больше/);
  });

  it("reports the services of the agreed plans (owner only)", async () => {
    const { dataProvider } = setup();
    const rows = await dataProvider.getPlanServicesReport({});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].amount).toBeGreaterThanOrEqual(rows.at(-1)!.amount);
    const manager = setup(1).dataProvider;
    await expect(manager.getPlanServicesReport({})).rejects.toThrow();
  });
});
