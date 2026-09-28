import type { Identifier } from "ra-core";

/** A row of public.ad_spend (stage 32): spend on advertising, tenge */
export type AdSpend = {
  id: Identifier;
  organization_id?: Identifier;
  source_id: Identifier;
  /** Matched with deals.utm_campaign, any case; null: the whole source */
  campaign?: string | null;
  /** Local dates YYYY-MM-DD, both included */
  spent_from: string;
  spent_to: string;
  amount: number;
  comment?: string | null;
  sales_id?: Identifier | null;
  created_at?: string;
};

export type MarketingFilters = {
  /** Start of the period (inclusive), ISO date-time; null: no start */
  from?: string | null;
  /** End of the period (exclusive), ISO date-time; null: up to now */
  to?: string | null;
  source_id?: Identifier | null;
};

export type MarketingMetrics = {
  spend: number;
  leads: number;
  came: number;
  paid: number;
  revenue: number;
  cpl: number | null;
  cost_per_came: number | null;
  cost_per_paid: number | null;
  /** (revenue − spend) / spend, whole percent */
  romi: number | null;
};

export type MarketingCampaignRow = MarketingMetrics & {
  /** Lower case; null: without a campaign */
  campaign: string | null;
};

export type MarketingSourceRow = MarketingMetrics & {
  id: Identifier | null;
  name: string | null;
  campaigns: MarketingCampaignRow[];
};

export type MarketingReport = {
  totals: MarketingMetrics;
  by_source: MarketingSourceRow[];
};
