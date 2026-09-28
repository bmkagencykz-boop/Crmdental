import { useTranslate } from "ra-core";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { exportCsv, type ReportColumn } from "../reports/csv";
import { Bar, ReportSection, Stat } from "../reports/ReportTable";
import type { ReportFilters } from "../reports/reportMath";
import { AdSpendEditor } from "./AdSpendEditor";
import { conversion } from "./marketingMath";
import {
  reportLines,
  toMarketingFilters,
  useMarketingReport,
  type Line,
} from "./marketingReport";

const Loading = () => (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-24 rounded-md" />
    <Skeleton className="h-64 rounded-md" />
  </div>
);

/**
 * Reports → «Маркетинг» (stage 32): spend, leads, cost per lead, patients who
 * came and paid, revenue and ROMI per source (a source unfolds into its
 * campaigns), a chart of CPL and ROMI, CSV export, and the ad spend editor.
 * Owner and head only, like every report.
 */
export const MarketingTab = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const money = (amount: number | null | undefined) =>
    amount == null ? "—" : formatMoney(amount, currency ?? "KZT");
  const percent = (value: number | null) =>
    value == null ? "—" : `${value} %`;
  const marketingFilters = toMarketingFilters(filters);
  const { data, isPending, error } = useMarketingReport(marketingFilters);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const labels = {
    noSource: translate("marketing.report.no_source"),
    noCampaign: translate("marketing.report.no_campaign"),
    total: translate("marketing.report.total"),
  };
  const column = (key: string) => translate(`marketing.report.columns.${key}`);
  const columns: Array<ReportColumn<Line> & { key: string }> = [
    { key: "source", label: column("source"), render: (l) => l.source },
    {
      key: "campaign",
      label: column("campaign"),
      render: (l) => l.campaign ?? "",
    },
    {
      key: "spend",
      label: column("spend"),
      numeric: true,
      render: (l) => money(l.spend),
      csv: (l) => l.spend,
    },
    {
      key: "leads",
      label: column("leads"),
      numeric: true,
      render: (l) => l.leads,
    },
    {
      key: "cpl",
      label: column("cpl"),
      numeric: true,
      render: (l) => money(l.cpl),
      csv: (l) => l.cpl,
    },
    {
      key: "came",
      label: column("came"),
      numeric: true,
      render: (l) => l.came,
    },
    {
      key: "cost_per_came",
      label: column("cost_per_came"),
      numeric: true,
      render: (l) => money(l.cost_per_came),
      csv: (l) => l.cost_per_came,
    },
    {
      key: "paid",
      label: column("paid"),
      numeric: true,
      render: (l) => l.paid,
    },
    {
      key: "revenue",
      label: column("revenue"),
      numeric: true,
      render: (l) => money(l.revenue),
      csv: (l) => l.revenue,
    },
    {
      key: "romi",
      label: column("romi"),
      numeric: true,
      render: (l) => (
        <span
          className={cn(
            l.romi != null && l.romi < 0 && "text-destructive",
            l.romi != null && l.romi >= 0 && "text-foreground",
          )}
        >
          {percent(l.romi)}
        </span>
      ),
      csv: (l) => l.romi,
    },
    {
      key: "lead_came",
      label: column("lead_came"),
      numeric: true,
      render: (l) => percent(conversion(l.came, l.leads)),
      csv: (l) => conversion(l.came, l.leads),
    },
    {
      key: "came_paid",
      label: column("came_paid"),
      numeric: true,
      render: (l) => percent(conversion(l.paid, l.came)),
      csv: (l) => conversion(l.paid, l.came),
    },
  ];

  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {translate("reports.error")}
        {error instanceof Error && error.message ? `: ${error.message}` : null}
      </p>
    );
  }
  if (isPending || !data) return <Loading />;

  const lines = reportLines(data, labels, (key) => !!open[key]);
  const totals = data.totals;
  const charted = data.by_source.filter((row) => row.spend > 0);
  const maxCpl = Math.max(1, ...charted.map((row) => row.cpl ?? 0));
  const maxRomi = Math.max(1, ...charted.map((row) => Math.abs(row.romi ?? 0)));

  return (
    <div className="flex flex-col gap-6" data-testid="marketing-report">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label={column("spend")} value={money(totals.spend)} />
        <Stat label={column("leads")} value={totals.leads} />
        <Stat label={column("cpl")} value={money(totals.cpl)} />
        <Stat
          label={column("came")}
          value={totals.came}
          hint={`${column("lead_came")}: ${percent(conversion(totals.came, totals.leads))}`}
        />
        <Stat
          label={column("revenue")}
          value={money(totals.revenue)}
          hint={`${column("paid")}: ${totals.paid}`}
        />
        <Stat label={column("romi")} value={percent(totals.romi)} />
      </div>

      <ReportSection
        title={translate("marketing.report.by_source")}
        description={translate("marketing.report.hint")}
        action={
          <Button
            variant="outline"
            size="sm"
            className="rounded-md"
            disabled={!data.by_source.length}
            onClick={() =>
              exportCsv("marketing", columns, reportLines(data, labels))
            }
          >
            {translate("reports.export_csv")}
          </Button>
        }
      >
        {data.by_source.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                {columns
                  .filter((c) => c.key !== "campaign")
                  .map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(
                        "text-muted-foreground",
                        c.numeric && "text-right",
                      )}
                    >
                      {c.label}
                    </TableHead>
                  ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow
                  key={line.key}
                  className={cn(
                    line.kind === "total" && "font-semibold",
                    line.kind === "campaign" && "text-muted-foreground",
                  )}
                  data-testid={`marketing-${line.kind}`}
                >
                  {columns
                    .filter((c) => c.key !== "campaign")
                    .map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          c.numeric && "text-right tabular-nums",
                          line.kind === "campaign" &&
                            c.key === "source" &&
                            "pl-6",
                        )}
                      >
                        {c.key !== "source" ? (
                          c.render(line)
                        ) : line.kind === "campaign" ? (
                          line.campaign
                        ) : line.kind === "source" && line.hasCampaigns ? (
                          <button
                            type="button"
                            className="text-left hover:underline"
                            aria-expanded={!!open[line.key]}
                            onClick={() =>
                              setOpen((state) => ({
                                ...state,
                                [line.key]: !state[line.key],
                              }))
                            }
                          >
                            {open[line.key] ? "▾" : "▸"} {line.source}
                          </button>
                        ) : (
                          line.source
                        )}
                      </TableCell>
                    ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("reports.empty")}
          </p>
        )}
      </ReportSection>

      {charted.length ? (
        <ReportSection
          title={translate("marketing.report.chart")}
          description={translate("marketing.report.chart_hint")}
        >
          <div
            className="grid grid-cols-[10rem_1fr_1fr] items-center gap-x-4 gap-y-1.5 text-sm"
            data-testid="marketing-chart"
          >
            <span />
            <span className="text-xs text-muted-foreground">
              {column("cpl")}
            </span>
            <span className="text-xs text-muted-foreground">
              {column("romi")}
            </span>
            {charted.map((row) => (
              <Fragment key={String(row.id)}>
                <span className="truncate">{row.name ?? labels.noSource}</span>
                <Bar share={(row.cpl ?? 0) / maxCpl}>{money(row.cpl)}</Bar>
                <RomiBar value={row.romi} max={maxRomi} />
              </Fragment>
            ))}
          </div>
        </ReportSection>
      ) : null}

      <AdSpendEditor />
    </div>
  );
};

/** ROMI as a bar: the primary color when it pays off, red when it does not */
const RomiBar = ({ value, max }: { value: number | null; max: number }) => (
  <div className="relative flex min-w-24 items-center">
    <div
      className={cn(
        "absolute inset-y-0 left-0 rounded-sm",
        value != null && value < 0 ? "bg-destructive/25" : "bg-primary/25",
      )}
      style={{
        width: `${Math.min(1, Math.abs(value ?? 0) / max) * 100}%`,
      }}
      aria-hidden
    />
    <span className="relative px-2 py-0.5 tabular-nums">
      {value == null ? "—" : `${value} %`}
    </span>
  </div>
);
