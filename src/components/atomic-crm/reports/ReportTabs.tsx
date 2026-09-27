import { useTranslate } from "ra-core";
import { Skeleton } from "@/components/ui/skeleton";

import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { formatDuration, formatPercent, type DurationUnits } from "./format";
import { ReportTable, Stat } from "./ReportTable";
import type {
  ConversionMetrics,
  MoneyMetrics,
  NamedRow,
  ReportFilters,
} from "./reportMath";
import { useReport } from "./useReport";

const useUnits = (): DurationUnits => {
  const translate = useTranslate();
  return {
    day: translate("reports.units.day"),
    hour: translate("reports.units.hour"),
    minute: translate("reports.units.minute"),
  };
};

const useMoney = () => {
  const { currency } = useConfigurationContext();
  return (amount: number | null | undefined) =>
    amount == null ? "—" : formatMoney(amount, currency ?? "KZT");
};

const max = (values: number[]) => Math.max(1, ...values);

const Loading = () => (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-24 rounded-md" />
    <Skeleton className="h-64 rounded-md" />
  </div>
);

const Failed = ({ error }: { error: unknown }) => {
  const translate = useTranslate();
  return (
    <p className="text-sm text-destructive" role="alert">
      {translate("reports.error")}
      {error instanceof Error && error.message ? `: ${error.message}` : null}
    </p>
  );
};

// --- Conversion ------------------------------------------------------------

const KEY_CONVERSIONS = [
  ["lead_appointment", "deals", "appointment"],
  ["appointment_visit", "appointment", "visit"],
  ["visit_plan", "visit", "plan"],
  ["plan_payment", "plan", "paid"],
] as const;

export const ConversionTab = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const { data, isPending, error } = useReport("conversion", filters);
  if (error) return <Failed error={error} />;
  if (isPending || !data) return <Loading />;

  const top = max(data.funnel.map((stage) => stage.deals));
  const columns = (nameLabel: string, noneLabel: string) => [
    {
      label: nameLabel,
      render: (row: NamedRow & ConversionMetrics) => row.name ?? noneLabel,
    },
    ...(
      ["deals", "appointment", "visit", "plan", "paid", "won", "lost"] as const
    ).map((key) => ({
      label: translate(`reports.conversion.columns.${key}`),
      numeric: true,
      render: (row: ConversionMetrics) => row[key],
    })),
    {
      label: translate("reports.conversion.columns.win_rate"),
      numeric: true,
      render: (row: ConversionMetrics) => formatPercent(row.won, row.deals),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KEY_CONVERSIONS.map(([key, from, to]) => (
          <Stat
            key={key}
            label={translate(`reports.conversion.key.${key}`)}
            value={formatPercent(data.totals[to], data.totals[from])}
            hint={`${data.totals[to]} / ${data.totals[from]}`}
          />
        ))}
      </div>
      <ReportTable
        title={translate("reports.conversion.funnel")}
        description={translate("reports.conversion.funnel_hint")}
        filename="conversion_funnel"
        rows={data.funnel}
        rowKey={(row) => String(row.stage_id)}
        columns={[
          {
            label: translate("reports.columns.stage"),
            render: (row) => row.name,
          },
          {
            label: translate("reports.conversion.columns.deals"),
            render: (row) => row.deals,
            csv: (row) => row.deals,
            bar: (row) => row.deals / top,
          },
          {
            label: translate("reports.conversion.columns.from_first"),
            numeric: true,
            render: (row) =>
              formatPercent(row.deals, data.funnel[0]?.deals ?? 0),
          },
        ]}
      />
      <ReportTable
        title={translate("reports.conversion.by_source")}
        filename="conversion_by_source"
        rows={data.by_source}
        rowKey={(row) => String(row.id)}
        columns={columns(
          translate("reports.columns.source"),
          translate("reports.none.source"),
        )}
      />
      <ReportTable
        title={translate("reports.conversion.by_sales")}
        filename="conversion_by_employee"
        rows={data.by_sales}
        rowKey={(row) => String(row.id)}
        columns={columns(
          translate("reports.columns.employee"),
          translate("reports.none.employee"),
        )}
      />
      <ReportTable
        title={translate("doctors.reports.by_doctor")}
        filename="conversion_by_doctor"
        rows={data.by_doctor ?? []}
        rowKey={(row) => String(row.id)}
        columns={[
          {
            label: translate("doctors.reports.column"),
            render: (row: NamedRow & ConversionMetrics) =>
              row.name ?? translate("doctors.reports.none"),
          },
          {
            label: translate("reports.conversion.columns.deals"),
            numeric: true,
            render: (row: ConversionMetrics) => row.deals,
          },
          // The key conversions of the doctor: share and "how many of how many"
          ...KEY_CONVERSIONS.map(([key, from, to]) => ({
            label: translate(`reports.conversion.key.${key}`),
            numeric: true,
            render: (row: ConversionMetrics) => (
              <span title={`${row[to]} / ${row[from]}`}>
                {formatPercent(row[to], row[from])}
              </span>
            ),
            csv: (row: ConversionMetrics) =>
              `${formatPercent(row[to], row[from])} (${row[to]}/${row[from]})`,
          })),
          {
            label: translate("reports.conversion.columns.won"),
            numeric: true,
            render: (row: ConversionMetrics) => row.won,
          },
          {
            label: translate("reports.conversion.columns.win_rate"),
            numeric: true,
            render: (row: ConversionMetrics) =>
              formatPercent(row.won, row.deals),
          },
        ]}
      />
    </div>
  );
};

