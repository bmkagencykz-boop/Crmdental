import { describe, expect, it } from "vitest";

import type { Deal, DealEvent, DealPayment, LeadSource, Stage } from "../types";
import {
  campaignKey,
  conversion,
  marketingReport,
  normalizeAttribution,
  normalizeUtmSources,
  parseUtmSources,
  roundHalfAway,
  spendInPeriod,
  utmLeadSource,
  type MarketingData,
} from "./marketingMath";
import type { AdSpend, MarketingMetrics } from "./types";

/*
 * Same clinic as the report part of supabase/tests/032_marketing.test.sql,
 * with the same expected numbers: the database and the demo compute the
 * marketing report the same way.
 */

const STAGES: Stage[] = [
  ["Новый лид", "open"],
  ["В работе", "open"],
  ["Записан", "open"],
  ["Пришёл на консультацию", "open"],
  ["План согласован", "open"],
  ["В лечении", "open"],
  ["Лечение завершено", "won"],
  ["Отказ", "lost"],
].map(([name, kind], position) => ({
  id: position + 1,
  pipeline_id: 1,
  name,
  position,
  kind: kind as Stage["kind"],
  color: "#000",
}));
const stageId = (name: string) => STAGES.find((s) => s.name === name)!.id;

const SOURCES: LeadSource[] = [
  ["WhatsApp", "whatsapp"],
  ["Instagram", "instagram"],
  ["Telegram", "telegram"],
  ["Звонок", "call"],
  ["Сайт", "website"],
  ["2GIS", "2gis"],
  ["Рекомендация", "referral"],
  ["Другое", "other"],
].map(([name, code], index) => ({
  id: index + 1,
  name,
  code,
  is_system: true,
  position: index,
  is_archived: false,
}));
SOURCES.push({
  id: 9,
  name: "Google",
  code: null,
  is_system: false,
  position: 10,
  is_archived: false,
  utm_sources: ["google", "adwords"],
});
const source = (name: string) => SOURCES.find((s) => s.name === name)!.id;

const buildData = (): MarketingData => {
  const deals: Deal[] = [];
  const events: DealEvent[] = [];
  const addDeal = (
    name: string,
    sourceName: string | null,
    campaign: string | null,
    created: string,
    stage = "Новый лид",
    extra: Partial<Deal> = {},
  ) => {
    const id = deals.length + 1;
    deals.push({
      id,
      patient_id: 1,
      pipeline_id: 1,
      stage_id: stageId(stage),
      name,
      source_id: sourceName ? source(sourceName) : null,
      utm_campaign: campaign,
      plan_amount: 0,
      paid_amount: 0,
      tags: [],
      index: 0,
      created_at: created,
      updated_at: created,
      stage_changed_at: created,
      ...extra,
    });
    events.push({
      id: events.length + 1,
      deal_id: id,
      type: "created",
      to_stage_id: stageId("Новый лид"),
      created_at: created,
    } as DealEvent);
  };
  addDeal(
    "i1",
    "Instagram",
    "implant",
    "2026-09-05T05:00:00Z",
    "Пришёл на консультацию",
  );
  addDeal("i2", "Instagram", "IMPLANT ", "2026-09-06T05:00:00Z");
  addDeal("i3", "Instagram", null, "2026-09-07T05:00:00Z", "Новый лид", {
    visit_at: "2026-09-18T06:00:00Z",
  });
  addDeal("g1", "Google", "Brand", "2026-09-08T05:00:00Z", "План согласован");
  addDeal(
    "r1",
    "Рекомендация",
    null,
    "2026-09-09T05:00:00Z",
    "Пришёл на консультацию",
  );
  addDeal("n1", null, null, "2026-09-10T05:00:00Z");
  addDeal("old", "Instagram", "implant", "2026-08-10T05:00:00Z");
  const deal = (name: string) => deals.find((d) => d.name === name)!.id;
  const payment = (
    name: string,
    amount: number,
    paid_at: string,
  ): DealPayment => ({
    id: `${name}-${paid_at}`,
    deal_id: deal(name),
    amount,
    paid_at,
    created_at: paid_at,
  });
  const spend = (
    id: number,
    sourceName: string,
    campaign: string | null,
    spent_from: string,
    spent_to: string,
    amount: number,
  ): AdSpend => ({
    id,
    source_id: source(sourceName),
    campaign,
    spent_from,
    spent_to,
    amount,
  });
  return {
    deals,
    stages: STAGES,
    deal_events: events,
    lead_sources: SOURCES,
    deal_payments: [
      payment("i1", 100000, "2026-09-20"),
      payment("i3", 50000, "2026-10-05"),
      payment("g1", 200000, "2026-09-25"),
      payment("g1", 10000, "2026-08-30"),
      payment("r1", 40000, "2026-09-10"),
    ],
    ad_spend: [
      spend(1, "Instagram", "Implant", "2026-09-01", "2026-09-30", 60000),
      spend(2, "Instagram", null, "2026-09-01", "2026-09-30", 30000),
      spend(3, "2GIS", null, "2026-10-01", "2026-10-31", 45000),
      spend(4, "Google", "brand", "2026-08-16", "2026-09-15", 62000),
    ],
  };
};

