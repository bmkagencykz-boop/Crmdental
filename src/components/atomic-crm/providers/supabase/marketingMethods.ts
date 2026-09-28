import type { MarketingFilters, MarketingReport } from "../../marketing/types";
import { getSupabaseClient } from "./supabase";

/**
 * Marketing analytics (stage 32): the ad spend is a plain resource
 * (ad_spend, owner and head only by RLS); the report is
 * public.report_marketing.
 */
export const getMarketingMethods = () => ({
  /** Reports → «Маркетинг» */
  async getMarketingReport(
    filters: MarketingFilters,
  ): Promise<MarketingReport> {
    const { data, error } = await getSupabaseClient().rpc("report_marketing", {
      period_from: filters.from ?? null,
      period_to: filters.to ?? null,
      filter_source_id: filters.source_id ?? null,
    });
    if (error) throw error;
    return data as MarketingReport;
  },
});