// --- Speed and KPI -----------------------------------------------------------

export const SpeedTab = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const units = useUnits();
  const { data, isPending, error } = useReport("speed", filters);
  if (error) return <Failed error={error} />;
  if (isPending || !data) return <Loading />;

  const longest = max(data.stages.map((stage) => stage.avg_seconds ?? 0));
  const pipelines = new Set(data.stages.map((stage) => stage.pipeline_id));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={translate("reports.speed.first_response")}
          value={formatDuration(data.first_response.avg_seconds, units)}
          hint={translate("reports.speed.first_response_hint", {
            smart_count: data.first_response.deals,
          })}
        />
        <Stat
          label={translate("reports.speed.overdue_share")}
          value={formatPercent(
            sum(data.by_sales.map((row) => row.tasks_overdue)),
            sum(data.by_sales.map((row) => row.tasks_due)),
          )}
        />
        <Stat
          label={translate("reports.speed.columns.deals_without_task")}
          value={sum(data.by_sales.map((row) => row.deals_without_task))}
        />
        <Stat
          label={translate("reports.speed.columns.messages_sent")}
          value={sum(data.by_sales.map((row) => row.messages_sent))}
        />
      </div>
      <ReportTable
        title={translate("reports.speed.stages")}
        description={translate("reports.speed.stages_hint")}
        filename="time_in_stage"
        rows={data.stages}
        rowKey={(row) => String(row.stage_id)}
        columns={[
          {
            label: translate("reports.columns.stage"),
            render: (row) =>
              pipelines.size > 1
                ? `${row.pipeline_name}: ${row.name}`
                : row.name,
          },
          {
            label: translate("reports.speed.columns.stays"),
            numeric: true,
            render: (row) => row.stays,
          },
          {
            label: translate("reports.speed.columns.avg_time"),
            render: (row) => formatDuration(row.avg_seconds, units),
            csv: (row) => formatDuration(row.avg_seconds, units),
            bar: (row) => (row.avg_seconds ?? 0) / longest,
          },
          {
            label: translate("reports.speed.columns.avg_hours"),
            numeric: true,
            render: (row) =>
              row.avg_seconds == null
                ? "—"
                : Math.round((row.avg_seconds / 3600) * 10) / 10,
          },
        ]}
      />
      <ReportTable
        title={translate("reports.speed.by_sales")}
        filename="kpi_by_employee"
        rows={data.by_sales}
        rowKey={(row) => String(row.id)}
        columns={[
          {
            label: translate("reports.columns.employee"),
            render: (row) => row.name,
          },
          {
            label: translate("reports.speed.columns.deals"),
            numeric: true,
            render: (row) => row.deals,
          },
          {
            label: translate("reports.speed.columns.first_response"),
            numeric: true,
            render: (row) => formatDuration(row.first_response_seconds, units),
          },
          {
            label: translate("reports.speed.columns.tasks_created"),
            numeric: true,
            render: (row) => row.tasks_created,
          },
          {
            label: translate("reports.speed.columns.tasks_done"),
            numeric: true,
            render: (row) => row.tasks_done,
          },
          {
            label: translate("reports.speed.columns.overdue"),
            numeric: true,
            render: (row) => formatPercent(row.tasks_overdue, row.tasks_due),
            csv: (row) =>
              `${formatPercent(row.tasks_overdue, row.tasks_due)} (${row.tasks_overdue}/${row.tasks_due})`,
          },
          {
            label: translate("reports.speed.columns.messages_sent"),
            numeric: true,
            render: (row) => row.messages_sent,
          },
          {
            label: translate("reports.speed.columns.open_deals"),
            numeric: true,
            render: (row) => row.open_deals,
          },
          {
            label: translate("reports.speed.columns.deals_without_task"),
            numeric: true,
            render: (row) => (
              <span
                className={
                  row.deals_without_task ? "font-semibold text-destructive" : ""
                }
              >
                {row.deals_without_task}
              </span>
            ),
            csv: (row) => row.deals_without_task,
          },
        ]}
      />
    </div>
  );
};

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

// --- Lost reasons --------------------------------------------------------------

