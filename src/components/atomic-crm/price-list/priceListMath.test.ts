import { describe, expect, it } from "vitest";

import { parsePriceRows, planPriceImport } from "../treatment/priceList";
import { priceListExportCsv, priceListTemplateCsv } from "./priceListFile";
import {
  buildCategoryTree,
  bulkPrice,
  categoryNameTaken,
  categoryPath,
  cleanCategoryName,
  filterPriceRows,
  flattenTree,
  marginPercent,
  parseChange,
  sortPriceRows,
  validBulkChange,
} from "./priceListMath";
import {
  isPriceListEmpty,
  STARTER_PRICE_LIST,
  starterServices,
} from "./starterPriceList";
import type { PriceListRow, ServiceCategory } from "./types";

const categories: ServiceCategory[] = [
  { id: 1, parent_id: null, name: "Терапия", position: 0 },
  { id: 2, parent_id: 1, name: "Лечение кариеса", position: 1 },
  { id: 3, parent_id: 1, name: "Эндодонтия", position: 0 },
  { id: 4, parent_id: null, name: "Хирургия", position: 1 },
];

const row = (id: number, patch: Partial<PriceListRow> = {}): PriceListRow => ({
  id,
  name: `Услуга ${id}`,
  position: id,
  is_archived: false,
  price: null,
  category_id: null,
  ...patch,
});

describe("bulk price change (as public.bulk_services)", () => {
  it("rounds to 100 ₸, half up, like the SQL test", () => {
    expect(bulkPrice(27000, "price_percent", 10)).toBe(29700);
    expect(bulkPrice(33333, "price_percent", 10)).toBe(36700);
    expect(bulkPrice(45050, "price_percent", 10)).toBe(49600);
    expect(bulkPrice(29700, "price_percent", -7.5)).toBe(27500);
    expect(bulkPrice(49600, "price_percent", -7.5)).toBe(45900);
    expect(bulkPrice(27500, "price_amount", 1249)).toBe(28700);
    expect(bulkPrice(10000, "price_amount", 1249)).toBe(11200);
    expect(bulkPrice(12350, "price_amount", 0)).toBe(12400);
  });
  it("never goes below 0", () => {
    expect(bulkPrice(10000, "price_amount", -50000)).toBe(0);
    expect(bulkPrice(10000, "price_percent", -99.9)).toBe(0);
  });
  it("accepts what the database accepts", () => {
    expect(validBulkChange("price_percent", 10)).toBe(true);
    expect(validBulkChange("price_percent", -100)).toBe(false);
    expect(validBulkChange("price_percent", 1001)).toBe(false);
    expect(validBulkChange("price_amount", -5000)).toBe(true);
    expect(validBulkChange("price_amount", null)).toBe(false);
    expect(validBulkChange("price_amount", 0)).toBe(false);
  });
  it("reads «+10», «−7,5 %», «-5000 ₸»", () => {
    expect(parseChange("+10")).toBe(10);
    expect(parseChange("−7,5 %")).toBe(-7.5);
    expect(parseChange("-5 000 ₸")).toBe(-5000);
    expect(parseChange("десять")).toBeNull();
    expect(parseChange("")).toBeNull();
  });
  it("gives the margin of a price over its cost", () => {
    expect(marginPercent(25000, 5500)).toBe(78);
    expect(marginPercent(25000, null)).toBeNull();
    expect(marginPercent(null, 100)).toBeNull();
  });
});

