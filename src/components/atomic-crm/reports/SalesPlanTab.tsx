import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDataProvider, useNotify, useStore, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { formatMoney } from "../deals/kanbanFormat";
import type { CrmDataProvider } from "../providers/types";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { ReportSection } from "./ReportTable";
import {
  clinicTargets,
  metricProgress,
  monthOf,
  parseTarget,
  PLAN_METRICS,
  shiftMonth,
  type MetricProgress,
  type PlanMetric,
  type PlanValues,
  type SalesPlanInput,
  type SalesPlanReport,
} from "./salesPlan";

export const SALES_PLAN_QUERY = "sales_plan";

/** Targets and facts of a month (owner and head) */
export const useSalesPlan = (month?: string | null) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: [SALES_PLAN_QUERY, month ?? "current"],
    queryFn: () => dataProvider.getSalesPlanReport(month ?? null),
  });
};

/** Amounts in tenge, counts as numbers */
export const useFormatMetric = () => {
  const { currency } = useConfigurationContext();
  return (metric: PlanMetric, value: number | null | undefined) =>
    value == null
      ? "—"
      : metric === "paid_amount"
        ? formatMoney(value, currency ?? "KZT")
        : new Intl.NumberFormat("ru-RU").format(value);
};

const percent = (share: number | null) =>
  share == null ? "—" : `${Math.round(share * 100)} %`;

/**
 * «План продаж»: fact against the targets of the month for the clinic and
 * every employee, with progress bars and the forecast to the end of the
 * month; the owner and the head set the targets here.
 */
