import {
  useCanAccess,
  useDataProvider,
  useGetIdentity,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { ArrowButton } from "../dashboard/StudioCards";
import { Molar3D, Sphere3D } from "../misc/Dental3D";
import { money } from "../payments/usePayments";
import type { CrmDataProvider } from "../providers/types";
import { exportCsv, type ReportColumn } from "../reports/csv";
import { EmployeeAvatar, HeatCalendar, MonthSwitcher } from "./PayrollParts";
import {
  shortDay,
  useEmployeeRole,
  useMonthParam,
  usePayrollMonth,
  useRefreshPayroll,
} from "./usePayroll";
import { employeeKey, monthLabel, monthTotals, topLines } from "./payrollMath";
import type { PayrollEmployee } from "./types";
import { CountUp } from "../misc/CountUp";

/**
 * «Зарплаты» (stage 39): a card per doctor and employee for the month —
 * works done, overdue plan stages, days off, the month's heat calendar, the
 * largest works and the total accrued; the month switcher, «Настроить
 * зарплаты» (the schemes), closing the month, CSV. The owner and the head.
 */
export const PayrollPage = () => {
  const translate = useTranslate();
  const { canAccess, isPending: rightsPending } = useCanAccess({
    resource: "payroll",
    action: "list",
  });
  const [month, setMonth] = useMonthParam();
  const { data, isPending, error } = usePayrollMonth(month);
  if (rightsPending) return null;
  if (!canAccess) return <Navigate to="/" replace />;
  const totals = data ? monthTotals(data) : null;
  return (
    <div className="flex flex-col gap-5" data-testid="payroll-page">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSwitcher
          month={month}
          onChange={setMonth}
          closed={data?.closed}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to={`/payroll/schemes?month=${month.slice(0, 7)}`}>
              {translate("payroll.actions.schemes")}
            </Link>
          </Button>
          {data ? <MonthActions month={month} closed={data.closed} /> : null}
          <Button
            variant="outline"
            disabled={!data?.employees.length}
            onClick={() =>
              data && exportSummary(data.employees, month, translate)
            }
          >
            {translate("payroll.actions.export")}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-[28px] bg-card p-6 text-sm text-tone-red">
          {(error as Error).message}
        </p>
      ) : null}

      {totals ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <section
            className="relative flex min-h-[13rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink lg:col-span-6"
            aria-label={translate("payroll.summary.accrued")}
          >
            <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
              {translate("payroll.summary.accrued")}
            </h2>
            <p className="mt-1 text-sm opacity-80">
              {monthLabel(month)} ·{" "}
              {translate("payroll.summary.employees", {
                smart_count: data!.employees.length,
              })}
            </p>
            <p
              className="mt-auto flex items-baseline gap-1.5 whitespace-nowrap"
              data-testid="payroll-total"
            >
              <span className="text-[52px] leading-none font-light tracking-[-0.04em] tabular-nums">
                <CountUp>{money(totals.accrued).replace(" ₸", "")}</CountUp>
              </span>
              <span className="text-lg font-light">₸</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-white/45 px-3 py-1.5">
                {translate("payroll.summary.paid_out")}: {money(totals.paidOut)}
              </span>
              <span className="rounded-full bg-white/45 px-3 py-1.5">
                {translate("payroll.summary.balance")}: {money(totals.balance)}
              </span>
            </div>
            <Molar3D className="pointer-events-none absolute -top-6 -right-4 size-40 opacity-95" />
          </section>
          <SummaryTile
            className="lg:col-span-3"
            label={translate("payroll.summary.works")}
            value={String(totals.works)}
          />
          <SummaryTile
            className="lg:col-span-3"
            label={translate("payroll.summary.balance")}
            value={money(totals.balance)}
            dark
          />
        </div>
      ) : null}

      {isPending ? (
        <p className="text-sm text-muted-foreground">
          {translate("ra.page.loading")}
        </p>
      ) : data && data.employees.length === 0 ? (
        <section className="relative flex min-h-[16rem] flex-col items-start justify-end overflow-hidden rounded-[28px] bg-card p-8">
          <Sphere3D size={150} className="pointer-events-none -top-6 right-8" />
          <p className="max-w-md text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("payroll.empty")}
          </p>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
          {data?.employees.map((employee) => (
            <EmployeeCard
              key={employeeKey(employee)}
              employee={employee}
              month={month}
            />
          ))}
        </div>
      )}
    </div>
  );
};

