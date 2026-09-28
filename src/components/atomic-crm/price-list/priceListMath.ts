import type { Identifier } from "ra-core";

import type { PriceListRow, ServiceCategory } from "./types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

// --- prices ----------------------------------------------------------------

/** Round-half-up of a non-negative bigint division */
const divRound = (n: bigint, d: bigint) =>
  n <= 0n ? 0n : (2n * n + d) / (2n * d);

/**
 * The price after a bulk change, as public.bulk_services: by a percentage
 * (price × (100 + amount) / 100) or by an amount (price + amount), rounded
 * to 100 ₸ (half up) and never below 0. Exact: kopecks as bigints.
 */
export const bulkPrice = (
  price: number,
  mode: "price_percent" | "price_amount",
  amount: number,
): number => {
  const cents = BigInt(Math.round(price * 100));
  const change = BigInt(Math.round(amount * 100));
  const hundreds =
    mode === "price_percent"
      ? // cents × (10000 + change) / 10000 = new cents; / 10000 = hundreds of ₸
        divRound(cents * (10000n + change), 100_000_000n)
      : divRound(cents + change, 10_000n);
  return Number(hundreds) * 100;
};

/** Whether public.bulk_services accepts the change */
export const validBulkChange = (
  mode: "price_percent" | "price_amount",
  amount: number | null,
) =>
  amount != null &&
  Number.isFinite(amount) &&
  amount !== 0 &&
  (mode === "price_amount" || (amount > -100 && amount <= 1000));

/** «+10», «-7,5», «−5 %» → a number, else null */
export const parseChange = (raw: string): number | null => {
  const text = raw
    .replace(/[\s%₸]/g, "")
    .replace("−", "-")
    .replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
};

/** Margin of a price over its cost price, in % of the price */
export const marginPercent = (
  price: number | null | undefined,
  cost: number | null | undefined,
) =>
  price && cost != null ? Math.round(((price - cost) / price) * 100) : null;

// --- categories --------------------------------------------------------------

export type CategoryNode = ServiceCategory & {
  children: CategoryNode[];
  /** Services directly in the category */
  own: number;
  /** Services of the category and of its subsections */
  total: number;
};

const byPosition = (a: ServiceCategory, b: ServiceCategory) =>
  a.position - b.position ||
  a.name.localeCompare(b.name, "ru") ||
  String(a.id).localeCompare(String(b.id));

/**
 * The two-level tree of the price list with the number of services of each
 * category (a section counts the services of its subsections too).
 */
export const buildCategoryTree = (
  categories: ServiceCategory[],
  rows: Pick<PriceListRow, "category_id">[],
): CategoryNode[] => {
  const own = new Map<string, number>();
  for (const row of rows) {
    if (row.category_id == null) continue;
    const key = String(row.category_id);
    own.set(key, (own.get(key) ?? 0) + 1);
  }
  const node = (category: ServiceCategory): CategoryNode => {
    const children = categories
      .filter((child) => same(child.parent_id, category.id))
      .sort(byPosition)
      .map(node);
    const count = own.get(String(category.id)) ?? 0;
    return {
      ...category,
      children,
      own: count,
      total: count + children.reduce((sum, child) => sum + child.total, 0),
    };
  };
  const ids = new Set(categories.map((c) => String(c.id)));
  return categories
    .filter((c) => c.parent_id == null || !ids.has(String(c.parent_id)))
    .sort(byPosition)
    .map(node);
};

/** The tree in display order: section, its subsections, next section… */
export const flattenTree = (tree: CategoryNode[]): CategoryNode[] =>
  tree.flatMap((node) => [node, ...node.children]);

/** «Терапия / Лечение кариеса», as private.service_category_path */
export const categoryPath = (
  categories: ServiceCategory[],
  id: Identifier | null | undefined,
) => {
  const category = categories.find((c) => same(c.id, id));
  if (!category) return null;
  const parent = categories.find((c) => same(c.id, category.parent_id));
  return parent ? `${parent.name} / ${category.name}` : category.name;
};

/** The category and its subsections */
export const categoryWithChildren = (
  categories: ServiceCategory[],
  id: Identifier,
) => [
  String(id),
  ...categories.filter((c) => same(c.parent_id, id)).map((c) => String(c.id)),
];

