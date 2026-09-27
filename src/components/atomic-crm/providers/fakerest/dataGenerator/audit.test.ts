import { describe, expect, it } from "vitest";

import type { AuditLogEntry } from "../../../types";
import { createDataProvider } from "../dataProvider";
import generateData from "./index";

describe("demo audit log", () => {
  it("covers every kind of action, oldest first, nothing in the future", () => {
    const db = generateData();
    const log = db.audit_log;
    expect(log.length).toBeGreaterThan(100);
    expect(new Set(log.map((row) => row.id)).size).toBe(log.length);
    const times = log.map((row) => row.at);
    expect([...times].sort()).toEqual(times);
    expect(times[times.length - 1] <= new Date().toISOString()).toBe(true);
    const entities = new Set(log.map((row) => row.entity));
    for (const entity of [
      "deal",
      "patient",
      "payment",
      "task",
      "employee",
      "pipeline",
      "stage",
      "settings",
      "messenger",
    ]) {
      expect(entities).toContain(entity);
    }
    // A system action has no employee but a source
    expect(
      log.some((row) => row.sales_id == null && row.source === "automation"),
    ).toBe(true);
    // Every deal row points at an existing deal and its patient
    const deals = new Map(db.deals.map((deal) => [deal.id, deal]));
    for (const row of log.filter((r) => r.entity === "deal")) {
      expect(deals.get(row.deal_id!)?.patient_id).toBe(row.patient_id);
    }
  });

  it("is listed with the deal and patient names, filtered and searched", async () => {
    const dataProvider = createDataProvider({
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: 0, fullName: "Owner" }) },
    });
    const { data, total } = await dataProvider.getList<AuditLogEntry>(
      "audit_log",
      {
        pagination: { page: 1, perPage: 10 },
        sort: { field: "at", order: "DESC" },
        filter: { "entity@in": "(deal)" },
      },
    );
    expect(data).toHaveLength(10);
    expect(total).toBeGreaterThan(10);
    expect(data.every((row) => row.entity === "deal")).toBe(true);
    expect(data[0].at >= data[9].at).toBe(true);
    const named = data.find((row) => row.deal_name);
    expect(named?.patient_name).toBeTruthy();

    const { data: found } = await dataProvider.getList<AuditLogEntry>(
      "audit_log",
      {
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "at", order: "DESC" },
        filter: { q: named!.deal_name!.toLowerCase() },
      },
    );
    // FakeRest's q looks in every column: the rows of that deal are among them
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.some((row) =>
        row.search_text?.includes(named!.deal_name!.toLowerCase()),
      ),
    ).toBe(true);
  });

  it("logs a payment and the deal change made in the demo", async () => {
    const dataProvider = createDataProvider({
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: 0, fullName: "Owner" }) },
    });
    const { data: deals } = await dataProvider.getList("deals", {
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    });
    const deal = deals[0];
    await dataProvider.update("deals", {
      id: deal.id,
      data: { plan_amount: Number(deal.plan_amount) + 1000 },
      previousData: deal,
    });
    await dataProvider.create("deal_payments", {
      data: { deal_id: deal.id, amount: 5000 },
    });
    const { data } = await dataProvider.getList<AuditLogEntry>("audit_log", {
      pagination: { page: 1, perPage: 5 },
      sort: { field: "id", order: "DESC" },
      filter: {},
    });
    expect(data.find((row) => row.entity === "payment")).toMatchObject({
      action: "create",
      sales_id: 0,
      deal_id: deal.id,
      changes: { amount: [null, 5000] },
    });
    expect(
      data.find(
        (row) => row.entity === "deal" && row.changes.plan_amount !== undefined,
      )?.changes.plan_amount,
    ).toEqual([deal.plan_amount, Number(deal.plan_amount) + 1000]);
  });
});