PayrollPage.path = "/payroll";

const SummaryTile = ({
  label,
  value,
  dark = false,
  className,
}: {
  label: string;
  value: string;
  dark?: boolean;
  className?: string;
}) => (
  <section
    className={cn(
      "flex min-h-[13rem] flex-col rounded-[28px] p-6",
      dark ? "bg-primary text-primary-foreground" : "bg-card",
      className,
    )}
    aria-label={label}
  >
    <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
      {label}
    </h2>
    <p className="mt-auto text-[40px] leading-none font-light tracking-[-0.04em] tabular-nums">
      <CountUp>{value}</CountUp>
    </p>
  </section>
);

/** «Закрыть месяц» (owner, head) / «Открыть месяц» (owner) */
const MonthActions = ({
  month,
  closed,
}: {
  month: string;
  closed: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshPayroll();
  const { data: identity } = useGetIdentity();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = identity?.role === "owner" || identity?.role == null;
  if (closed && !isOwner) return null;
  const run = async () => {
    setBusy(true);
    try {
      if (closed) {
        await dataProvider.reopenPayrollMonth(month);
        notify("payroll.notify.reopened", { type: "info" });
      } else {
        await dataProvider.closePayrollMonth(month);
        notify("payroll.notify.closed", { type: "info" });
      }
      setOpen(false);
      refresh();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };
  const label = monthLabel(month);
  return (
    <>
      <Button
        variant={closed ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
        {translate(closed ? "payroll.actions.reopen" : "payroll.actions.close")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-[28px]">
          <DialogHeader>
            <DialogTitle className="text-[22px] font-normal">
              {translate(
                closed
                  ? "payroll.confirm.reopen_title"
                  : "payroll.confirm.close_title",
                { month: label },
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                closed ? "payroll.confirm.reopen" : "payroll.confirm.close",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {translate("ra.action.cancel")}
            </Button>
            <Button onClick={run} disabled={busy} data-testid="payroll-confirm">
              {translate(
                closed ? "payroll.actions.reopen" : "payroll.actions.close",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** The card of a doctor (or an employee), like the reference «Зарплаты» */
const EmployeeCard = ({
  employee,
  month,
}: {
  employee: PayrollEmployee;
  month: string;
}) => {
  const translate = useTranslate();
  const role = useEmployeeRole();
  const top = topLines(employee.lines, 4);
  const others =
    employee.lines.filter((line) =>
      ["plan_item", "visit", "payment"].includes(line.source),
    ).length - top.length;
  const to = `/payroll/${employeeKey(employee)}?month=${month.slice(0, 7)}`;
  return (
    <section
      className="relative"
      aria-label={employee.name}
      data-testid="payroll-card"
    >
      <div className="notch flex h-full flex-col gap-5 rounded-[28px] bg-card p-6">
        <div className="flex items-center gap-4 pr-16">
          <EmployeeAvatar employee={employee} />
          <div className="min-w-0">
            <h2 className="truncate text-[22px] leading-tight font-normal tracking-[-0.02em]">
              {employee.name}
            </h2>
            <span className="mt-1 inline-flex rounded-full bg-muted px-3 py-1 text-xs">
              {role(employee)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {employee.kind === "doctor" ? (
            <>
              <Stat
                label={translate("payroll.card.works")}
                value={employee.works_count}
                testId="payroll-works"
              />
              <Stat
                label={translate("payroll.card.overdue")}
                value={employee.overdue_count}
                alert={employee.overdue_count > 0}
              />
              <Stat
                label={translate("payroll.card.days_off")}
                value={employee.days_off}
              />
            </>
          ) : (
            <>
              <Stat
                label={translate("payroll.card.payments")}
                value={
                  employee.lines.filter((line) => line.source === "payment")
                    .length
                }
              />
              <Stat
                label={translate("payroll.card.visits")}
                value={employee.visits_count}
              />
              <Stat
                label={translate("payroll.totals.fixed")}
                value={money(employee.fixed)}
              />
            </>
          )}
        </div>

        <HeatCalendar employee={employee} />

        <div className="flex flex-col gap-1.5">
          {top.length ? (
            top.map((line) => (
              <div
                key={`${line.source}${line.source_id}`}
                className="flex items-center gap-3 rounded-2xl bg-muted px-3 py-2 text-sm"
              >
                <span className="w-14 shrink-0 text-xs text-muted-foreground">
                  {shortDay(line.work_day)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {line.service_name ??
                    translate(`payroll.sources.${line.source}`)}
                  {line.patient_name ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {line.patient_name}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {money(line.accrued)}
                </span>
              </div>
            ))
          ) : (
            <p className="rounded-2xl bg-muted px-3 py-3 text-sm text-muted-foreground">
              {translate("payroll.card.no_works")}
            </p>
          )}
          {others > 0 ? (
            <Link
              to={to}
              className="px-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {translate("payroll.card.more", { smart_count: others })}
            </Link>
          ) : null}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-foreground/10 pt-4">
          <div>
            <p className="text-sm text-muted-foreground">
              {translate("payroll.card.total")}
            </p>
            <p
              className="text-[34px] leading-none font-light tracking-[-0.04em] tabular-nums"
              data-testid="payroll-accrued"
            >
              {money(employee.accrued)}
            </p>
          </div>
          <span className="rounded-full bg-neon px-3 py-1.5 text-xs font-semibold text-neon-ink">
            {translate("payroll.card.balance")}: {money(employee.balance)}
          </span>
        </div>
        {!employee.scheme ? (
          <p className="-mt-3 text-xs text-muted-foreground">
            {translate("payroll.card.no_scheme")}
          </p>
        ) : null}
      </div>
      <ArrowButton
        to={to}
        label={translate("payroll.actions.open_employee")}
        className="absolute top-0 right-0"
      />
    </section>
  );
};

const Stat = ({
  label,
  value,
  alert = false,
  testId,
}: {
  label: string;
  value: number | string;
  alert?: boolean;
  testId?: string;
}) => (
  <div
    className={cn(
      "flex flex-col justify-between gap-2 rounded-2xl px-3 py-2.5",
      alert ? "bg-tone-red/10" : "bg-muted",
    )}
  >
    <span className="text-[11px] leading-tight text-muted-foreground">
      {label}
    </span>
    <span
      className={cn(
        "text-2xl leading-none font-light tabular-nums",
        alert && "text-tone-red",
      )}
      data-testid={testId}
    >
      {value}
    </span>
  </div>
);

/** One row per employee: the month's totals */
const exportSummary = (
  employees: PayrollEmployee[],
  month: string,
  translate: (key: string, options?: object) => string,
) => {
  const columns: ReportColumn<PayrollEmployee>[] = [
    { label: translate("payroll.columns.employee"), render: (row) => row.name },
    {
      label: translate("payroll.columns.specialty"),
      render: (row) =>
        row.kind === "sales"
          ? translate(`payroll.roles.${row.specialty}`, {
              _: row.specialty ?? "",
            })
          : (row.specialty ?? ""),
    },
    {
      label: translate("payroll.card.works"),
      render: (row) => row.works_count,
    },
    {
      label: translate("payroll.totals.work_amount"),
      render: (row) => row.work_amount,
    },
    {
      label: translate("payroll.totals.materials"),
      render: (row) => row.materials,
    },
    {
      label: translate("payroll.totals.work_accrued"),
      render: (row) => row.work_accrued,
    },
    {
      label: translate("payroll.totals.visits"),
      render: (row) => row.visits_accrued,
    },
    { label: translate("payroll.totals.fixed"), render: (row) => row.fixed },
    {
      label: translate("payroll.totals.minimum"),
      render: (row) => row.minimum,
    },
    {
      label: translate("payroll.totals.bonuses"),
      render: (row) => row.bonuses,
    },
    {
      label: translate("payroll.totals.penalties"),
      render: (row) => row.penalties,
    },
    {
      label: translate("payroll.totals.accrued"),
      render: (row) => row.accrued,
    },
    {
      label: translate("payroll.totals.paid_out"),
      render: (row) => row.paid_out,
    },
    {
      label: translate("payroll.totals.balance"),
      render: (row) => row.balance,
    },
  ];
  return exportCsv(`zarplaty-${month.slice(0, 7)}.csv`, columns, employees);
};