// Same notation as tests.metrics() of the SQL test
const line = (m: MarketingMetrics | undefined) =>
  m
    ? [
        m.spend,
        m.leads,
        m.came,
        m.paid,
        m.revenue,
        m.cpl ?? "-",
        m.cost_per_came ?? "-",
        m.cost_per_paid ?? "-",
        m.romi ?? "-",
      ].join(" ")
    : undefined;

const SEPTEMBER = {
  from: "2026-08-31T19:00:00.000Z",
  to: "2026-09-30T19:00:00.000Z",
};

describe("marketingReport", () => {
  const report = marketingReport(buildData(), SEPTEMBER);
  const row = (name: string | null) =>
    report.by_source.find((r) => r.name === name);

  it("totals the period", () => {
    expect(line(report.totals)).toBe(
      "120000 6 4 3 340000 20000 30000 40000 183",
    );
  });

  it("computes each source and its campaigns", () => {
    expect(line(row("Instagram"))).toBe(
      "90000 3 2 1 100000 30000 45000 90000 11",
    );
    const campaigns = row("Instagram")!.campaigns;
    expect(line(campaigns.find((c) => c.campaign === "implant"))).toBe(
      "60000 2 1 1 100000 30000 60000 60000 67",
    );
    expect(line(campaigns.find((c) => c.campaign === null))).toBe(
      "30000 1 1 0 0 30000 30000 - -100",
    );
    expect(line(row("Google"))).toBe(
      "30000 1 1 1 200000 30000 30000 30000 567",
    );
    expect(line(row("Рекомендация"))).toBe("0 1 1 1 40000 - - - -");
    expect(line(row(null))).toBe("0 1 0 0 0 - - - -");
    expect(row("2GIS")).toBeUndefined();
  });

  it("orders the sources by spend, leads, position", () => {
    expect(report.by_source.map((r) => r.name)).toEqual([
      "Instagram",
      "Google",
      "Рекомендация",
      null,
    ]);
  });

  it("filters by source and counts everything without a period", () => {
    expect(
      line(marketingReport(buildData(), { source_id: source("2GIS") }).totals),
    ).toBe("45000 0 0 0 0 - - - -100");
    expect(marketingReport(buildData(), {}).totals.leads).toBe(7);
  });

  it("reports nothing for an empty clinic", () => {
    expect(
      line(
        marketingReport(
          { ...buildData(), deals: [], ad_spend: [], deal_payments: [] },
          SEPTEMBER,
        ).totals,
      ),
    ).toBe("0 0 0 0 0 - - - -");
  });
});

describe("spendInPeriod", () => {
  const row = {
    spent_from: "2026-08-16",
    spent_to: "2026-09-15",
    amount: 62000,
  };
  it("counts a range across a bound pro rata of its days", () => {
    expect(spendInPeriod(row, "2026-09-01", "2026-10-01")).toBe(30000);
    expect(spendInPeriod(row, "2026-08-01", "2026-09-01")).toBe(32000);
    expect(spendInPeriod(row, null, null)).toBe(62000);
    expect(spendInPeriod(row, "2026-09-16", null)).toBeNull();
    expect(spendInPeriod(row, null, "2026-08-16")).toBeNull();
  });
  it("rounds half away from zero like PostgreSQL", () => {
    expect(
      spendInPeriod(
        { spent_from: "2026-09-01", spent_to: "2026-09-02", amount: 3 },
        "2026-09-01",
        "2026-09-02",
      ),
    ).toBe(2);
    expect(roundHalfAway(-2.5)).toBe(-3);
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.4)).toBe(-2);
  });
});

describe("utm_source → lead source", () => {
  it("prefers a listed value, then the code or the name", () => {
    expect(utmLeadSource(SOURCES, "ADWORDS")?.name).toBe("Google");
    expect(utmLeadSource(SOURCES, "instagram")?.name).toBe("Instagram");
    expect(utmLeadSource(SOURCES, " 2gis ")?.name).toBe("2GIS");
    expect(utmLeadSource(SOURCES, "tiktok")).toBeUndefined();
    expect(utmLeadSource(SOURCES, "  ")).toBeUndefined();
    const taken = SOURCES.map((s) =>
      s.name === "Google" ? { ...s, utm_sources: ["instagram"] } : s,
    );
    expect(utmLeadSource(taken, "instagram")?.name).toBe("Google");
  });

  it("normalizes the list of a source", () => {
    expect(normalizeUtmSources([" Google ", "google", "AdWords", ""])).toEqual([
      "google",
      "adwords",
    ]);
    expect(parseUtmSources("google, AdWords;\n yandex")).toEqual([
      "google",
      "adwords",
      "yandex",
    ]);
  });
});

describe("deal tags", () => {
  it("trims the tags, blank is null", () => {
    expect(
      normalizeAttribution({
        utm_source: " adwords ",
        utm_campaign: "  ",
        name: " x ",
      }),
    ).toEqual({ utm_source: "adwords", utm_campaign: null, name: " x " });
    expect(campaignKey(" IMPLANT ")).toBe("implant");
    expect(campaignKey("")).toBeNull();
  });

  it("gives conversions in whole percent", () => {
    expect(conversion(1, 3)).toBe(33);
    expect(conversion(1, 0)).toBeNull();
  });
});
