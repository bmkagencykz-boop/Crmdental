/**
 * «Маркет интеграций» (stage 25): the data of a catalog entry and the pure
 * logic of the page (filter chips, search, badges). The entries themselves,
 * with their settings components, are in catalog.ts.
 */

/** Categories in the order of the filter chips */
export const CATALOG_CATEGORIES = [
  "messengers",
  "telephony",
  "mis",
  "leads",
  "api",
  "import",
  "apps",
] as const;
export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number];

/** What the catalog offers: ready, in beta, or planned */
export type CatalogStatus = "available" | "beta" | "coming";

/** builtin: a settings screen of the CRM; app: a developer app (stage 25) */
export type CatalogKind = "builtin" | "app";

/** Tone of the monogram tile (theme tokens only) */
export type MonogramTone =
  | "primary"
  | "rose"
  | "blush"
  | "neutral"
  | "outline"
  | "ink";

export type CatalogLogo = {
  /** One to three characters: «WA», «TG», «Б24» */
  text: string;
  tone: MonogramTone;
};

/** The data of an entry, without its React parts */
export type CatalogItem = {
  id: string;
  name: string;
  vendor: string;
  category: CatalogCategory;
  /** One line on the card (Russian) */
  summary: string;
  /** Paragraph of the detail view (Russian) */
  description: string;
  /** «Что умеет»: bullet points of the detail view */
  features?: string[];
  logo: CatalogLogo;
  status: CatalogStatus;
  kind: CatalogKind;
  /** Words the search also matches (English names, synonyms) */
  keywords?: string[];
  /**
   * canAccess resource needed to see the entry (list): e.g. "import", which
   * the integrator has no right to
   */
  resource?: string;
};

/** The badge of a card */
export type CatalogBadge = "connected" | "available" | "beta" | "coming";

export const catalogBadge = (
  status: CatalogStatus,
  connected?: boolean,
): CatalogBadge => (connected ? "connected" : status);

/** Filter chip: a category, everything, or what is connected */
export type CatalogFilter = CatalogCategory | "all" | "connected";

/** Lower case, «ё» as «е», single spaces */
export const normalizeSearch = (value: string) =>
  value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Does the entry match every word of the query? */
export const matchesQuery = (item: CatalogItem, query: string) => {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = normalizeSearch(
    [
      item.name,
      item.vendor,
      item.summary,
      item.description,
      ...(item.keywords ?? []),
    ].join(" "),
  );
  return words.every((word) => haystack.includes(word));
};

const BADGE_ORDER: Record<CatalogBadge, number> = {
  connected: 0,
  available: 1,
  beta: 1,
  coming: 2,
};

/**
 * Entries of a chip and a search: connected ones first, then what can be
 * connected now, then what is coming; the catalog order otherwise.
 */
export const filterCatalog = <T extends CatalogItem>(
  items: T[],
  {
    filter = "all",
    query = "",
    isConnected = () => false,
  }: {
    filter?: CatalogFilter;
    query?: string;
    isConnected?: (item: T) => boolean | undefined;
  },
): T[] =>
  items
    .map((item, index) => ({
      item,
      index,
      badge: catalogBadge(item.status, isConnected(item) ?? false),
    }))
    .filter(
      ({ item, badge }) =>
        (filter === "all" ||
          (filter === "connected"
            ? badge === "connected"
            : item.category === filter)) &&
        matchesQuery(item, query),
    )
    .sort(
      (a, b) =>
        BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] || a.index - b.index,
    )
    .map(({ item }) => item);

/** Number of entries per chip (the chips show it) */
export const countByFilter = <T extends CatalogItem>(
  items: T[],
  isConnected: (item: T) => boolean | undefined = () => false,
): Record<CatalogFilter, number> => {
  const counts = Object.fromEntries(
    ["all", "connected", ...CATALOG_CATEGORIES].map((key) => [key, 0]),
  ) as Record<CatalogFilter, number>;
  for (const item of items) {
    counts.all += 1;
    counts[item.category] += 1;
    if (isConnected(item)) counts.connected += 1;
  }
  return counts;
};

/** «Сквозная аналитика» → «СА», «Wazzup24» → «WA» (monogram of an app) */
export const monogramText = (name: string) => {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};
