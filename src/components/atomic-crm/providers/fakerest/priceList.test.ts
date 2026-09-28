import { beforeAll, describe, expect, it } from "vitest";

import type {
  PriceHistoryRow,
  PriceListRow,
  ServiceCategory,
} from "../../price-list/types";
import type { Sale, Service } from "../../types";
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
  }) as CrmDataProvider;
  const loginAs = (role: Sale["role"]) => {
    current = db.sales.find((sale) => sale.role === role)!;
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

const byCode = async (dataProvider: CrmDataProvider, code: string) =>
  (await list<PriceListRow>(dataProvider, "price_list")).find(
    (row) => row.code === code,
  )!;

describe("price list of the demo (stage 35)", () => {
  it("has a two-level tree, cost prices and a price history", async () => {
    const { dataProvider } = setup();
    const categories = await list<ServiceCategory>(
      dataProvider,
      "service_categories",
    );
    expect(categories.filter((c) => c.parent_id == null).length).toBe(8);
    expect(categories.filter((c) => c.parent_id != null).length).toBe(17);
    const caries = await byCode(dataProvider, "T-01");
    expect(caries.category).toBe("Терапия / Лечение кариеса");
    expect(caries.unit).toBe("tooth");
    expect(caries.cost_price).toBe(5500);
    expect(caries.in_use).toBe(true);
    const history = await list<PriceHistoryRow>(
      dataProvider,
      "service_price_history",
      { service_id: caries.id },
    );
    expect(history.length).toBeGreaterThan(0);
    expect(history.at(-1)!.new_price).toBe(caries.price);
  });

  it("hides the cost price from managers and refuses their changes", async () => {
    const { dataProvider, loginAs } = setup();
    loginAs("manager");
    const caries = await byCode(dataProvider, "T-01");
    expect(caries.price).toBe(25000);
    expect(caries.cost_price).toBeNull();
    expect(await list(dataProvider, "service_costs")).toEqual([]);
    await expect(
      dataProvider.update("services", {
        id: caries.id,
        data: { price: 1 },
        previousData: caries,
      }),
    ).rejects.toThrow();
    await expect(dataProvider.setServiceCost(caries.id, 1)).rejects.toThrow();
    await expect(
      dataProvider.bulkServices([caries.id], "price_percent", { amount: 10 }),
    ).rejects.toThrow();
  });

  it("keeps the path, creates categories from a path, logs price changes", async () => {
    const { dataProvider } = setup();
    const { data: created } = await dataProvider.create<Service>("services", {
      data: {
        name: "Винир композитный",
        category: " ортопедия /  Виниры   прямые ",
        price: 45000,
        position: 999,
      },
    });
    expect(created.category).toBe("Ортопедия / Виниры прямые");
    const categories = await list<ServiceCategory>(
      dataProvider,
      "service_categories",
    );
    const sub = categories.find((c) => c.id === created.category_id)!;
    expect(sub.name).toBe("Виниры прямые");
    expect(categories.find((c) => c.id === sub.parent_id)!.name).toBe(
      "Ортопедия",
    );
    await dataProvider.update("services", {
      id: created.id,
      data: { price: 48000 },
      previousData: created,
    });
    const history = await list<PriceHistoryRow>(
      dataProvider,
      "service_price_history",
      { service_id: created.id },
    );
    expect(history.map((h) => [h.old_price, h.new_price])).toEqual([
      [null, 45000],
      [45000, 48000],
    ]);
    // Renaming a section rewrites the paths of its services
    const section = categories.find((c) => c.id === sub.parent_id)!;
    await dataProvider.update("service_categories", {
      id: section.id,
      data: { name: "Протезирование" },
      previousData: section,
    });
    expect((await byCode(dataProvider, "O-01")).category).toBe(
      "Протезирование / Коронки",
    );
  });

  it("changes prices in bulk rounded to 100 ₸; deletes unused, archives used", async () => {
    const { dataProvider } = setup();
    const caries = await byCode(dataProvider, "T-01");
    const { data: unused } = await dataProvider.create<Service>("services", {
      data: { name: "Пробная", price: 33333, position: 999 },
    });
    const result = await dataProvider.bulkServices(
      [caries.id, unused.id],
      "price_percent",
      { amount: 10 },
    );
    expect(result.updated).toBe(2);
    expect((await byCode(dataProvider, "T-01")).price).toBe(27500);
    const rows = await list<PriceListRow>(dataProvider, "price_list");
    expect(rows.find((r) => r.id === unused.id)!.price).toBe(36700);
    expect(
      await dataProvider.bulkServices([caries.id, unused.id], "delete"),
    ).toEqual({ updated: 0, deleted: 1, archived: 1 });
    const after = await list<PriceListRow>(dataProvider, "price_list");
    expect(after.some((r) => r.id === unused.id)).toBe(false);
    expect(after.find((r) => r.id === caries.id)!.is_archived).toBe(true);
  });

  it("moves the services of a deleted subsection to its section", async () => {
    const { dataProvider } = setup();
    const categories = await list<ServiceCategory>(
      dataProvider,
      "service_categories",
    );
    const caries = categories.find((c) => c.name === "Лечение кариеса")!;
    await dataProvider.delete("service_categories", {
      id: caries.id,
      previousData: caries,
    });
    const service = await byCode(dataProvider, "T-01");
    expect(service.category).toBe("Терапия");
    expect(service.category_id).toBe(caries.parent_id);
    await expect(
      dataProvider.create("service_categories", {
        data: { name: "терапия", parent_id: null, position: 9 },
      }),
    ).rejects.toThrow();
  });
});
