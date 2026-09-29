import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useStore, useTranslate } from "ra-core";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { useCurrentBranch } from "../branches/useBranches";
import { StudioCard } from "../dashboard/StudioCards";
import { Molar3D } from "../misc/Dental3D";
import type { CrmDataProvider } from "../providers/types";
import { PillTabs } from "./LabBits";
import { localDay, shortDay, tenge } from "./labMath";
import { qualityRange, type QualityPeriod } from "./labPlusMath";
import type { LabQualityReport, LabQualityRow } from "./types";
import { CountUp } from "../misc/CountUp";

const PERIODS: QualityPeriod[] = ["30d", "90d", "month", "last_month"];

/**
 * «Качество» (owner, head; stage 43): for a period and the branch of the
 * top bar — on time, lead time, remakes and their reasons, overdue now and
 * the cost, per lab, per technician and per doctor
 * (public.report_lab_quality; the demo: labQuality()).
 */
export const LabQuality = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { currentId } = useCurrentBranch();
  const [period, setPeriod] = useStore<QualityPeriod>(
    "lab.quality.period",
    "90d",
  );
  const today = localDay();
  const range = qualityRange(period, today);
  const { data: report, isPending } = useQuery({
    queryKey: ["lab_quality", range.from, range.to, currentId ?? null],
    queryFn: () =>
      dataProvider.getLabQualityReport({
        from: range.from,
        to: range.to,
        branch_id: currentId ?? null,
      }),
  });

  return (
    <div className="flex flex-col gap-5" data-testid="lab-quality">
      <div className="flex flex-wrap items-center gap-3">
        <PillTabs
          size="sm"
          label={translate("lab_plus.quality.period")}
          value={period}
          onChange={setPeriod}
          options={PERIODS.map((value) => ({
            value,
            label: translate(`lab_plus.quality.periods.${value}`),
          }))}
        />
        <span className="text-sm text-muted-foreground">
          {shortDay(range.from, true)} — {shortDay(range.to, true)}
        </span>
      </div>
      {isPending || !report ? null : <QualityBody report={report} />}
    </div>
  );
};