/** A name the database accepts: trimmed, no «/», ≤ 100 characters */
export const cleanCategoryName = (raw: string) =>
  raw.replace(/\//g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/** Whether a sibling already has this name (case and spaces ignored) */
export const categoryNameTaken = (
  categories: ServiceCategory[],
  parentId: Identifier | null,
  name: string,
  exceptId?: Identifier,
) =>
  categories.some(
    (c) =>
      (parentId == null ? c.parent_id == null : same(c.parent_id, parentId)) &&
      !same(c.id, exceptId) &&
      c.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

// --- the table ---------------------------------------------------------------

/** Which services the table shows: a category, all, or those without one */
export type CategoryFilter = "all" | "none" | Identifier;
export type StatusFilter = "active" | "archived" | "all";
export type PriceSortField =
  | "position"
  | "code"
  | "name"
  | "price"
  | "duration_minutes"
  | "cost_price";
export type PriceSort = { field: PriceSortField; order: "ASC" | "DESC" };

export type PriceFilters = {
  category: CategoryFilter;
  query: string;
  status: StatusFilter;
  noPrice: boolean;
};

const key = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Rows by status only: the counts of the tree follow this */
export const rowsByStatus = <T extends Pick<PriceListRow, "is_archived">>(
  rows: T[],
  status: StatusFilter,
) =>
  rows.filter((row) =>
    status === "all"
      ? true
      : status === "archived"
        ? row.is_archived
        : !row.is_archived,
  );

export const filterPriceRows = <T extends PriceListRow>(
  rows: T[],
  categories: ServiceCategory[],
  filters: PriceFilters,
): T[] => {
  const needle = key(filters.query);
  const inCategory =
    filters.category === "all" || filters.category === "none"
      ? null
      : new Set(categoryWithChildren(categories, filters.category));
  return rowsByStatus(rows, filters.status).filter(
    (row) =>
      (filters.category === "all" ||
        (filters.category === "none"
          ? row.category_id == null
          : inCategory!.has(String(row.category_id)))) &&
      (!filters.noPrice || row.price == null) &&
      (!needle ||
        key(row.name).includes(needle) ||
        key(row.code).includes(needle)),
  );
};

const compareCodes = (
  a: string | null | undefined,
  b: string | null | undefined,
) =>
  !a ? (!b ? 0 : 1) : !b ? -1 : a.localeCompare(b, "ru", { numeric: true });

/** Nulls last whatever the order */
const compareNumbers = (
  a: number | null | undefined,
  b: number | null | undefined,
  direction: 1 | -1,
) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * direction);

/**
 * The order of the table: by default the order of the tree (sections,
 * subsections, then the position of the service), else by a column.
 */
export const sortPriceRows = <T extends PriceListRow>(
  rows: T[],
  categories: ServiceCategory[],
  sort: PriceSort,
): T[] => {
  const order = new Map(
    flattenTree(buildCategoryTree(categories, [])).map((node, index) => [
      String(node.id),
      index,
    ]),
  );
  const treeIndex = (row: T) =>
    row.category_id == null
      ? Number.MAX_SAFE_INTEGER
      : (order.get(String(row.category_id)) ?? Number.MAX_SAFE_INTEGER - 1);
  const direction = sort.order === "ASC" ? 1 : -1;
  const byTree = (a: T, b: T) =>
    treeIndex(a) - treeIndex(b) ||
    a.position - b.position ||
    String(a.id).localeCompare(String(b.id), "en", { numeric: true });
  return [...rows].sort((a, b) => {
    switch (sort.field) {
      case "code":
        return compareCodes(a.code, b.code) * direction || byTree(a, b);
      case "name":
        return a.name.localeCompare(b.name, "ru") * direction || byTree(a, b);
      case "price":
      case "duration_minutes":
      case "cost_price":
        return (
          compareNumbers(a[sort.field], b[sort.field], direction) ||
          byTree(a, b)
        );
      default:
        return byTree(a, b) * direction;
    }
  });
};

/** Position of a new service: the end of its category */
export const nextPosition = (rows: Pick<PriceListRow, "position">[]) =>
  rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
