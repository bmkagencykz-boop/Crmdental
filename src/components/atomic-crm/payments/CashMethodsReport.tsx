import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ReportFilters } from "../reports/reportMath";
import { ReportTable } from "../reports/ReportTable";
import type { CashExpenseRow, CashMethodRow } from "./types";
import { money } from "./usePayments";

/**
 * Reports «Деньги» → «Поступления по способам оплаты»: money in and out of
 * the till by method in the period (public.report_cash_methods, stage 36)
 */
export const CashMethodsReport = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: rows = [], isPending } = useQuery({
    queryKey: ["reports", "cash_methods", filters],
    queryFn: () =>
      dataProvider.getCashMethodsReport({
        from: filters.from ?? null,
        to: filters.to ?? null,
        branch_id: filters.branch_id ?? null,
      }),
  });
  if (isPending) return null;
  const top = Math.max(1, ...rows.map((row) => row.income));
  return (
    <ReportTable<CashMethodRow>
      title={translate("payments.report.title")}
      description={
        rows.length
          ? translate("payments.report.hint")
          : translate("payments.report.empty")
      }
      filename="cash_by_method"
      rows={rows}
      rowKey={(row) => row.method}
      columns={[
        {
          label: translate("payments.report.method"),
          render: (row) => translate(`payments.methods.${row.method}`),
        },
        {
          label: translate("payments.report.operations"),
          numeric: true,
          render: (row) => row.operations,
        },
        {
          label: translate("payments.report.income"),
          render: (row) => money(row.income),
          csv: (row) => Number(row.income),
          bar: (row) => row.income / top,
        },
        {
          label: translate("payments.report.refunds"),
          numeric: true,
          render: (row) => money(row.refunds),
          csv: (row) => Number(row.refunds),
        },
        {
          label: translate("cash_out.report.expenses"),
          numeric: true,
          render: (row) => money(row.expenses ?? 0),
          csv: (row) => Number(row.expenses ?? 0),
        },
        {
          label: translate("payments.report.net"),
          numeric: true,
          render: (row) => money(row.net),
          csv: (row) => Number(row.net),
        },
      ]}
    />
  );
};

/**
 * Reports «Деньги» → «Расходы по статьям»: the expenses of the period by
 * category (public.report_cash_expenses, stage 42)
 */
export const CashExpensesReport = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: rows = [], isPending } = useQuery({
    queryKey: ["reports", "cash_expenses", filters],
    queryFn: () =>
      dataProvider.getCashExpensesReport({
        from: filters.from ?? null,
        to: filters.to ?? null,
        branch_id: filters.branch_id ?? null,
      }),
  });
  if (isPending) return null;
  const top = Math.max(1, ...rows.map((row) => row.amount));
  return (
    <ReportTable<CashExpenseRow>
      title={translate("cash_out.report.title")}
      description={
        rows.length
          ? translate("cash_out.report.hint")
          : translate("cash_out.report.empty")
      }
      filename="cash_expenses"
      rows={rows}
      rowKey={(row) => String(row.category_id)}
      columns={[
        {
          label: translate("cash_out.report.category"),
          render: (row) => row.name,
        },
        {
          label: translate("cash_out.report.operations"),
          numeric: true,
          render: (row) => row.operations,
        },
        {
          label: translate("cash_out.report.amount"),
          render: (row) => money(row.amount),
          csv: (row) => Number(row.amount),
          bar: (row) => row.amount / top,
        },
        {
          label: translate("cash_out.report.cash"),
          numeric: true,
          render: (row) => money(row.cash),
          csv: (row) => Number(row.cash),
        },
      ]}
    />
  );
};
