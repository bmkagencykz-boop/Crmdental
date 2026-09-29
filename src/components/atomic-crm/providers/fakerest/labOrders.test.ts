import { beforeAll, describe, expect, it } from "vitest";

import { labSettlement, localDay, monthStart } from "../../lab/labMath";
import type {
  Lab,
  LabOrder,
  LabOrderCost,
  LabOrderItem,
  LabOrderItemPrice,
  LabOrderSummary,
  LabWorkTypePrice,
} from "../../lab/types";
import type { AuditLogEntry, Patient, Sale } from "../../types";
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

describe("demo lab work orders", { timeout: 30_000 }, () => {
  it("generates two labs, three technicians and orders in every state", () => {
    const { db } = setup();
    expect(db.labs).toHaveLength(2);
    expect(db.labs.filter((lab) => lab.is_own)).toHaveLength(1);
    expect(db.lab_technicians).toHaveLength(3);
    expect(db.lab_orders.length).toBeGreaterThanOrEqual(15);
    const statuses = new Set(db.lab_orders.map((order) => order.status));
    for (const status of [
      "clinic",
      "courier",
      "lab",
      "fitting",
      "ready",
      "delivered",
      "remake",
    ]) {
      expect(statuses.has(status as LabOrder["status"])).toBe(true);
    }
    expect(db.lab_orders.some((order) => order.plan_id != null)).toBe(true);
    expect(db.lab_order_items.length).toBe(db.lab_order_item_prices.length);
    expect(
      db.notifications.some(
        (notification) => notification.kind === "lab_order",
      ),
    ).toBe(true);
    expect(db.patient_files.some((file) => file.lab_order_id != null)).toBe(
      true,
    );
  });

  it("numbers an order, fills the defaults and the dates of its status", async () => {
    const { db, dataProvider, loginAs } = setup();
    const manager = loginAs("manager");
    const patient = (await list<Patient>(dataProvider, "patients"))[0];
    const doctor = db.doctors[0];
    const { data: order } = await dataProvider.create<LabOrder>("lab_orders", {
      data: {
        patient_id: patient.id,
        doctor_id: doctor.id,
        technician_id: 2,
        teeth: [37, 36, 36],
        shade: " A2 ",
        status: "lab",
      },
    });
    expect(order.number).toBe(
      Math.max(
        ...db.lab_orders.filter((o) => o.id !== order.id).map((o) => o.number),
      ) + 1,
    );
    expect(order.lab_id).toBe(1);
    expect(order.teeth).toEqual([36, 37]);
    expect(order.shade).toBe("A2");
    expect(order.sent_at).toBe(localDay());
    expect(order.responsible_id).toBe(doctor.admin_sales_id);
    expect(order.created_by).toBe(manager.id);
    await expect(
      dataProvider.create("lab_orders", {
        data: { patient_id: patient.id, lab_id: 2, technician_id: 1 },
      }),
    ).rejects.toThrow(/другой лаборатории/);

    const { data: line } = await dataProvider.create<LabOrderItem>(
      "lab_order_items",
      { data: { order_id: order.id, work_type_id: 2, qty: 2 } },
    );
    expect(line.name).toBe("Коронка из диоксида циркония");
    const summary = (
      await list<LabOrderSummary>(dataProvider, "lab_orders_summary")
    ).find((o) => o.id === order.id)!;
    expect(summary.works).toBe("Коронка из диоксида циркония × 2");
    expect(summary.lab_cost).toBeNull();

    const { data: remade } = await dataProvider.update<LabOrder>("lab_orders", {
      id: order.id,
      data: { status: "remake" },
      previousData: order,
    });
    expect(remade.remake_count).toBe(1);
    const { data: given } = await dataProvider.update<LabOrder>("lab_orders", {
      id: order.id,
      data: { status: "delivered", number: 999 },
      previousData: remade,
    });
    expect(given.number).toBe(order.number);
    expect(given.ready_at).toBe(localDay());
    expect(given.delivered_at).toBe(localDay());

    const audit = (await list<AuditLogEntry>(dataProvider, "audit_log")).filter(
      (row) => row.entity === "lab_order" && row.entity_id === order.id,
    );
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it("gives the prices and the settlement to the owner and the head only", async () => {
    const { db, dataProvider, loginAs } = setup();
    loginAs("manager");
    expect(await list(dataProvider, "lab_work_type_prices")).toHaveLength(0);
    expect(await list(dataProvider, "lab_order_item_prices")).toHaveLength(0);
    expect(await list(dataProvider, "lab_order_costs")).toHaveLength(0);
    await expect(
      dataProvider.update("lab_work_type_prices", {
        id: 1,
        data: { price: 1 },
        previousData: { id: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.create("labs", { data: { name: "Своя" } }),
    ).rejects.toThrow();

    loginAs("owner");
    const prices = await list<LabWorkTypePrice>(
      dataProvider,
      "lab_work_type_prices",
    );
    expect(prices).toHaveLength(13);
    const costs = await list<LabOrderCost>(dataProvider, "lab_order_costs");
    expect(costs.length).toBe(db.lab_order_items.length);
    const labs = await list<Lab>(dataProvider, "labs");
    const month = monthStart(localDay());
    const settlement = labSettlement(costs, labs, month);
    const expected = db.lab_orders
      .filter((o) => o.ready_at && o.ready_at.slice(0, 7) === month.slice(0, 7))
      .flatMap((o) => db.lab_order_items.filter((i) => i.order_id === o.id))
      .reduce(
        (sum, item) =>
          sum +
          item.qty *
            db.lab_order_item_prices.find((p) => p.item_id === item.id)!.price,
        0,
      );
    expect(settlement.reduce((sum, row) => sum + row.amount, 0)).toBe(expected);

    // A line price adjusted by the owner, in the audit log
    const price = (
      await list<LabOrderItemPrice>(dataProvider, "lab_order_item_prices")
    )[0];
    await dataProvider.update("lab_order_item_prices", {
      id: price.id,
      data: { price: price.price + 1000 },
      previousData: price,
    });
    const audit = await list<AuditLogEntry>(dataProvider, "audit_log");
    expect(audit.some((row) => row.entity === "lab_order_price")).toBe(true);
  });

  it("hides the orders from the integrator and guards the deletion", async () => {
    const { db, dataProvider, loginAs } = setup();
    loginAs("integrator");
    expect(await list(dataProvider, "lab_orders_summary")).toHaveLength(0);
    expect(await list(dataProvider, "lab_orders")).toHaveLength(0);
    // The integrator configures the dictionaries
    await dataProvider.create("lab_work_types", {
      data: { name: "Ночная каппа", position: 20 },
    });

    loginAs("manager");
    const sent = db.lab_orders.find((o) => o.status === "lab")!;
    await expect(
      dataProvider.delete("lab_orders", { id: sent.id, previousData: sent }),
    ).rejects.toThrow();
    loginAs("owner");
    await expect(
      dataProvider.delete("labs", { id: 1, previousData: { id: 1 } }),
    ).rejects.toThrow(/архив/);
    await dataProvider.delete("lab_orders", {
      id: sent.id,
      previousData: sent,
    });
    expect(
      (await list<LabOrderItem>(dataProvider, "lab_order_items")).some(
        (item) => item.order_id === sent.id,
      ),
    ).toBe(false);
  });
});
