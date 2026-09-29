import { beforeAll, describe, expect, it } from "vitest";

import { localDay } from "../../lab/labMath";
import type {
  LabOrder,
  LabOrderBalance,
  LabOrderCost,
  LabOrderEvent,
  LabOrderRemake,
  LabOrderSummary,
  LabPaymentAllocation,
} from "../../lab/types";
import type { Patient, Sale, Task } from "../../types";
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
  const loginAs = (role: Sale["role"]) => {
    current = db.sales.find((sale) => sale.role === role && !sale.disabled)!;
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

describe("demo lab module (stage 43)", { timeout: 60_000 }, () => {
  it("generates prices per lab, remakes, a warranty remake, a fitting visit, allocations", () => {
    const { db } = setup();
    expect(db.lab_work_type_prices.some((p) => p.lab_id === 2)).toBe(true);
    expect(
      db.lab_work_type_prices.some((p) => p.effective_from !== "2000-01-01"),
    ).toBe(true);
    expect(db.lab_remake_reasons.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        "Не подошёл цвет",
        "Не сел",
        "Скол",
        "Ошибка оттиска",
      ]),
    );
    expect(db.lab_order_remakes.some((r) => r.is_warranty && !r.is_paid)).toBe(
      true,
    );
    expect(
      db.lab_order_remakes.some((r) => r.fault === "clinic" && r.is_paid),
    ).toBe(true);
    expect(
      db.lab_order_remakes.some((r) => r.fault === "lab" && !r.is_paid),
    ).toBe(true);
    const linked = db.lab_orders.find((o) => o.fitting_visit_id != null);
    expect(linked).toBeTruthy();
    expect(
      db.visits.find((v) => v.id === linked!.fitting_visit_id)?.patient_id,
    ).toBe(linked!.patient_id);
    expect(db.lab_order_events.length).toBeGreaterThan(db.lab_orders.length);
    expect(db.lab_payment_allocations.length).toBeGreaterThan(0);
    // The own lab is cheaper than the external one
    const own = db.lab_work_type_prices.find(
      (p) => p.lab_id === 2 && p.work_type_id === 1,
    )!;
    const external = db.lab_work_type_prices
      .filter((p) => p.lab_id == null && p.work_type_id === 1)
      .sort((a, b) => b.effective_from!.localeCompare(a.effective_from!))[0];
    expect(own.price).toBeLessThan(external.price);
  });

  it("prices a line by the order's lab and reprices it with another lab", async () => {
    const { db, dataProvider } = setup();
    const patient = (await list<Patient>(dataProvider, "patients"))[0];
    const { data: order } = await dataProvider.create<LabOrder>("lab_orders", {
      data: { patient_id: patient.id, lab_id: 1 },
    });
    await dataProvider.create("lab_order_items", {
      data: { order_id: order.id, work_type_id: 1, qty: 1 },
    });
    const summary = async () =>
      (await list<LabOrderSummary>(dataProvider, "lab_orders_summary")).find(
        (o) => o.id === order.id,
      )!;
    expect((await summary()).lab_cost).toBe(18000);
    await dataProvider.update("lab_orders", {
      id: order.id,
      data: { lab_id: 2 },
      previousData: order,
    });
    expect((await summary()).lab_cost).toBe(
      db.lab_work_type_prices.find(
        (p) => p.lab_id === 2 && p.work_type_id === 1,
      )!.price,
    );
    const events = (
      await list<LabOrderEvent>(dataProvider, "lab_order_events")
    ).filter((e) => e.order_id === order.id);
    expect(events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("records a remake: reason, fault, paid or free, the owner decides, the cost", async () => {
    const { db, dataProvider, loginAs } = setup();
    loginAs("manager");
    const patient = (await list<Patient>(dataProvider, "patients"))[0];
    const deal = db.deals.find((d) => d.patient_id === patient.id);
    const { data: order } = await dataProvider.create<LabOrder>("lab_orders", {
      data: {
        patient_id: patient.id,
        lab_id: 1,
        deal_id: deal?.id ?? null,
        status: "fitting",
      },
    });
    await dataProvider.create("lab_order_items", {
      data: { order_id: order.id, work_type_id: 1, qty: 2 },
    });
    const reason = db.lab_remake_reasons.find((r) => r.name === "Не сел")!;
    await dataProvider.labOrderRemake({
      order_id: order.id,
      reason_id: reason.id,
      fault: "clinic",
      comment: " контакт ",
    });
    const remakeOf = async () =>
      (await list<LabOrderRemake>(dataProvider, "lab_order_remakes")).find(
        (r) => r.order_id === order.id,
      )!;
    expect(await remakeOf()).toMatchObject({
      reason: "Не сел",
      fault: "clinic",
      is_paid: true,
      is_warranty: false,
      from_status: "fitting",
      comment: "контакт",
    });
    // A manager does not waive the payment
    await expect(
      dataProvider.update("lab_order_remakes", {
        id: (await remakeOf()).id,
        data: { is_paid: false },
        previousData: await remakeOf(),
      }),
    ).rejects.toThrow();
    // Back ready: billed, one invitation
    const { data: saved } = await dataProvider.getOne<LabOrder>("lab_orders", {
      id: order.id,
    });
    await dataProvider.update("lab_orders", {
      id: order.id,
      data: { status: "ready" },
      previousData: saved,
    });
    expect((await remakeOf()).ready_at).toBe(localDay());
    loginAs("owner");
    const costs = (
      await list<LabOrderCost>(dataProvider, "lab_order_costs")
    ).filter((c) => c.order_id === order.id);
    expect(costs.reduce((sum, c) => sum + c.amount, 0)).toBe(2 * 18000 * 2);
    expect(costs.find((c) => c.kind === "remake")).toMatchObject({
      billed_on: localDay(),
    });
    if (deal) {
      const tasks = (await list<Task>(dataProvider, "tasks")).filter((t) =>
        t.text.startsWith(
          `Пригласить пациента на примерку/сдачу: наряд №${order.number}`,
        ),
      );
      expect(tasks).toHaveLength(1);
    }
    // The owner waives it: nothing more to pay
    await dataProvider.update("lab_order_remakes", {
      id: (await remakeOf()).id,
      data: { is_paid: false },
      previousData: await remakeOf(),
    });
    expect(
      (await list<LabOrderCost>(dataProvider, "lab_order_costs")).filter(
        (c) => c.order_id === order.id && c.kind === "remake",
      ),
    ).toHaveLength(0);
    const kinds = (await list<LabOrderEvent>(dataProvider, "lab_order_events"))
      .filter((e) => e.order_id === order.id)
      .map((e) => e.kind);
    expect(kinds).toEqual(["created", "remake", "status", "invite"]);
  });

  it("flags a remake under the warranty as free", async () => {
    const { dataProvider } = setup();
    const patient = (await list<Patient>(dataProvider, "patients"))[1];
    const { data: order } = await dataProvider.create<LabOrder>("lab_orders", {
      data: { patient_id: patient.id, lab_id: 1 },
    });
    await dataProvider.create("lab_order_items", {
      data: { order_id: order.id, work_type_id: 2, qty: 1 },
    });
    const { data: given } = await dataProvider.update<LabOrder>("lab_orders", {
      id: order.id,
      data: { status: "delivered" },
      previousData: order,
    });
    const summary = (
      await list<LabOrderSummary>(dataProvider, "lab_orders_summary")
    ).find((o) => o.id === order.id)!;
    expect(summary.warranty_months).toBe(24);
    expect(summary.warranty_until).toBeTruthy();
    await dataProvider.labOrderRemake({ order_id: given.id, fault: "clinic" });
    const remake = (
      await list<LabOrderRemake>(dataProvider, "lab_order_remakes")
    ).find((r) => r.order_id === order.id)!;
    expect(remake).toMatchObject({
      is_warranty: true,
      is_paid: false,
      from_status: "delivered",
    });
    const { data: after } = await dataProvider.getOne<LabOrder>("lab_orders", {
      id: order.id,
    });
    expect(after.first_delivered_at).toBe(localDay());
  });

  it("links the fitting visit of the same patient", async () => {
    const { db, dataProvider } = setup();
    const order = db.lab_orders.find((o) => o.status === "lab")!;
    const other = db.visits.find((v) => v.patient_id !== order.patient_id)!;
    await expect(
      dataProvider.update("lab_orders", {
        id: order.id,
        data: { fitting_visit_id: other.id },
        previousData: order,
      }),
    ).rejects.toThrow(/другого пациента/);
  });

  it("allocates payments, reports quality and the act, for the owner only", async () => {
    const { db, dataProvider, loginAs } = setup();
    const today = localDay();
    const quality = await dataProvider.getLabQualityReport({
      from: `${today.slice(0, 4)}-01-01`,
      to: today,
    });
    expect(quality.labs.length).toBe(2);
    expect(quality.totals.orders).toBeGreaterThan(10);
    expect(quality.totals.remakes).toBeGreaterThan(0);
    expect(quality.technicians.every((t) => t.name)).toBe(true);

    const act = await dataProvider.getLabReconciliation({
      lab_id: 1,
      from: "2000-01-01",
      to: today,
    });
    expect(act.opening).toBe(0);
    expect(act.closing).toBe(act.charged - act.paid);
    expect(act.lines.some((l) => l.kind === "payment" && l.orders)).toBe(true);

    const balances = await list<LabOrderBalance>(
      dataProvider,
      "lab_order_balances",
    );
    const due = balances.find(
      (b) => b.lab_id === 1 && b.due > 0 && b.billed_on,
    )!;
    const result = await dataProvider.recordLabPayment({
      lab_id: 1,
      month: `${today.slice(0, 7)}-01`,
      amount: due.due,
      method: "bank_transfer",
      allocations: [{ order_id: due.id, amount: due.due }],
    });
    expect(
      (
        await list<LabPaymentAllocation>(
          dataProvider,
          "lab_payment_allocations",
        )
      ).filter((a) => a.payment_id === result.payment_id),
    ).toHaveLength(1);
    expect(
      (await list<LabOrderBalance>(dataProvider, "lab_order_balances")).find(
        (b) => b.id === due.id,
      )!.due,
    ).toBe(0);
    // Over the order's cost: refused, the payment not kept
    const before = db.lab_payments.length;
    await expect(
      dataProvider.recordLabPayment({
        lab_id: 1,
        month: `${today.slice(0, 7)}-01`,
        amount: 10_000_000,
        method: "bank_transfer",
        allocations: [{ order_id: due.id, amount: 10_000_000 }],
      }),
    ).rejects.toThrow();
    expect(db.lab_payments.length).toBe(before);

    loginAs("manager");
    expect(await list(dataProvider, "lab_payment_allocations")).toHaveLength(0);
    expect(await list(dataProvider, "lab_order_balances")).toHaveLength(0);
    await expect(
      dataProvider.getLabQualityReport({ from: today, to: today }),
    ).rejects.toThrow();
    // A manager sees the remakes of the orders he sees
    const seen = new Set(
      (await list<LabOrderSummary>(dataProvider, "lab_orders_summary")).map(
        (o) => String(o.id),
      ),
    );
    const remakes = await list<LabOrderRemake>(
      dataProvider,
      "lab_order_remakes",
    );
    expect(remakes.every((r) => seen.has(String(r.order_id)))).toBe(true);
    expect(remakes.length).toBe(
      db.lab_order_remakes.filter((r) => seen.has(String(r.order_id))).length,
    );
    loginAs("integrator");
    expect(await list(dataProvider, "lab_order_remakes")).toHaveLength(0);
    expect(await list(dataProvider, "lab_order_events")).toHaveLength(0);
    expect(
      (await list(dataProvider, "lab_remake_reasons")).length,
    ).toBeGreaterThan(3);
  });
});
