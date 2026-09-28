import { beforeAll, describe, expect, it } from "vitest";

import type { Deal, Sale, Task } from "../../types";
import type { Visit } from "../../schedule/types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";
import { DEMO_BRANCH_EMAIL } from "./dataGenerator/branches";

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
}, 120_000);

const setup = () => {
  const db = generateData();
  let current: Sale = db.sales.find((sale) => sale.role === "owner")!;
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({
        id: current.id,
        fullName: current.first_name,
      }),
    },
  });
  const loginAs = (email: string) => {
    current = db.sales.find((sale) => sale.email === email)!;
    return current;
  };
  return { db, dataProvider, loginAs };
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

const ABAYA = 2;

describe("demo branches", () => {
  it("has a second branch with doctors, a chair, deals and an employee", async () => {
    const { db } = setup();
    expect(db.branches.map((b) => b.name)).toContain("Филиал на Абая");
    expect(db.doctors.some((d) => d.branch_id === ABAYA)).toBe(true);
    expect(db.chairs.some((c) => c.branch_id === ABAYA)).toBe(true);
    expect(db.deals.some((d) => d.branch_id === ABAYA)).toBe(true);
    const employee = db.sales.find((s) => s.email === DEMO_BRANCH_EMAIL)!;
    expect(
      db.sales_branches.some(
        (row) => row.sales_id === employee.id && row.branch_id === ABAYA,
      ),
    ).toBe(true);
    // Tasks are in the branch of their deal, visits of a doctor of Abaya on Abaya
    const dealBranch = new Map(db.deals.map((d) => [d.id, d.branch_id]));
    expect(
      db.tasks.every(
        (t) => (t.branch_id ?? null) === dealBranch.get(t.deal_id),
      ),
    ).toBe(true);
    const abayaDoctors = new Set(
      db.doctors.filter((d) => d.branch_id === ABAYA).map((d) => d.id),
    );
    expect(
      db.visits
        .filter((v) => v.doctor_id != null && abayaDoctors.has(v.doctor_id))
        .every((v) => v.branch_id === ABAYA),
    ).toBe(true);
  }, 60_000);

  it("filters the lists by branch and shows the branch name", async () => {
    const { dataProvider } = setup();
    const deals = await list<Deal>(dataProvider, "deals", {
      branch_id: ABAYA,
    });
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((deal) => deal.branch_name === "Филиал на Абая")).toBe(
      true,
    );
    const tasks = await list<Task>(dataProvider, "tasks", {
      branch_id: ABAYA,
    });
    expect(tasks.every((task) => task.branch_id === ABAYA)).toBe(true);
  }, 60_000);

  it("shows the employee of a branch «Мой филиал»", async () => {
    const { db, dataProvider, loginAs } = setup();
    const me = loginAs(DEMO_BRANCH_EMAIL);
    const rights = await dataProvider.getMyAccessRights();
    expect(rights?.rights.deals.view).toBe("branch");
    expect(rights?.branch_ids).toEqual([ABAYA]);
    const deals = await list<Deal>(dataProvider, "deals");
    expect(deals.length).toBeLessThan(db.deals.length);
    expect(
      deals.every(
        (deal) =>
          deal.branch_id == null ||
          deal.branch_id === ABAYA ||
          String(deal.sales_id) === String(me.id),
      ),
    ).toBe(true);
    // A deal of the other branch cannot be edited
    const other = db.deals.find(
      (deal) => deal.branch_id === 1 && String(deal.sales_id) !== String(me.id),
    )!;
    await expect(
      dataProvider.update("deals", {
        id: other.id,
        data: { name: "x" },
        previousData: other,
      }),
    ).rejects.toThrow();
  }, 60_000);

  it("gives a new deal, its tasks and a visit their branch", async () => {
    const { db, dataProvider, loginAs } = setup();
    // An employee of one branch creates a deal: it is in that branch
    loginAs(DEMO_BRANCH_EMAIL);
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: { patient_id: db.patients[0].id, name: "Новая на Абая" },
    });
    expect(deal.branch_id).toBe(ABAYA);
    const { data: task } = await dataProvider.create<Task>("tasks", {
      data: {
        deal_id: deal.id,
        type: "call",
        text: "Позвонить",
        due_date: new Date().toISOString(),
      },
    });
    expect(task.branch_id).toBe(ABAYA);

    // The owner moves the deal: the task follows
    loginAs("owner@demo.kz");
    await dataProvider.update("deals", {
      id: deal.id,
      data: { branch_id: 1 },
      previousData: deal,
    });
    const moved = (await list<Task>(dataProvider, "tasks")).find(
      (t) => t.id === task.id,
    );
    expect(moved?.branch_id).toBe(1);

    // A visit takes the branch of its chair
    const chair = db.chairs.find((c) => c.branch_id === ABAYA)!;
    const starts = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
    starts.setUTCHours(5, 0, 0, 0);
    const { data: visit } = await dataProvider.create<Visit>("visits", {
      data: {
        patient_id: db.patients[0].id,
        chair_id: chair.id,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 30 * 60 * 1000).toISOString(),
      },
    });
    expect(visit.branch_id).toBe(ABAYA);
  }, 60_000);

  it("lets only the owner and the head manage the branches", async () => {
    const { dataProvider, loginAs } = setup();
    loginAs(DEMO_BRANCH_EMAIL);
    await expect(
      dataProvider.create("branches", {
        data: { name: "Мой", is_active: true, position: 5 },
      }),
    ).rejects.toThrow();
    await expect(dataProvider.assignBranchToUnassigned(1)).rejects.toThrow();
    loginAs("owner@demo.kz");
    // Deleting a branch with deals is refused
    await expect(
      dataProvider.delete("branches", {
        id: ABAYA,
        previousData: { id: ABAYA },
      }),
    ).rejects.toThrow();
  }, 60_000);

  it("filters the reports by branch", async () => {
    const { db, dataProvider } = setup();
    const all = await dataProvider.getReport("conversion", {});
    const abaya = await dataProvider.getReport("conversion", {
      branch_id: ABAYA,
    });
    expect(abaya.totals.deals).toBe(
      db.deals.filter((d) => d.branch_id === ABAYA).length,
    );
    expect(abaya.totals.deals).toBeLessThan(all.totals.deals);
  }, 60_000);
});