export const LostReasonsTab = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const money = useMoney();
  const { data, isPending, error } = useReport("lost_reasons", filters);
  if (error) return <Failed error={error} />;
  if (isPending || !data) return <Loading />;

  const total = data.totals.deals;
  const shareColumns = <
    Row extends { deals: number; plan_amount: number },
  >() => [
    {
      label: translate("reports.lost.columns.deals"),
      render: (row: Row) => row.deals,
      csv: (row: Row) => row.deals,
      bar: (row: Row) => (total ? row.deals / total : 0),
    },
    {
      label: translate("reports.lost.columns.share"),
      numeric: true,
      render: (row: Row) => formatPercent(row.deals, total),
    },
    {
      label: translate("reports.lost.columns.plan_amount"),
      numeric: true,
      render: (row: Row) => money(row.plan_amount),
      csv: (row: Row) => Number(row.plan_amount),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={translate("reports.lost.total")} value={total} />
        <Stat
          label={translate("reports.lost.plan_amount")}
          value={money(data.totals.plan_amount)}
        />
      </div>
      <ReportTable
        title={translate("reports.lost.by_reason")}
        filename="lost_by_reason"
        rows={data.by_reason}
        rowKey={(row) => String(row.id)}
        columns={[
          {
            label: translate("reports.columns.reason"),
            render: (row) => row.name ?? translate("reports.none.reason"),
          },
          ...shareColumns<(typeof data.by_reason)[number]>(),
        ]}
      />
      <ReportTable
        title={translate("reports.lost.by_stage")}
        filename="lost_by_stage"
        rows={data.by_stage}
        rowKey={(row) => String(row.id)}
        columns={[
          {
            label: translate("reports.columns.stage"),
            render: (row) =>
              row.name
                ? `${row.pipeline_name}: ${row.name}`
                : translate("reports.none.stage"),
          },
          ...shareColumns<(typeof data.by_stage)[number]>(),
        ]}
      />
    </div>
  );
};

// --- Money ---------------------------------------------------------------------

export const MoneyTab = ({ filters }: { filters: ReportFilters }) => {
  const translate = useTranslate();
  const money = useMoney();
  const { data, isPending, error } = useReport("money", filters);
  if (error) return <Failed error={error} />;
  if (isPending || !data) return <Loading />;

  const byDoctor = data.by_doctor ?? [];
  const topPaid = max(
    [...data.by_service, ...data.by_sales, ...byDoctor].map((row) =>
      Number(row.paid_amount),
    ),
  );
  const columns = (nameLabel: string, noneLabel: string) => [
    {
      label: nameLabel,
      render: (row: NamedRow & MoneyMetrics) => row.name ?? noneLabel,
    },
    {
      label: translate("reports.money.columns.agreed_deals"),
      numeric: true,
      render: (row: MoneyMetrics) => row.agreed_deals,
    },
    {
      label: translate("reports.money.columns.agreed_amount"),
      numeric: true,
      render: (row: MoneyMetrics) => money(row.agreed_amount),
      csv: (row: MoneyMetrics) => Number(row.agreed_amount),
    },
    {
      label: translate("reports.money.columns.paid_amount"),
      render: (row: MoneyMetrics) => money(row.paid_amount),
      csv: (row: MoneyMetrics) => Number(row.paid_amount),
      bar: (row: MoneyMetrics) => Number(row.paid_amount) / topPaid,
    },
    {
      label: translate("doctors.reports.prepaid_amount"),
      numeric: true,
      render: (row: MoneyMetrics) => money(row.prepaid_amount ?? 0),
      csv: (row: MoneyMetrics) => Number(row.prepaid_amount ?? 0),
    },
    {
      label: translate("reports.money.columns.paying_deals"),
      numeric: true,
      render: (row: MoneyMetrics) => row.paying_deals,
    },
    {
      label: translate("reports.money.columns.average_check"),
      numeric: true,
      render: (row: MoneyMetrics) => money(row.average_check),
      csv: (row: MoneyMetrics) =>
        row.average_check == null ? "" : Number(row.average_check),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={translate("reports.money.agreed")}
          value={money(data.totals.agreed_amount)}
          hint={translate("reports.money.agreed_hint", {
            smart_count: data.totals.agreed_deals,
          })}
        />
        <Stat
          label={translate("reports.money.paid")}
          value={money(data.totals.paid_amount)}
          hint={translate("reports.money.paying_hint", {
            smart_count: data.totals.paying_deals,
          })}
        />
        <Stat
          label={translate("reports.money.average_check")}
          value={money(data.totals.average_check)}
          hint={`${translate("doctors.reports.prepaid")}: ${money(
            data.totals.prepaid_amount ?? 0,
          )}`}
        />
        <Stat
          label={translate("reports.money.paid_share")}
          value={formatPercent(
            Number(data.totals.paid_amount),
            Number(data.totals.agreed_amount),
          )}
        />
      </div>
      <ReportTable
        title={translate("reports.money.by_service")}
        filename="money_by_service"
        rows={data.by_service}
        rowKey={(row) => String(row.id)}
        columns={columns(
          translate("reports.columns.service"),
          translate("reports.none.service"),
        )}
      />
      <ReportTable
        title={translate("reports.money.by_sales")}
        filename="money_by_employee"
        rows={data.by_sales}
        rowKey={(row) => String(row.id)}
        columns={columns(
          translate("reports.columns.employee"),
          translate("reports.none.employee"),
        )}
      />
      <ReportTable
        title={translate("doctors.reports.by_doctor")}
        filename="money_by_doctor"
        rows={byDoctor}
        rowKey={(row) => String(row.id)}
        columns={columns(
          translate("doctors.reports.column"),
          translate("doctors.reports.none"),
        )}
      />
    </div>
  );
};