describe("category tree", () => {
  const rows = [
    row(1, { category_id: 2 }),
    row(2, { category_id: 2 }),
    row(3, { category_id: 3 }),
    row(4, { category_id: 1 }),
    row(5, { category_id: 4 }),
    row(6),
  ];
  it("orders sections and subsections by position and counts services", () => {
    const tree = buildCategoryTree(categories, rows);
    expect(tree.map((node) => [node.name, node.own, node.total])).toEqual([
      ["Терапия", 1, 4],
      ["Хирургия", 1, 1],
    ]);
    expect(tree[0].children.map((node) => [node.name, node.total])).toEqual([
      ["Эндодонтия", 1],
      ["Лечение кариеса", 2],
    ]);
    expect(flattenTree(tree).map((node) => node.id)).toEqual([1, 3, 2, 4]);
  });
  it("gives the path «Раздел / Подраздел»", () => {
    expect(categoryPath(categories, 2)).toBe("Терапия / Лечение кариеса");
    expect(categoryPath(categories, 4)).toBe("Хирургия");
    expect(categoryPath(categories, 99)).toBeNull();
  });
  it("cleans a name and finds a taken one among the siblings", () => {
    expect(cleanCategoryName("  Ортопедия/Протезы ")).toBe("Ортопедия Протезы");
    expect(categoryNameTaken(categories, null, " терапия ")).toBe(true);
    expect(categoryNameTaken(categories, 4, "Лечение кариеса")).toBe(false);
    expect(categoryNameTaken(categories, 1, "эндодонтия", 3)).toBe(false);
  });
  it("filters a section with its subsections, the rest, search and status", () => {
    const base = { query: "", status: "active" as const, noPrice: false };
    const ids = (list: PriceListRow[]) => list.map((r) => r.id);
    expect(
      ids(filterPriceRows(rows, categories, { ...base, category: 1 })),
    ).toEqual([1, 2, 3, 4]);
    expect(
      ids(filterPriceRows(rows, categories, { ...base, category: "none" })),
    ).toEqual([6]);
    const found = filterPriceRows(
      [...rows, row(7, { code: "TH-04", name: "Кариес", price: 100 })],
      categories,
      { ...base, category: "all", query: "th-0" },
    );
    expect(ids(found)).toEqual([7]);
    expect(
      ids(
        filterPriceRows(
          [row(8, { is_archived: true }), row(9, { price: 5 })],
          categories,
          { ...base, category: "all", status: "archived" },
        ),
      ),
    ).toEqual([8]);
    expect(
      ids(
        filterPriceRows([row(8), row(9, { price: 5 })], categories, {
          ...base,
          category: "all",
          noPrice: true,
        }),
      ),
    ).toEqual([8]);
  });
  it("sorts in the tree order by default, else by a column, nulls last", () => {
    const sorted = sortPriceRows(rows, categories, {
      field: "position",
      order: "ASC",
    });
    expect(sorted.map((r) => r.id)).toEqual([4, 3, 1, 2, 5, 6]);
    const byPrice = sortPriceRows(
      [row(1, { price: 300 }), row(2), row(3, { price: 100 })],
      categories,
      { field: "price", order: "DESC" },
    );
    expect(byPrice.map((r) => r.id)).toEqual([1, 3, 2]);
  });
});

describe("price list file", () => {
  it("exports the active services with every column, read back by the import", () => {
    const rows = [
      row(1, {
        code: "TH-04",
        name: "Кариес поверхностный",
        category_id: 2,
        category: "Терапия / Лечение кариеса",
        price: 25000,
        unit: "tooth",
        duration_minutes: 45,
        specialty: "Терапевт",
        materials_note: "Filtek",
        cost_price: 6000,
      }),
      row(2, { name: "Архивная", is_archived: true }),
    ];
    const csv = priceListExportCsv(rows, categories, { withCost: true });
    expect(csv).toContain("Себестоимость");
    expect(csv).not.toContain("Архивная");
    const lines = csv
      .replace("﻿", "")
      .trim()
      .split("\r\n")
      .map((line) => line.split(";"));
    const { items } = parsePriceRows(lines);
    expect(items).toEqual([
      expect.objectContaining({
        code: "TH-04",
        name: "Кариес поверхностный",
        category: "Терапия / Лечение кариеса",
        price: 25000,
        unit: "tooth",
        duration_minutes: 45,
        specialty: "Терапевт",
        materials_note: "Filtek",
        cost_price: 6000,
      }),
    ]);
    expect(
      priceListExportCsv(rows, categories, { withCost: false }),
    ).not.toContain("Себестоимость");
  });
  it("gives a template the import reads", () => {
    const lines = priceListTemplateCsv()
      .replace("﻿", "")
      .trim()
      .split("\r\n")
      .map((line) => line.split(";"));
    const { items, errors } = parsePriceRows(lines);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(2);
    const plan = planPriceImport([], items);
    expect(plan.create).toHaveLength(2);
    expect(plan.costs).toEqual([{ create: 0, cost: 6000 }]);
  });
});

describe("starter price list", () => {
  it("has about eighty priced services with unique codes, two levels", () => {
    expect(STARTER_PRICE_LIST.length).toBeGreaterThanOrEqual(75);
    const codes = STARTER_PRICE_LIST.map(([code]) => code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const [, name, path, price, , minutes] of STARTER_PRICE_LIST) {
      expect(name.length).toBeGreaterThan(3);
      expect(path.split(" / ").length).toBeLessThanOrEqual(2);
      expect(price % 500).toBe(0);
      expect(price).toBeGreaterThan(0);
      if (minutes != null) {
        expect(minutes).toBeGreaterThanOrEqual(5);
        expect(minutes).toBeLessThanOrEqual(720);
      }
    }
  });
  it("is for a clinic without a price list", () => {
    expect(isPriceListEmpty([], [row(1, { name: "Имплантация" })])).toBe(true);
    expect(isPriceListEmpty([], [row(1, { code: "A-1" })])).toBe(false);
    expect(isPriceListEmpty(categories, [])).toBe(false);
  });
  it("adds after the existing services, skipping their names and codes", () => {
    const created = starterServices([
      row(7, { name: "консультация  стоматолога" }),
      row(8, { name: "Моя услуга", code: "DG-02" }),
    ]);
    expect(created).toHaveLength(STARTER_PRICE_LIST.length - 2);
    expect(created[0]).toMatchObject({
      code: "DG-03",
      category: "Диагностика / Консультации",
      unit: "visit",
      position: 9,
    });
  });
});
