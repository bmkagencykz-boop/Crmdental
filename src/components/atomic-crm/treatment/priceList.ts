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

/**
 * Columns of a price list file. The price list page (stage 35) adds the
 * unit, the duration, the direction, the materials and the cost price.
 */
export type PriceColumn =
  | "code"
  | "name"
  | "category"
  | "price"
  | "unit"
  | "duration"
  | "specialty"
  | "materials"
  | "cost";

const HEADER_PATTERNS: Record<PriceColumn, RegExp> = {
  code: /^(код|артикул|code|sku|№\s*услуги)/i,
  name: /(наименование|название|услуга|name|service)/i,
  category: /(категория|раздел|группа|category|section)/i,
  price: /(цена|стоимость|сумма|тариф|price|cost)/i,
  unit: /^(ед\.?|единиц|unit)/i,
  duration: /(длительн|минут|duration)/i,
  specialty: /(направлени|специальн|specialty|direction)/i,
  materials: /(материал|material)/i,
  cost: /(себестоим|cost price|^cost$)/i,
};
/** The order headers are tried in: «Себестоимость» before «Стоимость» */
const COLUMN_ORDER: PriceColumn[] = [
  "code",
  "cost",
  "category",
  "unit",
  "duration",
  "specialty",
  "materials",
  "price",
  "name",
];

/** Units of a service (stage 35) and the words that mean them in a file */
export const SERVICE_UNITS = ["tooth", "jaw", "visit", "service"] as const;
export type ServiceUnit = (typeof SERVICE_UNITS)[number];
const UNIT_PATTERNS: [ServiceUnit, RegExp][] = [
  ["tooth", /^(зуб|tooth|канал)/i],
  ["jaw", /^(челюст|jaw|сегмент)/i],
  ["visit", /^(посещ|визит|при[её]м|сеанс|visit)/i],
  ["service", /^(услуг|шт|ед|service|item)/i],
];
export const parseUnit = (value: string | null | undefined) => {
  const text = (value ?? "").trim();
  if (!text) return null;
  return UNIT_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
};
/** «60», «60 мин», «1,5 ч» → minutes (5..720), else null */
export const parseDuration = (value: string | null | undefined) => {
  const text = (value ?? "").trim().toLowerCase().replace(",", ".");
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(ч|h|час)?/);
  if (!match) return null;
  const minutes = Math.round(Number(match[1]) * (match[2] ? 60 : 1));
  return minutes >= 5 && minutes <= 720 ? minutes : null;
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
    for (const column of COLUMN_ORDER) {
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
  /** A category or a path «Раздел / Подраздел» (stage 35) */
  category: string | null;
  price: number | null;
  /** Only when the file has the column (stage 35) */
  unit?: ServiceUnit | null;
  duration_minutes?: number | null;
  specialty?: string | null;
  materials_note?: string | null;
  cost_price?: number | null;
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
    const item: PriceRow = {
      line,
      code: at(row, "code") || null,
      name,
      category: normalizeCategory(at(row, "category")),
      price,
    };
    if (columns.unit != null) item.unit = parseUnit(at(row, "unit"));
    if (columns.duration != null) {
      item.duration_minutes = parseDuration(at(row, "duration"));
    }
    if (columns.specialty != null) {
      item.specialty = at(row, "specialty").replace(/\s+/g, " ") || null;
    }
    if (columns.materials != null) {
      item.materials_note = at(row, "materials") || null;
    }
    if (columns.cost != null) {
      const cost = parseAmount(row[columns.cost] ?? null);
      item.cost_price = cost == null || Number.isNaN(cost) ? null : cost;
    }
    items.push(item);
  });
  return { items, errors };
};

/**
 * «имплантация» → «Имплантация» (a suggested category), else as typed. A
 * path «терапия > Лечение кариеса» becomes «Терапия / Лечение кариеса»
 * (two levels, stage 35).
 */
export const normalizeCategory = (value: string | null | undefined) => {
  const parts = (value ?? "")
    .split(/[/>→]/)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return null;
  return parts
    .map(
      (text) =>
        PRICE_CATEGORIES.find(
          (category) => category.toLowerCase() === text.toLowerCase(),
        ) ?? text,
    )
    .join(" / ");
};

const key = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Fields of the stage-35 columns, copied when the file has them */
const EXTRA_FIELDS = [
  "unit",
  "duration_minutes",
  "specialty",
  "materials_note",
] as const;
type ExtraField = (typeof EXTRA_FIELDS)[number];

export type PriceImportPlan = {
  create: Array<
    Pick<Service, "name" | "price" | "position"> & {
      code: string | null;
      category: string | null;
    } & Partial<Pick<Service, ExtraField>>
  >;
  update: Array<{
    id: Identifier;
    previous: Service;
    data: Partial<
      Pick<Service, "price" | "code" | "category" | "is_archived" | ExtraField>
    >;
  }>;
  unchanged: number;
  /**
   * Cost prices of the file (stage 35): of an existing service (`id`) or of
   * the n-th created one (`create`)
   */
  costs: Array<{ id?: Identifier; create?: number; cost: number }>;
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
    unique.set(
      row.code ? `code:${key(row.code)}` : `name:${key(row.name)}`,
      row,
    );
  }
  const plan: PriceImportPlan = {
    create: [],
    update: [],
    unchanged: 0,
    costs: [],
  };
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
      if (row.code && row.code !== (existing.code ?? null))
        data.code = row.code;
      if (row.category && row.category !== (existing.category ?? null)) {
        data.category = row.category;
      }
      if (existing.is_archived) data.is_archived = false;
      for (const field of EXTRA_FIELDS) {
        const value = row[field];
        if (value != null && value !== (existing[field] ?? null)) {
          (data as Record<string, unknown>)[field] = value;
        }
      }
      if (row.cost_price != null) {
        plan.costs.push({ id: existing.id, cost: row.cost_price });
      }
      if (Object.keys(data).length) {
        plan.update.push({ id: existing.id, previous: existing, data });
      } else {
        plan.unchanged++;
      }
    } else if (!existing) {
      const created: PriceImportPlan["create"][number] = {
        name: row.name,
        code: row.code,
        category: row.category,
        price: row.price,
        position: position++,
      };
      for (const field of EXTRA_FIELDS) {
        if (row[field] != null) {
          (created as Record<string, unknown>)[field] = row[field];
        }
      }
      if (row.cost_price != null) {
        plan.costs.push({ create: plan.create.length, cost: row.cost_price });
      }
      plan.create.push(created);
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
