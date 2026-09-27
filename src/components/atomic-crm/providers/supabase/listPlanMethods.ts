import type { Identifier } from "ra-core";

import type {
  BulkDealsAction,
  BulkDealsResult,
  BulkParams,
} from "../../deals/list/bulk";
import type {
  SalesPlanInput,
  SalesPlanReport,
} from "../../reports/salesPlan";
import { getSupabaseClient } from "./supabase";

/**
 * Deal list and sales plan (stage 21): the custom methods of the data
 * provider. Saved filters are the plain resource saved_filters (RLS).
 */
export const getListPlanMethods = () => ({
  /** One action on many deals (public.bulk_deals): a result per deal */
  async bulkDeals(
    action: BulkDealsAction,
    ids: Identifier[],
    params: BulkParams = {},
  ): Promise<BulkDealsResult> {
    const { data, error } = await getSupabaseClient().rpc("bulk_deals", {
      action,
      ids,
      params,
    });
    if (error) throw error;
    return data as BulkDealsResult;
  },
  /** Targets and facts of a month (owner and head) */
  async getSalesPlanReport(month?: string | null): Promise<SalesPlanReport> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_sales_plan",
      { target_month: month ?? null },
    );
    if (error) throw error;
    return data as SalesPlanReport;
  },
  async saveSalesPlan(
    month: string,
    plans: SalesPlanInput[],
  ): Promise<number> {
    const { data, error } = await getSupabaseClient().rpc("save_sales_plan", {
      target_month: month,
      plans,
    });
    if (error) throw error;
    return data as number;
  },
});
