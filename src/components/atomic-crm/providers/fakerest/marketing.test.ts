import { beforeAll, describe, expect, it } from "vitest";

import type { AdSpend } from "../../marketing/types";
import type { Deal, LeadSource } from "../../types";
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

/** identity 0 is the owner, 1..5 are managers */
const setup = (identity = 0) => {
  const db = generateData();
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({ id: identity, fullName: "Сотрудник" }),
    },
  }) as CrmDataProvider;
  return { db, dataProvider };
};

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

// Generating the demo clinic takes a few seconds
describe("marketing demo", { timeout: 60_000 }, () => {
  it("has spend, UTM tags and a Google source", async () => {
    const { db, dataProvider } = setup();
    const google = db.lead_sources.find((s) => s.name === "Google");
    expect(google?.utm_sources).toContain("google");
    expect(db.ad_spend.length).toBeGreaterThan(10);
    expect(db.deals.some((d) => d.utm_source === "instagram")).toBe(true);
    expect(db.deals.some((d) => d.source_id === google!.id)).toBe(true);

    const report = await dataProvider.getMarketingReport({});
    const names = report.by_source.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining(["Instagram", "Google", "2GIS", "Сайт"]),
    );
    const instagram = report.by_source.find((r) => r.name === "Instagram")!;
    expect(instagram.spend).toBeGreaterThan(0);
    expect(instagram.cpl).not.toBeNull();
    expect(instagram.campaigns.some((c) => c.campaign === "whitening")).toBe(
      true,
    );
    const referral = report.by_source.find((r) => r.name === "Рекомендация");
    expect(referral?.spend ?? 0).toBe(0);
    expect(report.totals.spend).toBe(
      db.ad_spend.reduce((sum, row) => sum + row.amount, 0),
    );
  });

  it("hides the spend and the report from managers", async () => {
    const { dataProvider } = setup(1);
    expect(await list<AdSpend>(dataProvider, "ad_spend")).toEqual([]);
    await expect(dataProvider.getMarketingReport({})).rejects.toThrow();
    await expect(
      dataProvider.create("ad_spend", {
        data: {
          source_id: 2,
          spent_from: "2026-09-01",
          spent_to: "2026-09-30",
          amount: 1000,
        },
      }),
    ).rejects.toThrow();
  });

  it("lets the owner book spend, trimmed", async () => {
    const { dataProvider } = setup();
    const { data } = await dataProvider.create<AdSpend>("ad_spend", {
      data: {
        source_id: 2,
        campaign: "  ",
        comment: " Таргет ",
        spent_from: "2026-09-01",
        spent_to: "2026-09-30",
        amount: 1000,
      },
    });
    expect(data.campaign).toBeNull();
    expect(data.comment).toBe("Таргет");
    expect(data.sales_id).toBe(0);
  });

  it("maps utm_source to the source of a new deal, trims the tags", async () => {
    const { db, dataProvider } = setup();
    const google = db.lead_sources.find((s) => s.name === "Google")!;
    const { data } = await dataProvider.create<Deal>("deals", {
      data: {
        patient_id: db.patients[0].id,
        utm_source: " AdWords ",
        utm_campaign: " ",
      },
    });
    const deal = (await list<Deal>(dataProvider, "deals")).find(
      (d) => d.id === data.id,
    )!;
    expect(deal.source_id).toBe(google.id);
    expect(deal.utm_source).toBe("AdWords");
    expect(deal.utm_campaign).toBeNull();
  });

  it("normalizes the utm_sources of a lead source", async () => {
    const { dataProvider } = setup();
    const { data } = await dataProvider.update<LeadSource>("lead_sources", {
      id: 1,
      data: { utm_sources: [" WA ", "wa", ""] },
      previousData: { id: 1 } as LeadSource,
    });
    expect(data.utm_sources).toEqual(["wa"]);
  });
});