const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${value}%`;

const QualityBody = ({ report }: { report: LabQualityReport }) => {
  const translate = useTranslate();
  const totals = report.totals;
  const maxReason = Math.max(1, ...report.reasons.map((r) => r.count));
  return (
    <>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <section
          className="relative flex min-h-[13rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink"
          aria-label={translate("lab_plus.quality.on_time")}
        >
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("lab_plus.quality.on_time")}
          </h2>
          <p className="mt-1 text-sm opacity-80">
            {translate("lab_plus.quality.on_time_hint", {
              count: totals.ready_with_due,
            })}
          </p>
          <p
            className="mt-auto text-[56px] leading-none font-light tracking-[-0.04em] tabular-nums"
            data-testid="lab-quality-on-time"
          >
            <CountUp>{pct(totals.on_time_pct)}</CountUp>
          </p>
          <Molar3D className="pointer-events-none absolute -top-3 -right-5 size-32 opacity-90" />
        </section>
        <Kpi
          title={translate("lab_plus.quality.lead")}
          hint={translate("lab_plus.quality.lead_hint")}
          value={
            totals.avg_lead_days == null
              ? "—"
              : translate("lab_plus.quality.days", {
                  value: String(totals.avg_lead_days).replace(".", ","),
                })
          }
        />
        <Kpi
          title={translate("lab_plus.quality.remakes")}
          hint={translate("lab_plus.quality.remakes_hint", {
            count: totals.remakes,
          })}
          value={pct(totals.remake_rate)}
          testId="lab-quality-remakes"
        >
          <div className="flex flex-wrap gap-1.5 text-xs">
            {(["lab", "clinic", "patient"] as const).map((fault) => (
              <span key={fault} className="rounded-full bg-muted px-2.5 py-1">
                {translate(`lab_plus.faults.${fault}`)}:{" "}
                {totals[`${fault}_fault`]}
              </span>
            ))}
            {totals.warranty ? (
              <span className="rounded-full bg-neon-soft px-2.5 py-1">
                {translate("lab_plus.remake.by_warranty")}: {totals.warranty}
              </span>
            ) : null}
          </div>
        </Kpi>
        <Kpi
          title={translate("lab_plus.quality.overdue")}
          hint={translate("lab_plus.quality.overdue_hint")}
          value={String(totals.overdue_now)}
          alert={totals.overdue_now > 0}
        />
      </div>

      <QualityTable
        title={translate("lab_plus.quality.labs")}
        rows={report.labs}
        testId="lab-quality-labs"
      />
      <QualityTable
        title={translate("lab_plus.quality.technicians")}
        rows={report.technicians}
        testId="lab-quality-technicians"
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <StudioCard
          title={translate("lab_plus.quality.doctors")}
          subtitle={translate("lab_plus.quality.doctors_hint")}
          className="lg:col-span-7"
        >
          {report.doctors.length ? (
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="lab-quality-doctors"
              >
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-normal">
                      {translate("lab.fields.doctor")}
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      {translate("lab_plus.quality.orders")}
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      {translate("lab_plus.quality.remakes")}
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      {translate("lab_plus.quality.remake_rate")}
                    </th>
                    <th className="px-3 py-2 text-right font-normal">
                      {translate("lab_plus.quality.clinic_fault")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.doctors.map((row) => (
                    <tr
                      key={String(row.id)}
                      className="border-t border-border/50"
                    >
                      <td className="px-3 py-2">{row.name ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.orders}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.remakes}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {pct(row.remake_rate)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.clinic_fault + row.patient_fault}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty />
          )}
        </StudioCard>
        <StudioCard
          title={translate("lab_plus.quality.reasons")}
          subtitle={translate("lab_plus.quality.reasons_hint")}
          className="lg:col-span-5"
        >
          {report.reasons.length ? (
            <ul
              className="flex flex-col gap-2.5"
              data-testid="lab-quality-reasons"
            >
              {report.reasons.map((reason, index) => (
                <li
                  key={reason.reason ?? "none"}
                  className="flex items-center gap-3"
                >
                  <span className="w-36 shrink-0 truncate text-sm">
                    {reason.reason ?? translate("lab_plus.remake.no_reason")}
                  </span>
                  <span className="relative h-9 flex-1 overflow-hidden rounded-xl bg-muted">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-xl",
                        index === 0
                          ? "hatch border border-foreground/15 bg-pill"
                          : "bg-pill",
                      )}
                      style={{
                        width: `${Math.max((reason.count / maxReason) * 100, 8)}%`,
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm tabular-nums">
                      {reason.count}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </StudioCard>
      </div>
    </>
  );
};

const Kpi = ({
  title,
  hint,
  value,
  alert,
  testId,
  children,
}: {
  title: string;
  hint: string;
  value: string;
  alert?: boolean;
  testId?: string;
  children?: ReactNode;
}) => (
  <section
    className="flex min-h-[13rem] flex-col rounded-[28px] bg-card p-6"
    aria-label={title}
  >
    <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
      {title}
    </h2>
    <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    <p
      className={cn(
        "mt-auto text-[48px] leading-none font-light tracking-[-0.04em] tabular-nums",
        alert && "text-tone-red",
      )}
      data-testid={testId}
    >
      <CountUp>{value}</CountUp>
    </p>
    {children ? <div className="mt-3">{children}</div> : null}
  </section>
);

const Empty = () => {
  const translate = useTranslate();
  return (
    <p className="text-sm text-muted-foreground">
      {translate("lab_plus.quality.empty")}
    </p>
  );
};

/** A lab or a technician per row: orders, on time, lead, remakes, cost */
const QualityTable = ({
  title,
  rows,
  testId,
}: {
  title: string;
  rows: LabQualityRow[];
  testId: string;
}) => {
  const translate = useTranslate();
  const headers = [
    translate("lab_plus.quality.orders"),
    translate("lab_plus.quality.ready"),
    translate("lab_plus.quality.on_time"),
    translate("lab_plus.quality.lead_short"),
    translate("lab_plus.quality.remakes"),
    translate("lab_plus.quality.remake_rate"),
    translate("lab_plus.quality.overdue"),
    translate("lab_plus.quality.cost"),
  ];
  return (
    <StudioCard
      title={title}
      subtitle={translate("lab_plus.quality.table_hint")}
    >
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid={testId}>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-normal">{title}</th>
                {headers.map((header) => (
                  <th key={header} className="px-3 py-2 text-right font-normal">
                    {header}
                  </th>
                ))}
                <th className="px-3 py-2 font-normal">
                  {translate("lab_plus.quality.reasons")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} className="border-t border-border/50">
                  <td className="px-3 py-2">{row.name ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.orders}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.ready}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      row.on_time_pct != null &&
                        row.on_time_pct < 80 &&
                        "text-tone-red",
                    )}
                  >
                    {pct(row.on_time_pct)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.avg_lead_days == null
                      ? "—"
                      : String(row.avg_lead_days).replace(".", ",")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.remakes}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pct(row.remake_rate)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      row.overdue_now > 0 && "text-tone-red",
                    )}
                  >
                    {row.overdue_now}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {tenge(row.cost)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.reasons
                      .map(
                        (reason) =>
                          `${reason.reason ?? translate("lab_plus.remake.no_reason")} × ${reason.count}`,
                      )
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty />
      )}
    </StudioCard>
  );
};
