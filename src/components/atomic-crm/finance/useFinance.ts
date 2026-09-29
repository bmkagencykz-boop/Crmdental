import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useGetList, type Identifier } from "ra-core";
import { useCallback } from "react";

import { useMyAccessRights } from "../access-rights/useAccessRights";
import type { CrmDataProvider } from "../providers/types";
import type {
  CashFlowFilters,
  MovementFilters,
} from "../providers/supabase/financeMethods";
import { addMonths, monthOf } from "./financeMath";
import type {
  FinanceAccount,
  FinanceArticle,
  FinanceModel,
  Scenario,
} from "./types";

const ALL = { page: 1, perPage: 1000 };

/**
 * The finance rights of the signed-in employee (stage 44): the ДДС with
 * the reports right; the P&L, the model and the changes — owner and head
 */
export const useFinanceRights = () => {
  const { data, isPending } = useMyAccessRights();
  const role = data?.role;
  const reports = data?.rights.reports.view === "all";
  return {
    isPending,
    canView:
      role === "owner" || ((role === "head" || role === "manager") && reports),
    canEdit: role === "owner" || role === "head",
  };
};

export const useFinanceAccounts = () =>
  useGetList<FinanceAccount>("finance_accounts", {
    pagination: ALL,
    sort: { field: "position", order: "ASC" },
  });

export const useFinanceArticles = () =>
  useGetList<FinanceArticle>("finance_articles", {
    pagination: ALL,
    sort: { field: "position", order: "ASC" },
  });

export const useFinanceModels = (enabled: boolean) =>
  useGetList<FinanceModel>(
    "finance_models",
    { pagination: ALL, sort: { field: "id", order: "ASC" } },
    { enabled },
  );

export const FINANCE_KEY = "finance";

export const useCashFlow = (filters: CashFlowFilters, enabled = true) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [FINANCE_KEY, "cash_flow", filters],
    queryFn: () => dataProvider.getCashFlow(filters),
    enabled,
  });
};

export const useCashFlowMovements = (filters: MovementFilters | null) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [FINANCE_KEY, "movements", filters],
    queryFn: () => dataProvider.getCashFlowMovements(filters!),
    enabled: filters != null,
  });
};

export const usePnl = (
  filters: { from: string; to: string; branch_id?: Identifier | null },
  enabled = true,
) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [FINANCE_KEY, "pnl", filters],
    queryFn: () => dataProvider.getPnl(filters),
    enabled,
  });
};

export const useModelReport = (
  modelId: Identifier | null,
  scenario: Scenario,
) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [FINANCE_KEY, "model", modelId, scenario],
    queryFn: () => dataProvider.getFinanceModelReport(modelId!, scenario),
    enabled: modelId != null,
  });
};

export const useMethodAccounts = (enabled: boolean) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [FINANCE_KEY, "method_accounts"],
    queryFn: () => dataProvider.getFinanceMethodAccounts(),
    enabled,
  });
};

/** After a change: the reports and the lists of the finance pages */
export const useRefreshFinance = () => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [FINANCE_KEY] });
    for (const resource of [
      "finance_accounts",
      "finance_articles",
      "finance_transactions",
      "finance_models",
      "finance_model_months",
      "finance_model_lines",
      "cash_expense_categories",
    ]) {
      queryClient.invalidateQueries({ queryKey: [resource] });
    }
  }, [queryClient]);
};

/** A period of months: the first month and the last one (both included) */
export type MonthRange = { from: string; to: string };

export const PERIOD_PRESETS = [
  "last12",
  "year",
  "last_year",
  "quarter",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const presetRange = (
  preset: PeriodPreset,
  today: string,
): MonthRange => {
  const current = monthOf(today);
  const year = current.slice(0, 4);
  switch (preset) {
    case "year":
      return { from: `${year}-01-01`, to: current };
    case "last_year":
      return {
        from: `${Number(year) - 1}-01-01`,
        to: `${Number(year) - 1}-12-01`,
      };
    case "quarter":
      return { from: addMonths(current, -2), to: current };
    default:
      return { from: addMonths(current, -11), to: current };
  }
};
