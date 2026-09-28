import type { Identifier } from "ra-core";

import {
  cellText,
  parseAmount,
  toCsv,
  type Cell,
} from "../import/importMapping";
import type { Service } from "../types";

/** Categories suggested in the price list (free text: a clinic adds its own) */
export const PRICE_CATEGORIES = [
  "Терапия",
  "Хирургия",
  "Имплантация",
  "Ортопедия",
  "Ортодонтия",
  "Гигиена",
  "Детская",
  "Диагностика",
] as const;

/** Columns of a price list file */
export type PriceColumn = "code" | "name" | "category" | "price";

const HEADER_PATTERNS: Record<PriceColumn, RegExp> = {
  code: /^(код|артикул|code|sku|№\s*услуги)/i,
  name: /(наименование|название|услуга|name|service)/i,
  category: /(категория|раздел|группа|category|section)/i,
  price: /(цена|стоимость|сумма|тариф|price|cost)/i,
};

/**
 * Which column holds what, by the header row: «Код», «Наименование услуги»,
 * «Категория», «Цена, ₸»… Without a recognizable header: name, price in the
 * first two columns and no header row.
 */
export const guessPriceColumns = (
  header: Cell[],
): { columns: Partial<Record<PriceColumn, number>>; hasHeader: boolean } => {
  const columns: Partial<Record<PriceColumn, number>> = {};
  header.forEach((cell, index) => {
    const text = cellText(cell);
    if (!text) return;
    for (const column of ["code", "category", "price", "name"] as const) {
      if (columns[column] == null && HEADER_PATTERNS[column].test(text)) {
        columns[column] = index;
        return;
      }
    }
  });
  if (columns.name != null) return { columns, hasHeader: true };
  return { columns: { name: 0, price: 1 }, hasHeader: false };
};

export type PriceRow = {
  /** Row number in the file (1-based, header included) */
  line: number;
  code: string | null;
  name: string;
  category: string | null;
  price: number | null;
};

export type PriceRowError = { line: number; name: string; error: string };

/** The rows of a price list file: rows[0] may be the header */
export const parsePriceRows = (
  rows: Cell[][],
): { items: PriceRow[]; errors: PriceRowError[] } => {
  if (!rows.length) return { items: [], errors: [] };
  const { columns, hasHeader } = guessPriceColumns(rows[0]);
  const items: PriceRow[] = [];
  const errors: PriceRowError[] = [];
  const at = (row: Cell[], column: PriceColumn) =>
    columns[column] == null ? "" : cellText(row[columns[column]!]);
  rows.slice(hasHeader ? 1 : 0).forEach((row, index) => {
    const line = index + (hasHeader ? 2 : 1);
    const name = at(row, "name").replace(/\s+/g, " ");
    if (!name) {
      if (row.some((cell) => cellText(cell))) {
        errors.push({ line, name: "", error: "no_name" });
      }
      return;
    }
    const price =
      columns.price == null ? null : parseAmount(row[columns.price] ?? null);
    if (price != null && Number.isNaN(price)) {
      errors.push({ line, name, error: "bad_price" });
      return;
    }
    items.push({
      line,
      code: at(row, "code") || null,
      name,
      category: normalizeCategory(at(row, "category")),
      price,
    });
  });
  return { items, errors };
};

/** «имплантация» → «Имплантация» (a suggested category), else as typed */
export const normalizeCategory = (value: string | null | undefined) => {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return (
    PRICE_CATEGORIES.find(
      (category) => category.toLowerCase() === text.toLowerCase(),
    ) ?? text
  );
};

const key = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export type PriceImportPlan = {
  create: Array<Pick<Service, "name" | "price" | "position"> & {
    code: string | null;
    category: string | null;
  }>;
  update: Array<{
    id: Identifier;
    previous: Service;
    data: Partial<Pick<Service, "price" | "code" | "category" | "is_archived">>;
  }>;
  unchanged: number;
};

/**
 * What an import does to the price list: a row finds its service by code,
 * else by name (case and spaces ignored) and updates its price, code and
 * category; an archived service comes back. Other rows become new services
 * at the end. A duplicate row of the file counts once (the last one wins).
 */
export const planPriceImport = (
  services: Service[],
  rows: PriceRow[],
): PriceImportPlan => {
  const byCode = new Map<string, Service>();
  const byName = new Map<string, Service>();
  for (const service of services) {
    if (service.code) byCode.set(key(service.code), service);
    byName.set(key(service.name), service);
  }
  const unique = new Map<string, PriceRow>();
  for (const row of rows) {
    unique.set(row.code ? `code:${key(row.code)}` : `name:${key(row.name)}`, row);
  }
  const plan: PriceImportPlan = { create: [], update: [], unchanged: 0 };
  let position = Math.max(-1, ...services.map((s) => s.position)) + 1;
  const seen = new Set<Identifier>();
  for (const row of unique.values()) {
    const existing =
      (row.code ? byCode.get(key(row.code)) : undefined) ??
      byName.get(key(row.name));
    if (existing && !seen.has(existing.id)) {
      seen.add(existing.id);
      const data: PriceImportPlan["update"][number]["data"] = {};
      if (row.price != null && row.price !== (existing.price ?? null)) {
        data.price = row.price;
      }
      if (row.code && row.code !== (existing.code ?? null)) data.code = row.code;
      if (row.category && row.category !== (existing.category ?? null)) {
        data.category = row.category;
      }
      if (existing.is_archived) data.is_archived = false;
      if (Object.keys(data).length) {
        plan.update.push({ id: existing.id, previous: existing, data });
      } else {
        plan.unchanged++;
      }
    } else if (!existing) {
      plan.create.push({
        name: row.name,
        code: row.code,
        category: row.category,
        price: row.price,
        position: position++,
      });
    }
  }
  return plan;
};

/** The price list as a CSV file (the import reads it back) */
export const priceListCsv = (services: Service[]) =>
  toCsv([
    ["Код", "Наименование", "Категория", "Цена"],
    ...[...services]
      .filter((service) => !service.is_archived)
      .sort(
        (a, b) =>
          (a.category ?? "").localeCompare(b.category ?? "", "ru") ||
          a.position - b.position,
      )
      .map((service) => [
        service.code ?? "",
        service.name,
        service.category ?? "",
        service.price != null ? String(Math.round(service.price)) : "",
      ]),
  ]);

/** Search of the price list: name or code, active services first */
export const searchServices = (services: Service[], query: string) => {
  const needle = key(query);
  return services
    .filter(
      (service) =>
        !service.is_archived &&
        (!needle ||
          key(service.name).includes(needle) ||
          key(service.code).includes(needle) ||
          key(service.category).startsWith(needle)),
    )
    .sort(
      (a, b) =>
        Number(!key(a.name).startsWith(needle)) -
          Number(!key(b.name).startsWith(needle)) ||
        (a.category ?? "").localeCompare(b.category ?? "", "ru") ||
        a.position - b.position,
    );
};
