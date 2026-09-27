import { beforeAll, describe, expect, it } from "vitest";

import type { CrmNotification, DealWaiting } from "../../types";
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
});

const setup = () =>
  createDataProvider({
    db: generateData(),
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: 0, fullName: "Owner" }) },
  });

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

describe("demo: response-time control", () => {
  it("shows deals waiting for an answer, two of them past the limit", async () => {
    const dataProvider = setup();
    const waiting = await list<DealWaiting>(dataProvider, "deals_waiting");
    const overdue = waiting.filter((row) => row.overdue);
    expect(overdue.length).toBeGreaterThanOrEqual(2);
    expect(overdue.every((row) => row.waiting_minutes >= 15)).toBe(true);
    expect(
      await list<DealWaiting>(dataProvider, "deals_waiting", { overdue: true }),
    ).toHaveLength(overdue.length);
  });

  it("filters the deals waiting for an answer", async () => {
    const dataProvider = setup();
    const overdue = await list<DealWaiting>(dataProvider, "deals_waiting", {
      overdue: true,
    });
    const deals = await list<{ id: number }>(dataProvider, "deals", {
      waiting_response: true,
    });
    expect(deals.map((d) => d.id).sort()).toEqual(
      overdue.map((d) => d.id).sort(),
    );
  });

  it("an answer ends the wait", async () => {
    const dataProvider = setup();
    const [first] = await list<DealWaiting>(dataProvider, "deals_waiting", {
      overdue: true,
    });
    await dataProvider.sendMessage(first.id, "Здравствуйте! Отвечаем.");
    const after = await list<DealWaiting>(dataProvider, "deals_waiting");
    expect(after.some((row) => row.id === first.id)).toBe(false);
  });
});

describe("demo: notifications", () => {
  it("has unread notifications for the demo user, marked read all at once", async () => {
    const dataProvider = setup();
    const unread = await list<CrmNotification>(dataProvider, "notifications", {
      sales_id: 0,
      "read_at@is": null,
    });
    expect(unread.length).toBeGreaterThanOrEqual(2);
    expect(await dataProvider.markAllNotificationsRead()).toBe(unread.length);
    expect(
      await list<CrmNotification>(dataProvider, "notifications", {
        sales_id: 0,
        "read_at@is": null,
      }),
    ).toEqual([]);
  });

  it("keeps the preferences and gives a Telegram link code", async () => {
    const dataProvider = setup();
    const saved = await dataProvider.saveNotificationPreferences({
      kinds: ["patient_message"],
      browser_enabled: true,
      telegram_enabled: false,
    });
    expect(saved).toMatchObject({
      kinds: ["patient_message"],
      browser_enabled: true,
      telegram_enabled: false,
      telegram_linked: false,
    });
    const code = await dataProvider.createTelegramLinkCode();
    expect(code).toMatch(/^[0-9a-f]{16}$/);
    expect(
      (await dataProvider.getNotificationPreferences()).telegram_link_code,
    ).toBe(code);
  });
});
