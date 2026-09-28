import { describe, expect, it } from "vitest";

import {
  catalogBadge,
  countByFilter,
  filterCatalog,
  matchesQuery,
  monogramText,
  type CatalogItem,
} from "./catalogModel";

const item = (
  id: string,
  category: CatalogItem["category"],
  status: CatalogItem["status"] = "available",
  extra: Partial<CatalogItem> = {},
): CatalogItem => ({
  id,
  name: id,
  vendor: "DentalCRM",
  category,
  summary: "",
  description: "",
  logo: { text: id.slice(0, 2), tone: "neutral" },
  status,
  kind: "builtin",
  ...extra,
});

const ITEMS = [
  item("Dentist Plus", "mis", "coming", { summary: "Запись и оплаты" }),
  item("Wazzup24", "messengers", "available", {
    summary: "WhatsApp и Instagram в карточке сделки",
    keywords: ["вотсап"],
  }),
  item("Sipuni", "telephony"),
  item("Telegram-бот", "messengers", "beta", { vendor: "Telegram" }),
  item("Ёлка CRM", "apps", "available", { kind: "app" }),
];
const connected = (entry: CatalogItem) => entry.id === "Wazzup24";

describe("catalogBadge", () => {
  it("shows connected first, then the status of the entry", () => {
    expect(catalogBadge("available", true)).toBe("connected");
    expect(catalogBadge("available", false)).toBe("available");
    expect(catalogBadge("beta")).toBe("beta");
    expect(catalogBadge("coming", false)).toBe("coming");
  });
});

describe("filterCatalog", () => {
  it("keeps a category with the connected entries first", () => {
    expect(
      filterCatalog(ITEMS, {
        filter: "messengers",
        isConnected: connected,
      }).map((entry) => entry.id),
    ).toEqual(["Wazzup24", "Telegram-бот"]);
  });

  it("puts what is coming last in «Все»", () => {
    expect(
      filterCatalog(ITEMS, { isConnected: connected }).map((entry) => entry.id),
    ).toEqual([
      "Wazzup24",
      "Sipuni",
      "Telegram-бот",
      "Ёлка CRM",
      "Dentist Plus",
    ]);
  });

  it("shows only what is connected with the «Подключено» chip", () => {
    expect(
      filterCatalog(ITEMS, { filter: "connected", isConnected: connected }),
    ).toHaveLength(1);
  });

  it("searches the name, the vendor, the summary and the keywords", () => {
    const ids = (query: string) =>
      filterCatalog(ITEMS, { query }).map((entry) => entry.id);
    expect(ids("wazz")).toEqual(["Wazzup24"]);
    expect(ids("  ВОТСАП ")).toEqual(["Wazzup24"]);
    expect(ids("telegram")).toEqual(["Telegram-бот"]);
    expect(ids("оплаты")).toEqual(["Dentist Plus"]);
    expect(ids("елка")).toEqual(["Ёлка CRM"]);
    expect(ids("instagram сделки")).toEqual(["Wazzup24"]);
    expect(ids("instagram битрикс")).toEqual([]);
  });

  it("combines the chip and the search", () => {
    expect(
      filterCatalog(ITEMS, { filter: "telephony", query: "wazzup" }),
    ).toEqual([]);
  });
});

describe("countByFilter", () => {
  it("counts the entries of every chip", () => {
    const counts = countByFilter(ITEMS, connected);
    expect(counts.all).toBe(5);
    expect(counts.connected).toBe(1);
    expect(counts.messengers).toBe(2);
    expect(counts.import).toBe(0);
  });
});

describe("matchesQuery / monogramText", () => {
  it("matches an empty query", () => {
    expect(matchesQuery(ITEMS[0], "   ")).toBe(true);
  });

  it("builds a monogram from the name", () => {
    expect(monogramText("Сквозная аналитика")).toBe("СА");
    expect(monogramText("Wazzup24")).toBe("WA");
    expect(monogramText("«Roistat»-like")).toBe("RL");
    expect(monogramText("")).toBe("?");
  });
});