export const SalesPlanTab = () => {
  const translate = useTranslate();
  const [month, setMonth] = useStore<string>(
    "reports.sales_plan.month",
    monthOf(new Date()),
  );
  const [editing, setEditing] = useState(false);
  const { data, isPending, error } = useSalesPlan(month);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label={translate("sales_plan.previous_month")}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="min-w-40 text-center text-base font-semibold capitalize">
          {monthLabel(month)}
        </h2>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label={translate("sales_plan.next_month")}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        {month !== monthOf(new Date()) ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMonth(monthOf(new Date()))}
          >
            {translate("sales_plan.current_month")}
          </Button>
        ) : null}
        {!editing && data ? (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => setEditing(true)}
          >
            {translate("sales_plan.edit")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {translate("reports.error")}
        </p>
      ) : isPending || !data ? (
        <Skeleton className="h-64 rounded-md" />
      ) : editing ? (
        <PlanEditor report={data} onDone={() => setEditing(false)} />
      ) : (
        <PlanReport report={data} />
      )}
    </div>
  );
};

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${month}T12:00:00Z`),
  );

const PlanReport = ({ report }: { report: SalesPlanReport }) => {
  const translate = useTranslate();
  const format = useFormatMetric();
  const targets = clinicTargets(report);
  const current =
    report.days_elapsed > 0 && report.days_elapsed < report.days_total;

  return (
    <>
      <ReportSection
        title={translate("sales_plan.clinic")}
        description={
          current
            ? translate("sales_plan.days", {
                elapsed: report.days_elapsed,
                total: report.days_total,
              })
            : undefined
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_METRICS.map((metric) => {
            const row = metricProgress(
              report,
              report.clinic.fact,
              targets,
              metric,
            );
            return (
              <div
                key={metric}
                className="flex flex-col gap-2 rounded-md border p-3"
                aria-label={translate(`sales_plan.metrics.${metric}`)}
                role="group"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  {translate(`sales_plan.metrics.${metric}`)}
                </span>
                <span className="text-xl font-bold tabular-nums">
                  {format(metric, row.fact)}
                </span>
                <PlanBar row={row} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {row.target == null
                    ? translate("sales_plan.no_target")
                    : translate("sales_plan.of_target", {
                        target: format(metric, row.target),
                        percent: percent(row.progress),
                      })}
                </span>
                {current && row.forecast != null ? (
                  <span className="text-xs tabular-nums">
                    {translate("sales_plan.forecast", {
                      value: format(metric, row.forecast),
                    })}
                    {row.forecastProgress != null ? (
                      <span
                        className={cn(
                          "ml-1 font-semibold",
                          row.forecastProgress < 1 && "text-brand-red",
                        )}
                      >
                        {percent(row.forecastProgress)}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </ReportSection>
      <ReportSection title={translate("sales_plan.by_sales")}>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-max text-sm"
            aria-label={translate("sales_plan.by_sales")}
          >
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">
                  {translate("sales_plan.employee")}
                </th>
                {PLAN_METRICS.map((metric) => (
                  <th key={metric} className="px-3 py-2 font-medium">
                    {translate(`sales_plan.metrics.${metric}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.by_sales.map((sale) => (
                <tr key={sale.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium whitespace-nowrap">
                    {sale.name}
                  </td>
                  {PLAN_METRICS.map((metric) => {
                    const row = metricProgress(
                      report,
                      sale.fact,
                      sale.plan,
                      metric,
                    );
                    return (
                      <td key={metric} className="min-w-44 px-3 py-2 align-top">
                        <div className="flex items-baseline justify-between gap-2 tabular-nums">
                          <span className="font-semibold">
                            {format(metric, row.fact)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.target == null
                              ? "—"
                              : `/ ${format(metric, row.target)}`}
                          </span>
                        </div>
                        {row.target != null ? (
                          <>
                            <PlanBar row={row} compact />
                            {current && row.forecast != null ? (
                              <span
                                className={cn(
                                  "text-[11px] tabular-nums text-muted-foreground",
                                  row.forecastProgress != null &&
                                    row.forecastProgress < 1 &&
                                    "text-brand-red",
                                )}
                              >
                                {translate("sales_plan.forecast_short", {
                                  percent: percent(row.forecastProgress),
                                })}
                              </span>
                            ) : null}
                          </>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportSection>
    </>
  );
};

/** Progress to the target, with a tick at the forecast */
export const PlanBar = ({
  row,
  compact = false,
}: {
  row: Pick<MetricProgress, "progress" | "forecastProgress">;
  compact?: boolean;
}) => {
  const share = Math.min(1, row.progress ?? 0);
  const expected =
    row.forecastProgress == null ? null : Math.min(1, row.forecastProgress);
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-primary/15",
        compact ? "my-1 h-1.5" : "h-2",
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((row.progress ?? 0) * 100)}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${share * 100}%` }}
      />
      {expected != null && expected > share ? (
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/40"
          style={{ left: `calc(${expected * 100}% - 1px)` }}
          aria-hidden
        />
      ) : null}
    </div>
  );
};

type Draft = Record<string, Record<PlanMetric, string>>;

const toDraft = (plan: PlanValues | null): Record<PlanMetric, string> =>
  Object.fromEntries(
    PLAN_METRICS.map((metric) => [
      metric,
      plan?.[metric] == null ? "" : String(plan[metric]),
    ]),
  ) as Record<PlanMetric, string>;

const CLINIC = "clinic";

const PlanEditor = ({
  report,
  onDone,
}: {
  report: SalesPlanReport;
  onDone: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    [CLINIC]: toDraft(report.clinic.plan),
    ...Object.fromEntries(
      report.by_sales.map((sale) => [String(sale.id), toDraft(sale.plan)]),
    ),
  }));
  const rows = [
    { key: CLINIC, name: translate("sales_plan.clinic_row") },
    ...report.by_sales.map((sale) => ({
      key: String(sale.id),
      name: sale.name,
    })),
  ];
  const { mutate, isPending } = useMutation({
    mutationFn: (inputs: SalesPlanInput[]) =>
      dataProvider.saveSalesPlan(report.month, inputs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SALES_PLAN_QUERY] });
      notify("sales_plan.saved", { type: "info" });
      onDone();
    },
    onError: (error) =>
      notify((error as Error)?.message || "sales_plan.save_error", {
        type: "error",
      }),
  });

  const save = () =>
    mutate(
      rows.map(({ key }) => ({
        sales_id:
          key === CLINIC
            ? null
            : (report.by_sales.find((sale) => String(sale.id) === key)?.id ??
              null),
        ...(Object.fromEntries(
          PLAN_METRICS.map((metric) => [
            metric,
            parseTarget(draft[key][metric]),
          ]),
        ) as PlanValues),
      })),
    );

  return (
    <ReportSection
      title={translate("sales_plan.edit_title", {
        month: monthLabel(report.month),
      })}
      description={translate("sales_plan.edit_hint")}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">
                  {translate("sales_plan.employee")}
                </th>
                {PLAN_METRICS.map((metric) => (
                  <th key={metric} className="px-2 py-2 font-medium">
                    {translate(`sales_plan.metrics.${metric}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, name }) => (
                <tr
                  key={key}
                  className={cn(
                    "border-b last:border-0",
                    key === CLINIC && "bg-muted/40",
                  )}
                >
                  <td className="py-1.5 pr-4 font-medium whitespace-nowrap">
                    {name}
                  </td>
                  {PLAN_METRICS.map((metric) => (
                    <td key={metric} className="px-2 py-1.5">
                      <Input
                        inputMode="numeric"
                        className="h-8 w-36 tabular-nums"
                        aria-label={`${name}: ${translate(`sales_plan.metrics.${metric}`)}`}
                        value={draft[key][metric]}
                        placeholder={
                          key === CLINIC
                            ? translate("sales_plan.sum_placeholder")
                            : undefined
                        }
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [key]: {
                              ...current[key],
                              [metric]: event.target.value.replace(
                                /[^\d\s]/g,
                                "",
                              ),
                            },
                          }))
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending}>
            {translate("ra.action.save")}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            {translate("ra.action.cancel")}
          </Button>
        </div>
      </form>
    </ReportSection>
  );
};
