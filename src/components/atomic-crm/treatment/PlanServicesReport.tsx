import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { ReportFilters } from "../reports/reportMath";
import { ReportTable } from "../reports/ReportTable";
import { formatTenge } from "../onboarding/servicePresets";
import type { PlanServiceRow } from "./types";

/**
 * Reports «Деньги» → «Согласованные планы по позициям»: the services of the
 * main plans agreed in the period, by sum (public.report_plan_services).
 */
export const PlanServicesReport = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: rows = [], isPending } = useQuery({
    queryKey: ["reports", "plan_services", filters],
    queryFn: () => dataProvider.getPlanServicesReport(filters),
  });
  if (isPending) return null;
  const top = Math.max(1, ...rows.map((row) => row.amount));
  return (
    <ReportTable<PlanServiceRow>
      title={translate("treatment.report.title")}
      description={
        rows.length
          ? translate("treatment.report.hint")
          : translate("treatment.report.empty")
      }
      filename="agreed_plans_by_service"
      rows={rows}
      rowKey={(row, index) => `${row.service_id ?? row.name}-${index}`}
      columns={[
        {
          label: translate("treatment.report.service"),
          render: (row) => row.name,
        },
        {
          label: translate("treatment.report.quantity"),
          numeric: true,
          render: (row) => row.quantity,
        },
        {
          label: translate("treatment.report.plans"),
          numeric: true,
          render: (row) => row.plans,
        },
        {
          label: translate("treatment.report.amount"),
          render: (row) => `${formatTenge(row.amount)} ₸`,
          csv: (row) => Number(row.amount),
          bar: (row) => row.amount / top,
        },
      ]}
    />
  );
};
