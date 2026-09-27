import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";

import type { CrmDataProvider } from "../providers/types";
import { formatPercent } from "../reports/format";
import { ReportTable, Stat } from "../reports/ReportTable";
import type { ReportFilters } from "../reports/reportMath";
import type { RecallReport } from "./types";

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

type UpcomingRow = RecallReport["upcoming"][number];
type RecallRow = RecallReport["recalls"][number];

/**
 * Reports → Повторные продажи: recalls due in the next 30 days, the recalls
 * handled in the period (created deals, skipped, cancelled) and how many
 * recall deals were won.
 */
export const RecallsTab = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data, isPending, error } = useQuery({
    queryKey: ["recallReport", filters.from ?? null, filters.to ?? null],
    queryFn: () =>
      dataProvider.getRecallReport({ from: filters.from, to: filters.to }),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 rounded-md" />
        <Skeleton className="h-64 rounded-md" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {translate("reports.error")}
      </p>
    );
  }
  const { totals } = data;

  return (
    <div className="flex flex-col gap-4" data-testid="recalls-report">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={translate("recalls.report.upcoming")}
          value={totals.upcoming}
        />
        <Stat
          label={translate("recalls.report.created")}
          value={totals.created}
          hint={translate("recalls.report.skipped_hint", {
            skipped: totals.skipped,
            cancelled: totals.cancelled,
          })}
        />
        <Stat label={translate("recalls.report.won")} value={totals.won} />
        <Stat
          label={translate("recalls.report.conversion")}
          value={formatPercent(totals.won, totals.created)}
          hint={translate("recalls.report.conversion_hint", {
            won: totals.won,
            created: totals.created,
          })}
        />
      </div>

      <ReportTable<UpcomingRow>
        title={translate("recalls.report.upcoming_title")}
        description={translate("recalls.report.upcoming_hint")}
        filename="povtornye-predstoyashchie"
        rows={data.upcoming}
        rowKey={(row) => `${row.rule_id}-${row.deal_id}`}
        columns={[
          {
            label: translate("recalls.report.columns.due_at"),
            render: (row) => formatDate(row.due_at),
          },
          {
            label: translate("recalls.report.columns.patient"),
            render: (row) => (
              <Link
                to={`/patients/${row.patient_id}/show`}
                className="hover:underline"
              >
                {row.patient_name || "—"}
                {row.opted_out ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {translate("recalls.report.opted_out")}
                  </span>
                ) : null}
              </Link>
            ),
            csv: (row) => row.patient_name,
          },
          {
            label: translate("recalls.report.columns.rule"),
            render: (row) => row.rule_name,
          },
          {
            label: translate("recalls.report.columns.won_deal"),
            render: (row) => row.deal_name ?? "—",
          },
        ]}
      />

      <ReportTable<RecallRow>
        title={translate("recalls.report.handled_title")}
        description={translate("recalls.report.handled_hint")}
        filename="povtornye-prodazhi"
        rows={data.recalls}
        rowKey={(row) => String(row.id)}
        columns={[
          {
            label: translate("recalls.report.columns.created_at"),
            render: (row) => formatDate(row.created_at),
          },
          {
            label: translate("recalls.report.columns.patient"),
            render: (row) => row.patient_name || "—",
          },
          {
            label: translate("recalls.report.columns.rule"),
            render: (row) => row.rule_name ?? "—",
          },
          {
            label: translate("recalls.report.columns.result"),
            render: (row) =>
              row.status === "created" && row.recall_deal_id != null ? (
                <Link
                  to={`/deals/${row.recall_deal_id}/show`}
                  className="hover:underline"
                >
                  {row.recall_deal_name}
                  {row.recall_deal_kind ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {translate(
                        `recalls.report.kinds.${row.recall_deal_kind}`,
                      )}
                    </span>
                  ) : null}
                </Link>
              ) : (
                <span className="text-muted-foreground">
                  {translate(`recalls.statuses.${row.status}`)}
                  {row.reason ? `: ${row.reason}` : null}
                </span>
              ),
            csv: (row) =>
              row.status === "created"
                ? `${row.recall_deal_name ?? ""} (${
                    row.recall_deal_kind
                      ? translate(
                          `recalls.report.kinds.${row.recall_deal_kind}`,
                        )
                      : ""
                  })`
                : `${translate(`recalls.statuses.${row.status}`)}: ${row.reason ?? ""}`,
          },
        ]}
      />
    </div>
  );
};
