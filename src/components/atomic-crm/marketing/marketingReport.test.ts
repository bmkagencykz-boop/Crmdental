import { describe, expect, it } from "vitest";

import { reportLines, toMarketingFilters } from "./marketingReport";
import type { MarketingMetrics, MarketingReport } from "./types";

const metrics = (spend: number, leads: number): MarketingMetrics => ({
  spend,
  leads,
  came: 0,
  paid: 0,
  revenue: 0,
  cpl: spend && leads ? Math.round(spend / leads) : null,
  cost_per_came: null,
  cost_per_paid: null,
  romi: spend ? -100 : null,
});

const REPORT: MarketingReport = {
  totals: metrics(90000, 4),
  by_source: [
    {
      id: 2,
      name: "Instagram",
      ...metrics(90000, 3),
      campaigns: [
        { campaign: "implant", ...metrics(60000, 2) },
        { campaign: null, ...metrics(30000, 1) },
      ],
    },
    {
      id: null,
      name: null,
      ...metrics(0, 1),
      campaigns: [{ campaign: null, ...metrics(0, 1) }],
    },
  ],
};
const LABELS = {
  noSource: "Без источника",
  noCampaign: "без кампании",
  total: "Итого",
};

describe("reportLines", () => {
  it("lists sources, their campaigns and the total (the CSV file)", () => {
    expect(
      reportLines(REPORT, LABELS).map((l) => [
        l.kind,
        l.source,
        l.campaign,
        l.spend,
      ]),
    ).toEqual([
      ["source", "Instagram", null, 90000],
      ["campaign", "Instagram", "implant", 60000],
      ["campaign", "Instagram", "без кампании", 30000],
      ["source", "Без источника", null, 0],
      ["total", "Итого", null, 90000],
    ]);
  });

  it("shows the campaigns of the unfolded sources only", () => {
    expect(reportLines(REPORT, LABELS, () => false).map((l) => l.kind)).toEqual(
      ["source", "source", "total"],
    );
  });

  it("takes the period and the source of the reports screen", () => {
    expect(
      toMarketingFilters({ from: "a", to: null, source_id: 2, sales_id: 5 }),
    ).toEqual({ from: "a", to: null, source_id: 2 });
  });
});
