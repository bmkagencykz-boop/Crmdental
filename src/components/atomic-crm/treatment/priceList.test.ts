import { describe, expect, it } from "vitest";

import type { Service } from "../types";
import {
  guessPriceColumns,
  normalizeCategory,
  parsePriceRows,
  planPriceImport,
  priceListCsv,
  searchServices,
} from "./priceList";

const service = (id: number, patch: Partial<Service> = {}): Service => ({
  id,
  name: `Услуга ${id}`,
  position: id,
  is_archived: false,
  price: null,
  ...patch,
});

describe("price list import mapping", () => {
  it("recognizes the columns by their headers", () => {
    expect(
      guessPriceColumns(["Раздел", "Код", "Наименование услуги", "Цена, ₸"]),
    ).toEqual({
      columns: { category: 0, code: 1, name: 2, price: 3 },
      hasHeader: true,
    });
    expect(guessPriceColumns(["Консультация", 5000])).toEqual({
      columns: { name: 0, price: 1 },
      hasHeader: false,
    });
  });

  it("reads names, codes, categories and prices of an xlsx or csv sheet", () => {
    const { items, errors } = parsePriceRows([
      ["Код", "Наименование", "Категория", "Стоимость"],
      ["T-01", "Лечение кариеса  (поверхностный)", "терапия", "25 000 ₸"],
      [null, "Имплант Osstem", "Имплантация", 180000],
      ["", "Консультация", "", ""],
      ["X", "", "", "1000"],
      ["", "Отбеливание", "Эстетика", "дорого"],
      ["", "", "", ""],
    ]);
    expect(items).toEqual([
      {
        line: 2,
        code: "T-01",
        name: "Лечение кариеса (поверхностный)",
        category: "Терапия",
        price: 25000,
      },
      {
        line: 3,
        code: null,
        name: "Имплант Osstem",
        category: "Имплантация",
        price: 180000,
      },
      { line: 4, code: null, name: "Консультация", category: null, price: null },
    ]);
    expect(errors).toEqual([
      { line: 5, name: "", error: "no_name" },
      { line: 6, name: "Отбеливание", error: "bad_price" },
    ]);
  });

  it("keeps a clinic's own category as typed", () => {
    expect(normalizeCategory(" эстетика ")).toBe("эстетика");
    expect(normalizeCategory("ДЕТСКАЯ")).toBe("Детская");
    expect(normalizeCategory("")).toBeNull();
  });

  it("updates services found by code or name and adds the others", () => {
    const services = [
      service(1, { name: "Консультация", price: 3000 }),
      service(2, { name: "Имплант Osstem", code: "IMP-1", price: 180000 }),
      service(3, { name: "Гигиена", is_archived: true, price: 25000 }),
    ];
    const plan = planPriceImport(services, [
      { line: 2, code: null, name: "консультация ", category: null, price: 5000 },
      { line: 3, code: "IMP-1", name: "Имплант", category: "Имплантация", price: 180000 },
      { line: 4, code: null, name: "Гигиена", category: null, price: 25000 },
      { line: 5, code: null, name: "Виниры", category: "Ортопедия", price: 90000 },
      { line: 6, code: null, name: "виниры", category: "Ортопедия", price: 95000 },
    ]);
    expect(plan.update.map(({ id, data }) => ({ id, data }))).toEqual([
      { id: 1, data: { price: 5000 } },
      { id: 2, data: { category: "Имплантация" } },
      { id: 3, data: { is_archived: false } },
    ]);
    expect(plan.create).toEqual([
      {
        name: "виниры",
        code: null,
        category: "Ортопедия",
        price: 95000,
        position: 4,
      },
    ]);
    expect(plan.unchanged).toBe(0);
  });

  it("exports the active price list as CSV that the import reads back", () => {
    const csv = priceListCsv([
      service(1, { name: "Консультация", price: 5000, category: "Диагностика" }),
      service(2, { name: "Старое", is_archived: true }),
    ]);
    expect(csv).toContain("Код;Наименование;Категория;Цена");
    expect(csv).toContain(";Консультация;Диагностика;5000");
    expect(csv).not.toContain("Старое");
  });
});

describe("searchServices", () => {
  it("finds by name or code, name prefixes first, archived hidden", () => {
    const services = [
      service(1, { name: "Удаление зуба простое", code: "S-01" }),
      service(2, { name: "Лечение кариеса", code: "T-01" }),
      service(3, { name: "Удаление импланта", is_archived: true }),
      service(4, { name: "Сложное удаление зуба" }),
    ];
    expect(searchServices(services, "удал").map((s) => s.id)).toEqual([1, 4]);
    expect(searchServices(services, "t-01").map((s) => s.id)).toEqual([2]);
  });
});
