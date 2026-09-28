import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ReportFilters } from "../reports/reportMath";
import { ReportTable } from "../reports/ReportTable";
import type { CashMethodRow } from "./types";
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
          label: translate("payments.report.net"),
          numeric: true,
          render: (row) => money(row.net),
          csv: (row) => Number(row.net),
        },
      ]}
    />
  );
};
