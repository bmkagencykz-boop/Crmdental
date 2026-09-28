import { beforeAll, describe, expect, it } from "vitest";

import type { AuditLogEntry, Deal, Patient, Sale, Task } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";
import {
  DEMO_REPORTS_EMAIL,
  DEMO_RESTRICTED_EMAIL,
} from "./dataGenerator/accessRights";

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

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

describe("demo access rights", () => {
  it("has two administrators with narrowed rights", async () => {
    const { db, dataProvider } = setup();
    const rows = await dataProvider.getAccessRights();
    expect(rows).toHaveLength(2);
    expect(db.sales.some((s) => s.email === DEMO_RESTRICTED_EMAIL)).toBe(true);
    expect(db.sales.some((s) => s.email === DEMO_REPORTS_EMAIL)).toBe(true);
  }, 60_000);

  it("shows a restricted employee only their own deals, patients and tasks", async () => {
    const { db, dataProvider, loginAs } = setup();
    const me = loginAs(DEMO_RESTRICTED_EMAIL);
    const deals = await list<Deal>(dataProvider, "deals");
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.length).toBeLessThan(db.deals.length);
    expect(deals.every((deal) => String(deal.sales_id) === String(me.id))).toBe(
      true,
    );
    const tasks = await list<Task>(dataProvider, "tasks");
    expect(tasks.every((task) => String(task.sales_id) === String(me.id))).toBe(
      true,
    );
    const patients = await list<Patient>(dataProvider, "patients");
    expect(patients.length).toBeLessThan(db.patients.length);
    const rights = await dataProvider.getMyAccessRights();
    expect(rights?.customized).toBe(true);
    expect(rights?.rights.deals.export).toBe("none");
  }, 60_000);

  it("refuses writes outside the scopes", async () => {
    const { db, dataProvider, loginAs } = setup();
    const me = loginAs(DEMO_RESTRICTED_EMAIL);
    const foreign = db.deals.find(
      (deal) =>
        deal.sales_id != null && String(deal.sales_id) !== String(me.id),
    )!;
    await expect(
      dataProvider.update("deals", {
        id: foreign.id,
        data: { name: "x" },
        previousData: foreign,
      }),
    ).rejects.toThrow();
    const own = db.deals.find(
      (deal) => String(deal.sales_id) === String(me.id),
    )!;
    await expect(
      dataProvider.delete("deals", { id: own.id, previousData: own }),
    ).rejects.toThrow();
  }, 60_000);

  it("lets only the owner change rights, and logs it", async () => {
    const { db, dataProvider, loginAs } = setup();
    const manager = db.sales.find(
      (s) =>
        s.role === "manager" &&
        s.email !== DEMO_RESTRICTED_EMAIL &&
        s.email !== DEMO_REPORTS_EMAIL,
    )!;
    const owner = db.sales.find((s) => s.role === "owner")!;
    await expect(
      dataProvider.saveAccessRights(owner.id, { deals: { view: "none" } }),
    ).rejects.toThrow();
    const matrix = await dataProvider.saveAccessRights(manager.id, {
      deals: { view: "own" },
    });
    expect(matrix.deals.view).toBe("own");
    const log = await list<AuditLogEntry>(dataProvider, "audit_log");
    expect(
      log.some(
        (row) =>
          row.entity === "access_rights" &&
          String(row.entity_id) === String(manager.id),
      ),
    ).toBe(true);
    // Settings: the role head
    await dataProvider.saveAccessRights(manager.id, null, true);
    const { data: promoted } = await dataProvider.getOne<Sale>("sales", {
      id: manager.id,
    });
    expect(promoted.role).toBe("head");
    loginAs(DEMO_REPORTS_EMAIL);
    await expect(
      dataProvider.saveAccessRights(manager.id, null),
    ).rejects.toThrow();
  }, 60_000);

  it("lets the curator delete no deal in bulk", async () => {
    const { db, dataProvider, loginAs } = setup();
    loginAs(DEMO_REPORTS_EMAIL);
    await expect(
      dataProvider.bulkDeals("delete", [db.deals[0].id]),
    ).rejects.toThrow();
  }, 60_000);
});
