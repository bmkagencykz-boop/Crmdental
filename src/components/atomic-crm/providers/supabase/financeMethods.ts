import type { Identifier } from "ra-core";

import type {
  CashFlowReport,
  FinanceMethod,
  FinanceMethodAccount,
  FinanceModelReport,
  Granularity,
  Movement,
  PnlReport,
  Scenario,
} from "../../finance/types";
import { getSupabaseClient } from "./supabase";

export type CashFlowFilters = {
  /** YYYY-MM-DD, half-open */
  from: string;
  to: string;
  branch_id?: Identifier | null;
  granularity?: Granularity;
};

export type MovementFilters = {
  from: string;
  to: string;
  branch_id?: Identifier | null;
  article_id?: Identifier | null;
  account_id?: Identifier | null;
  transfers?: boolean;
};

/**
 * Finance (stage 44): the reports are RPCs (public.report_cash_flow,
 * report_cash_flow_movements, report_pnl, report_finance_model); accounts,
 * articles, transactions and models are ordinary resources (finance_*);
 * the method map has no id, so it has its own methods.
 */
export const getFinanceMethods = () => ({
  /** «ДДС» */
  async getCashFlow(filters: CashFlowFilters): Promise<CashFlowReport> {
    const { data, error } = await getSupabaseClient().rpc("report_cash_flow", {
      period_from: filters.from,
      period_to: filters.to,
      filter_branch_id: filters.branch_id ?? null,
      granularity: filters.granularity ?? "month",
    });
    if (error) throw error;
    return data as CashFlowReport;
  },
  /** The movements of a cell of the ДДС */
  async getCashFlowMovements(filters: MovementFilters): Promise<Movement[]> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_cash_flow_movements",
      {
        period_from: filters.from,
        period_to: filters.to,
        filter_branch_id: filters.branch_id ?? null,
        filter_article_id: filters.article_id ?? null,
        filter_account_id: filters.account_id ?? null,
        filter_transfers: !!filters.transfers,
      },
    );
    if (error) throw error;
    return (data as Movement[]) ?? [];
  },
  /** «ПиУ» */
  async getPnl(filters: {
    from: string;
    to: string;
    branch_id?: Identifier | null;
  }): Promise<PnlReport> {
    const { data, error } = await getSupabaseClient().rpc("report_pnl", {
      period_from: filters.from,
      period_to: filters.to,
      filter_branch_id: filters.branch_id ?? null,
    });
    if (error) throw error;
    return data as PnlReport;
  },
  /** «Финмодель»: the plan of a scenario with plan vs fact */
  async getFinanceModelReport(
    modelId: Identifier,
    scenario: Scenario = "base",
  ): Promise<FinanceModelReport> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_finance_model",
      { target_model_id: modelId, scenario },
    );
    if (error) throw error;
    return data as FinanceModelReport;
  },
  /** Which account every method of the cash desk lands in */
  async getFinanceMethodAccounts(): Promise<FinanceMethodAccount[]> {
    const { data, error } = await getSupabaseClient()
      .from("finance_method_accounts")
      .select("method, account_id");
    if (error) throw error;
    return (data as FinanceMethodAccount[]) ?? [];
  },
  async setFinanceMethodAccount(method: FinanceMethod, accountId: Identifier) {
    const { error } = await getSupabaseClient()
      .from("finance_method_accounts")
      .update({ account_id: accountId })
      .eq("method", method);
    if (error) throw error;
  },
});
