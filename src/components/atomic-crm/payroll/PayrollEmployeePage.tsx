import {
  useCanAccess,
  useCreate,
  useDataProvider,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { Implant3D } from "../misc/Dental3D";
import { Pills } from "../payments/PaymentDialog";
import { parseAmount } from "../payments/paymentMath";
import { EXPENSE_METHODS, type ExpenseMethod } from "../payments/types";
import { money, useRefreshMoney } from "../payments/usePayments";
import type { CrmDataProvider } from "../providers/types";
import type { ServiceCategory } from "../price-list/types";
import { exportCsv, type ReportColumn } from "../reports/csv";
import { todayKey } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import { EmployeeAvatar, HeatCalendar, MonthSwitcher } from "./PayrollParts";
import {
  shortDay,
  useEmployeeRole,
  useMonthParam,
  usePayrollMonth,
  useRefreshPayroll,
  useSchemeSummary,
} from "./usePayroll";
import { employeeKey, monthLabel, nextMonth } from "./payrollMath";
import type {
  AdjustmentKind,
  PayrollAdjustment,
  PayrollEmployee,
  PayrollLine,
} from "./types";
import { CountUp } from "../misc/CountUp";

/**
 * The payroll of one doctor or employee for a month: the scheme, the
 * totals, the calendar, every line (patient, work, date, amount, materials,
 * base, percent, accrued), bonuses, penalties and payouts, CSV.
 */
export const PayrollEmployeePage = () => {
  const translate = useTranslate();
  const { key = "" } = useParams();
  const { canAccess, isPending: rightsPending } = useCanAccess({
    resource: "payroll",
    action: "list",
  });
  const [month, setMonth] = useMonthParam();
  const { data, isPending } = usePayrollMonth(month);
  const role = useEmployeeRole();
  const summary = useSchemeSummary();
  const { data: categories = [] } = useGetList<ServiceCategory>(
    "service_categories",
    { pagination: { page: 1, perPage: 500 } },
  );
  const [adding, setAdding] = useState<AdjustmentKind | null>(null);
  if (rightsPending) return null;
  if (!canAccess) return <Navigate to="/" replace />;
  const employee = data?.employees.find((row) => employeeKey(row) === key);
  const categoryName = (id: unknown) =>
    categories.find((row) => String(row.id) === String(id))?.name ?? "—";

  return (
    <div className="flex flex-col gap-5" data-testid="payroll-employee">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline">
          <Link to={`/payroll?month=${month.slice(0, 7)}`}>
            ← {translate("payroll.actions.back")}
          </Link>
        </Button>
        <MonthSwitcher
          month={month}
          onChange={setMonth}
          closed={data?.closed}
        />
        {employee ? (
          <div className="ml-auto flex flex-wrap gap-2">
            {(["bonus", "penalty", "payout"] as const).map((kind) => (
              <Button
                key={kind}
                variant={kind === "payout" ? "default" : "outline"}
                disabled={data?.closed && kind !== "payout"}
                title={
                  data?.closed && kind !== "payout"
                    ? translate("payroll.adjustment.closed_hint")
                    : undefined
                }
                onClick={() => setAdding(kind)}
              >
                {translate(`payroll.actions.${kind}`)}
              </Button>
            ))}
            <Button
              variant="outline"
              disabled={!employee.lines.length}
              onClick={() => exportLines(employee, month, translate)}
            >
              {translate("payroll.actions.export")}
            </Button>
          </div>
        ) : null}
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">
          {translate("ra.page.loading")}
        </p>
      ) : !employee ? (
        <p className="rounded-[28px] bg-card p-6 text-sm text-muted-foreground">
          {translate("payroll.detail.not_found")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <section className="flex flex-col gap-5 rounded-[28px] bg-card p-6 lg:col-span-7">
              <div className="flex items-center gap-4">
                <EmployeeAvatar
                  employee={employee}
                  className="size-20 text-2xl"
                />
                <div className="min-w-0">
                  <h2 className="text-[30px] leading-tight font-normal tracking-[-0.03em]">
                    {employee.name}
                  </h2>
                  <span className="mt-1 inline-flex rounded-full bg-muted px-3 py-1 text-xs">
                    {role(employee)}
                  </span>
                </div>
              </div>
              <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
                <span className="text-muted-foreground">
                  {translate("payroll.detail.scheme")}:{" "}
                </span>
                {summary(employee.scheme, categoryName)}
                {employee.scheme ? (
                  <span className="text-muted-foreground">
                    {" "}
                    ·{" "}
                    {translate("payroll.schemes.from", {
                      date: shortDay(
                        employee.scheme.effective_from.slice(0, 10),
                      ),
                    })}
                  </span>
                ) : null}{" "}
                <Link
                  to={`/payroll/schemes?month=${month.slice(0, 7)}`}
                  className="underline underline-offset-2"
                >
                  {translate("payroll.actions.schemes")}
                </Link>
              </div>
              <Totals employee={employee} />
            </section>
            <section className="flex flex-col gap-4 rounded-[28px] bg-card p-6 lg:col-span-5">
              <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
                {monthLabel(month)}
              </h2>
              <div className="flex flex-wrap gap-2 text-xs">
                {employee.kind === "doctor" ? (
                  <>
                    <Chip>
                      {translate("payroll.card.works")}: {employee.works_count}
                    </Chip>
                    <Chip alert={employee.overdue_count > 0}>
                      {translate("payroll.card.overdue")}:{" "}
                      {employee.overdue_count}
                    </Chip>
                    <Chip>
                      {translate("payroll.card.days_off")}: {employee.days_off}
                    </Chip>
                  </>
                ) : null}
              </div>
              <HeatCalendar employee={employee} large />
            </section>
          </div>

          <StudioCard
            title={translate("payroll.detail.lines")}
            subtitle={translate("payroll.detail.lines_hint")}
          >
            <LinesTable lines={employee.lines} />
          </StudioCard>

          <Adjustments employee={employee} closed={!!data?.closed} />
        </>
      )}
      {employee && adding ? (
        <AdjustmentDialog
          kind={adding}
          employee={employee}
          month={month}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </div>
  );
};

PayrollEmployeePage.path = "/payroll/:key";

const Chip = ({
  children,
  alert = false,
}: {
  children: React.ReactNode;
  alert?: boolean;
}) => (
  <span
    className={cn(
      "rounded-full px-3 py-1.5",
      alert ? "bg-tone-red/10 text-tone-red" : "bg-muted",
    )}
  >
    {children}
  </span>
);

const Totals = ({ employee }: { employee: PayrollEmployee }) => {
  const translate = useTranslate();
  const rows: [string, number, boolean?][] = [
    ["work_amount", employee.work_amount],
    ["materials", employee.materials],
    ["work_accrued", employee.work_accrued],
    ["visits", employee.visits_accrued],
    ["fixed", employee.fixed],
    ["minimum", employee.minimum],
    ["bonuses", employee.bonuses],
    ["penalties", employee.penalties],
    ["paid_out", employee.paid_out],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {rows.map(([key, value]) => (
          <div key={key} className="rounded-2xl bg-muted px-3 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              {translate(`payroll.totals.${key}`)}
            </p>
            <p className="text-lg font-light tabular-nums">{money(value)}</p>
          </div>
        ))}
      </div>
      <div className="relative flex items-end justify-between gap-3 overflow-hidden rounded-[22px] bg-neon p-4 text-neon-ink">
        <div>
          <p className="text-sm">{translate("payroll.totals.accrued")}</p>
          <p
            className="text-[40px] leading-none font-light tracking-[-0.04em] tabular-nums"
            data-testid="payroll-employee-accrued"
          >
            <CountUp>{money(employee.accrued)}</CountUp>
          </p>
        </div>
        <div className="relative z-10 text-right">
          <p className="text-sm">{translate("payroll.totals.balance")}</p>
          <p
            className="text-2xl font-light tabular-nums"
            data-testid="payroll-employee-balance"
          >
            {money(employee.balance)}
          </p>
        </div>
        <Implant3D className="pointer-events-none absolute -bottom-8 left-1/2 size-28 opacity-60" />
      </div>
    </div>
  );
};

const useLineColumns = (): ReportColumn<PayrollLine>[] => {
  const translate = useTranslate();
  return [
    {
      label: translate("payroll.columns.date"),
      render: (line) => shortDay(line.work_day),
      csv: (line) => line.work_day ?? "",
    },
    {
      label: translate("payroll.columns.source"),
      render: (line) => translate(`payroll.sources.${line.source}`),
    },
    {
      label: translate("payroll.columns.patient"),
      render: (line) => line.patient_name ?? "",
    },
    {
      label: translate("payroll.columns.service"),
      render: (line) => line.service_name ?? "",
    },
    {
      label: translate("payroll.columns.category"),
      render: (line) => line.category_name ?? "",
    },
    {
      label: translate("payroll.columns.amount"),
      render: (line) => money(line.amount),
      csv: (line) => line.amount,
      numeric: true,
    },
    {
      label: translate("payroll.columns.materials"),
      render: (line) => (line.materials ? money(line.materials) : ""),
      csv: (line) => line.materials,
      numeric: true,
    },
    {
      label: translate("payroll.columns.base"),
      render: (line) => money(line.base),
      csv: (line) => line.base,
      numeric: true,
    },
    {
      label: translate("payroll.columns.percent"),
      render: (line) =>
        line.percent != null ? `${Number(line.percent)} %` : "",
      csv: (line) => (line.percent != null ? Number(line.percent) : ""),
      numeric: true,
    },
    {
      label: translate("payroll.columns.accrued"),
      render: (line) => money(line.accrued),
      csv: (line) => line.accrued,
      numeric: true,
    },
  ];
};

const LinesTable = ({ lines }: { lines: PayrollLine[] }) => {
  const translate = useTranslate();
  const columns = useLineColumns();
  if (!lines.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("payroll.detail.no_lines")}
      </p>
    );
  }
  const total = lines.reduce((sum, line) => sum + line.accrued, 0);
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[56rem] text-sm"
        data-testid="payroll-lines"
      >
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.label}
                className={cn(
                  "px-3 py-2 font-normal",
                  column.numeric && "text-right",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={`${line.source}${line.source_id ?? ""}`}
              className="border-t border-foreground/5"
            >
              {columns.map((column) => (
                <td
                  key={column.label}
                  className={cn(
                    "px-3 py-2",
                    column.numeric && "text-right tabular-nums",
                  )}
                >
                  {column.render(line)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-foreground/15 font-medium">
            <td className="px-3 py-3" colSpan={columns.length - 1}>
              {translate("payroll.card.total")}
            </td>
            <td className="px-3 py-3 text-right tabular-nums">
              {money(total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

const Adjustments = ({
  employee,
  closed,
}: {
  employee: PayrollEmployee;
  closed: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPayroll();
  const refreshMoney = useRefreshMoney();
  const [remove] = useDelete();
  return (
    <StudioCard title={translate("payroll.detail.adjustments")}>
      {employee.adjustments.length ? (
        <ul className="flex flex-col gap-1.5" data-testid="payroll-adjustments">
          {employee.adjustments.map((row: PayrollAdjustment) => (
            <li
              key={row.id}
              className="flex items-center gap-3 rounded-2xl bg-muted px-3 py-2 text-sm"
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {shortDay(row.occurred_on)}
              </span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs",
                  row.kind === "bonus"
                    ? "bg-neon text-neon-ink"
                    : row.kind === "penalty"
                      ? "bg-tone-red/15 text-tone-red"
                      : "bg-primary text-primary-foreground",
                )}
              >
                {translate(`payroll.kinds.${row.kind}`)}
              </span>
              {row.account_operation_id != null ? (
                <span
                  className="rounded-full bg-card px-2.5 py-0.5 text-xs"
                  title={translate("cash_out.payout.locked")}
                >
                  {translate("cash_out.payout.in_cash")}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.note}
              </span>
              <span className="font-medium tabular-nums">
                {row.kind === "penalty" ? "−" : ""}
                {money(row.amount)}
              </span>
              {!closed || row.kind === "payout" ? (
                <button
                  type="button"
                  className="rounded-full px-2 text-muted-foreground hover:text-foreground"
                  aria-label={translate("ra.action.delete")}
                  title={translate("ra.action.delete")}
                  onClick={() => {
                    if (
                      row.account_operation_id != null &&
                      !window.confirm(translate("cash_out.payout.locked"))
                    ) {
                      return;
                    }
                    remove(
                      "payroll_adjustments",
                      { id: row.id, previousData: row },
                      {
                        mutationMode: "pessimistic",
                        onSuccess: () => {
                          notify("payroll.notify.deleted", { type: "info" });
                          refresh();
                          refreshMoney();
                        },
                        onError: (error) =>
                          notify(
                            (error as Error)?.message ||
                              "ra.notification.http_error",
                            { type: "error" },
                          ),
                      },
                    );
                  }}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("payroll.detail.no_adjustments")}
        </p>
      )}
    </StudioCard>
  );
};

/** «Премия», «Штраф», «Выплата» of the month */
const AdjustmentDialog = ({
  kind,
  employee,
  month,
  onClose,
}: {
  kind: AdjustmentKind;
  employee: PayrollEmployee;
  month: string;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPayroll();
  const timeZone = useClinicTimeZone();
  const today = todayKey(timeZone);
  const inMonth = today >= month && today < nextMonth(month);
  const [amount, setAmount] = useState(
    kind === "payout" && employee.balance > 0 ? String(employee.balance) : "",
  );
  const [day, setDay] = useState(inMonth || kind === "payout" ? today : month);
  const [note, setNote] = useState("");
  const [create, { isPending }] = useCreate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refreshMoney = useRefreshMoney();
  // A payout: from the cash desk (an expense «Зарплата») or by transfer
  const [fromCash, setFromCash] = useState(false);
  const [method, setMethod] = useState<ExpenseMethod>("cash");
  const [paying, setPaying] = useState(false);
  const value = parseAmount(amount);
  const payout = async () => {
    setPaying(true);
    try {
      await dataProvider.recordPayrollPayout({
        doctor_id: employee.doctor_id,
        sales_id: employee.sales_id,
        month,
        amount: value,
        day,
        note: note.trim() || null,
        fromCash,
        method,
      });
      notify(fromCash ? "cash_out.payout.done_cash" : "cash_out.payout.done", {
        type: "info",
      });
      refresh();
      refreshMoney();
      onClose();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    } finally {
      setPaying(false);
    }
  };
  const save = () => {
    if (!value || value <= 0) return;
    if (kind === "payout") {
      void payout();
      return;
    }
    create(
      "payroll_adjustments",
      {
        data: {
          doctor_id: employee.doctor_id,
          sales_id: employee.sales_id,
          month,
          kind,
          amount: value,
          occurred_on: day,
          note: note.trim() || null,
        },
      },
      {
        onSuccess: () => {
          notify("payroll.notify.saved", { type: "info" });
          refresh();
          onClose();
        },
        onError: (error) =>
          notify((error as Error)?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rounded-[28px]">
        <DialogHeader>
          <DialogTitle className="text-[22px] font-normal">
            {translate(`payroll.kinds.${kind}`)} · {employee.name}
          </DialogTitle>
          <DialogDescription>{monthLabel(month)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payroll.adjustment.amount")}
            </span>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              autoFocus
              aria-label={translate("payroll.adjustment.amount")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payroll.adjustment.date")}
            </span>
            <Input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value || today)}
              aria-label={translate("payroll.adjustment.date")}
            />
          </label>
          {kind === "payout" ? (
            <div
              className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-3"
              data-testid="payout-cash"
            >
              <Pills
                label={translate("cash_out.payout.title")}
                value={fromCash ? "cash" : "bank"}
                options={[
                  {
                    value: "bank",
                    label: translate("cash_out.payout.bank"),
                  },
                  {
                    value: "cash",
                    label: translate("cash_out.payout.from_cash"),
                  },
                ]}
                onChange={(next) => setFromCash(next === "cash")}
              />
              {fromCash ? (
                <>
                  <Pills
                    label={translate("cash_out.payout.method")}
                    value={method}
                    options={EXPENSE_METHODS.map((option) => ({
                      value: option,
                      label: translate(`payments.methods.${option}`),
                    }))}
                    onChange={(next) => setMethod(next as ExpenseMethod)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {translate("cash_out.payout.from_cash_hint")}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payroll.adjustment.note")}
            </span>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label={translate("payroll.adjustment.note")}
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {translate("ra.action.cancel")}
            </Button>
            <Button
              onClick={save}
              disabled={isPending || paying || !value || value <= 0}
              data-testid="payroll-adjustment-save"
            >
              {kind === "payout" && fromCash
                ? translate("cash_out.payout.from_cash")
                : translate("payroll.adjustment.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const exportLines = (
  employee: PayrollEmployee,
  month: string,
  translate: (key: string, options?: object) => string,
) => {
  const columns: ReportColumn<PayrollLine>[] = [
    {
      label: translate("payroll.columns.date"),
      render: (line) => line.work_day ?? "",
    },
    {
      label: translate("payroll.columns.source"),
      render: (line) => translate(`payroll.sources.${line.source}`),
    },
    {
      label: translate("payroll.columns.patient"),
      render: (line) => line.patient_name ?? "",
    },
    {
      label: translate("payroll.columns.service"),
      render: (line) => line.service_name ?? "",
    },
    {
      label: translate("payroll.columns.category"),
      render: (line) => line.category_name ?? "",
    },
    {
      label: translate("payroll.columns.amount"),
      render: (line) => line.amount,
    },
    {
      label: translate("payroll.columns.materials"),
      render: (line) => line.materials,
    },
    { label: translate("payroll.columns.base"), render: (line) => line.base },
    {
      label: translate("payroll.columns.percent"),
      render: (line) => (line.percent != null ? Number(line.percent) : ""),
    },
    {
      label: translate("payroll.columns.accrued"),
      render: (line) => line.accrued,
    },
  ];
  const slug = employee.name.replace(/\s+/g, "-").toLowerCase();
  return exportCsv(
    `zarplata-${slug}-${month.slice(0, 7)}.csv`,
    columns,
    employee.lines,
  );
};
