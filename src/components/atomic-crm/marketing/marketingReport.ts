import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ReportFilters } from "../reports/reportMath";
import type {
  MarketingFilters,
  MarketingMetrics,
  MarketingReport,
} from "./types";

export const MARKETING_QUERY_KEY = ["reports", "marketing"];

/** The report reads the period and the source of the reports screen */
export const toMarketingFilters = (
  filters: ReportFilters,
): MarketingFilters => ({
  from: filters.from ?? null,
  to: filters.to ?? null,
  source_id: filters.source_id ?? null,
});

export const useMarketingReport = (filters: MarketingFilters) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [...MARKETING_QUERY_KEY, filters],
    queryFn: () => dataProvider.getMarketingReport(filters),
  });
};

/** A line of the table and of the CSV file */
export type Line = MarketingMetrics & {
  key: string;
  kind: "source" | "campaign" | "total";
  source: string;
  campaign: string | null;
  hasCampaigns?: boolean;
};

export const reportLines = (
  report: MarketingReport,
  labels: { noSource: string; noCampaign: string; total: string },
  expanded: (key: string) => boolean = () => true,
): Line[] => {
  const lines: Line[] = [];
  for (const row of report.by_source) {
    const key = String(row.id ?? "none");
    const source = row.name ?? labels.noSource;
    const { campaigns, id: _id, name: _name, ...metrics } = row;
    const hasCampaigns = campaigns.some((c) => c.campaign != null);
    lines.push({
      ...metrics,
      key,
      kind: "source",
      source,
      campaign: null,
      hasCampaigns,
    });
    if (hasCampaigns && expanded(key)) {
      for (const { campaign, ...campaignMetrics } of campaigns) {
        lines.push({
          ...campaignMetrics,
          key: `${key}:${campaign ?? ""}`,
          kind: "campaign",
          source,
          campaign: campaign ?? labels.noCampaign,
        });
      }
    }
  }
  lines.push({
    ...report.totals,
    key: "total",
    kind: "total",
    source: labels.total,
    campaign: null,
  });
  return lines;
};
