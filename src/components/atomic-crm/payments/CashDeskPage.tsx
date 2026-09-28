import {
  useCreate,
  useDataProvider,
  useGetList,
  useNotify,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router";
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

import { useBranches } from "../branches/useBranches";
import { StudioCard } from "../dashboard/StudioCards";
import { Implant3D } from "../misc/Dental3D";
import type { CrmDataProvider } from "../providers/types";
import { exportCsv, type ReportColumn } from "../reports/csv";
import type { Sale } from "../types";
import { OperationsList } from "./OperationsList";
import { useMethodLabel } from "./operationFormat";
import { NativeSelect, PaymentDialog, Pills } from "./PaymentDialog";
import { daysSince, parseAmount, tillTotals } from "./paymentMath";
import {
  PAYMENT_METHODS,
  type AccountOperationSummary,
  type CashShift,
  type PatientAccount,
} from "./types";
import { money, usePaymentRights, useRefreshMoney } from "./usePayments";

const TABS = ["day", "debtors", "shifts"] as const;
type Tab = (typeof TABS)[number];
const ALL = "all";

const pad = (n: number) => String(n).padStart(2, "0");
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const dayRange = (day: string) => {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
};
const clock = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const fullName = (sale?: Pick<Sale, "first_name" | "last_name">) =>
  sale ? [sale.first_name, sale.last_name].filter(Boolean).join(" ") : "";

/**
 * «Касса» (stage 36): the day's operations by method with the totals, the
 * cashier's shift (open with the cash at start, close with the cash counted
 * against the cash expected), the debtors and the shifts; filters cashier,
 * branch, date; CSV export. The whole clinic: owner, head and employees
 * with the «Отчёты» right; a cashier without it works with their own
 * operations and shift.
 */
export const CashDeskPage = () => {
  const translate = useTranslate();
  const rights = usePaymentRights();
  const [tab, setTab] = useStore<Tab>("cash_desk.tab", "day");
  if (rights.isPending) return null;
  if (!rights.canAccept) return <Navigate to="/" replace />;
  return (
    <div className="flex flex-col gap-5" data-testid="cash-desk">
      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "h-11 rounded-full px-5 text-sm transition-colors",
              tab === value
                ? "bg-primary text-primary-foreground"
                : "bg-card hover:bg-pill",
            )}
          >
            {translate(`payments.desk.tabs.${value}`)}
          </button>
        ))}
      </div>
      {tab === "debtors" ? (
        <DebtorsTab />
      ) : tab === "shifts" ? (
        <ShiftsTab />
      ) : (
        <DayTab />
      )}
    </div>
  );
};

CashDeskPage.path = "/cash";

const DayTab = () => {
  const translate = useTranslate();
  const rights = usePaymentRights();
  const { branches, enabled: branchesOn } = useBranches();
  const [day, setDay] = useState(today);
  const [cashier, setCashier] = useState<string>(ALL);
  const [branch, setBranch] = useState<string>(ALL);
  const methodLabel = useMethodLabel();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  const range = dayRange(day);
  // Without the «Отчёты» right: the cashier's own operations
  const salesFilter = rights.seesAll
    ? cashier === ALL
      ? {}
      : { sales_id: cashier }
    : { sales_id: rights.me };
  const { data: operations = [], isPending } =
    useGetList<AccountOperationSummary>("account_operations_summary", {
      filter: {
        "occurred_at@gte": range.from,
        "occurred_at@lt": range.to,
        ...salesFilter,
        ...(branch === ALL ? {} : { branch_id: branch }),
      },
      sort: { field: "occurred_at", order: "DESC" },
      pagination: { page: 1, perPage: 1000 },
    });
  const { byMethod, total } = useMemo(
    () => tillTotals(operations),
    [operations],
  );
  const max = Math.max(1, ...PAYMENT_METHODS.map((m) => byMethod[m].income));
  const peak = PAYMENT_METHODS.reduce((best, m) =>
    byMethod[m].income > byMethod[best].income ? m : best,
  );

  const columns: ReportColumn<AccountOperationSummary>[] = [
    {
      label: translate("payments.desk.columns.time"),
      render: (op) => clock(op.occurred_at),
      csv: (op) => new Date(op.occurred_at).toLocaleString("ru-RU"),
    },
    {
      label: translate("payments.desk.columns.patient"),
      render: (op) => op.patient_name ?? "",
    },
    {
      label: translate("payments.desk.columns.kind"),
      render: (op) => translate(`payments.kinds.${op.kind}`),
    },
    {
      label: translate("payments.desk.columns.method"),
      render: (op) => methodLabel(op),
    },
    {
      label: translate("payments.desk.columns.amount"),
      render: (op) => money(op.amount),
      csv: (op) => op.amount,
    },
    {
      label: translate("payments.desk.columns.till"),
      render: (op) => money(op.till_delta ?? 0),
      csv: (op) => op.till_delta ?? 0,
    },
    {
      label: translate("payments.desk.columns.deal"),
      render: (op) => op.deal_name ?? "",
    },
    {
      label: translate("payments.desk.columns.cashier"),
      render: (op) => op.cashier_name ?? "",
    },
    {
      label: translate("payments.desk.columns.branch"),
      render: (op) => op.branch_name ?? "",
    },
    {
      label: translate("payments.desk.columns.comment"),
      render: (op) => op.comment ?? "",
    },
  ];

  const [value, unit] = [money(total.net).replace(" ₸", ""), "₸"];
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("payments.desk.date")}
          </span>
          <Input
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value || today())}
            className="w-44"
            aria-label={translate("payments.desk.date")}
          />
        </label>
        {rights.seesAll ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payments.desk.cashier")}
            </span>
            <NativeSelect
              value={cashier}
              onChange={setCashier}
              aria-label={translate("payments.desk.cashier")}
            >
              <option value={ALL}>{translate("payments.desk.all")}</option>
              {sales.map((sale) => (
                <option key={sale.id} value={String(sale.id)}>
                  {fullName(sale)}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {branchesOn ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payments.desk.branch")}
            </span>
            <NativeSelect
              value={branch}
              onChange={setBranch}
              aria-label={translate("payments.desk.branch")}
            >
              <option value={ALL}>{translate("payments.desk.all")}</option>
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        <Button
          variant="outline"
          className="ml-auto"
          disabled={!operations.length}
          onClick={() =>
            exportCsv(`kassa-${day}.csv`, columns, [...operations].reverse())
          }
        >
          {translate("payments.desk.export")}
        </Button>
      </div>
      {!rights.seesAll ? (
        <p className="-mt-2 text-sm text-muted-foreground">
          {translate("payments.desk.own_only")}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section
          className="relative flex min-h-[15rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink lg:col-span-4"
          aria-label={translate("payments.desk.net")}
        >
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("payments.desk.net")}
          </h2>
          <p className="mt-1 text-sm opacity-80">
            {translate("payments.desk.operations_count", {
              count: total.count,
            })}
          </p>
          <p
            className="mt-auto flex items-baseline gap-1.5 whitespace-nowrap"
            data-testid="cash-net"
          >
            <span className="text-[52px] leading-none font-light tracking-[-0.04em] tabular-nums">
              {value}
            </span>
            <span className="text-lg font-light">{unit}</span>
          </p>
          <div className="mt-4 flex gap-2 text-sm">
            <span className="rounded-full bg-white/45 px-3 py-1.5">
              {translate("payments.desk.income")}: {money(total.income)}
            </span>
            <span className="rounded-full bg-white/45 px-3 py-1.5">
              {translate("payments.desk.refunds")}: {money(total.refunds)}
            </span>
          </div>
          <Implant3D className="pointer-events-none absolute -top-4 -right-6 size-36 opacity-90" />
        </section>

        <StudioCard
          title={translate("payments.desk.by_method")}
          subtitle={translate("payments.desk.by_method_hint")}
          className="lg:col-span-5"
        >
          <ul className="flex flex-col gap-2.5" data-testid="cash-by-method">
            {PAYMENT_METHODS.map((method) => {
              const line = byMethod[method];
              const share = line.income / max;
              const highlighted = method === peak && line.income > 0;
              return (
                <li key={method} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">
                    {translate(`payments.methods.${method}`)}
                  </span>
                  <span className="relative h-9 flex-1 overflow-hidden rounded-xl bg-muted">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-xl",
                        highlighted
                          ? "hatch border border-foreground/15 bg-pill"
                          : "bg-pill",
                      )}
                      style={{
                        width: `${line.income ? Math.max(share * 100, 6) : 0}%`,
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm tabular-nums">
                      {money(line.income)}
                      {line.refunds ? (
                        <span className="ml-2 text-xs text-tone-red">
                          −{money(line.refunds)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {highlighted ? (
                    <span className="rounded-lg bg-neon px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-neon-ink">
                      {Math.round(
                        (line.income / Math.max(1, total.income)) * 100,
                      )}
                      %
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </StudioCard>

        <ShiftCard className="lg:col-span-3" />
      </div>

      <StudioCard
        title={translate("payments.desk.operations")}
        subtitle={new Date(`${day}T00:00:00`).toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      >
        {isPending ? null : (
          <OperationsList
            operations={operations}
            showPatient
            empty={translate("payments.desk.no_operations")}
          />
        )}
      </StudioCard>
    </>
  );
};

/** The cashier's shift: open with the cash at start, close with the count */
const ShiftCard = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const rights = usePaymentRights();
  const refresh = useRefreshMoney();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { branches, enabled: branchesOn } = useBranches();
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [cashText, setCashText] = useState("");
  const [branchId, setBranchId] = useState<string>("");
  const [note, setNote] = useState("");
  const { data: shifts = [] } = useGetList<CashShift>(
    "cash_shifts",
    {
      filter: { sales_id: rights.me },
      pagination: { page: 1, perPage: 20 },
      sort: { field: "opened_at", order: "DESC" },
    },
    { enabled: rights.me != null },
  );
  const shift = shifts.find((s) => !s.closed_at);
  const { data: expected, refetch } = useQuery({
    queryKey: ["cash_shifts", "expected", shift?.id],
    queryFn: () => dataProvider.cashShiftExpected(shift!.id),
    enabled: shift != null,
  });
  const counted = parseAmount(cashText);

  const open = async () => {
    try {
      await dataProvider.openCashShift(
        parseAmount(cashText),
        branchId ? branchId : null,
      );
      notify("payments.shift.opened_ok", { type: "info" });
      setOpening(false);
      setCashText("");
      refresh();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    }
  };
  const close = async () => {
    if (!shift) return;
    try {
      const result = await dataProvider.closeCashShift(
        shift.id,
        counted,
        note.trim() || null,
      );
      notify("payments.shift.closed_ok", {
        type: "info",
        messageArgs: { amount: money(result.discrepancy) },
      });
      setClosing(false);
      setCashText("");
      setNote("");
      refresh();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    }
  };

  return (
    <StudioCard
      title={translate("payments.shift.title")}
      subtitle={
        shift
          ? translate("payments.shift.opened", { time: clock(shift.opened_at) })
          : translate("payments.shift.none")
      }
      className={className}
    >
      {shift ? (
        <div className="flex flex-1 flex-col gap-3" data-testid="shift-open">
          <Row
            label={translate("payments.shift.opening_cash")}
            value={money(shift.opening_cash)}
          />
          <p className="text-sm text-muted-foreground">
            {translate("payments.shift.expected")}
          </p>
          <p className="text-[36px] leading-none font-light tracking-[-0.04em] tabular-nums">
            {money(expected ?? shift.opening_cash)}
          </p>
          <Button
            className="mt-auto"
            onClick={() => {
              refetch();
              setClosing(true);
            }}
          >
            {translate("payments.shift.close")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {translate("payments.shift.none_hint")}
          </p>
          <Button className="mt-auto" onClick={() => setOpening(true)}>
            {translate("payments.shift.open")}
          </Button>
        </div>
      )}

      <Dialog open={opening} onOpenChange={setOpening}>
        <DialogContent className="rounded-[28px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[24px] font-normal">
              {translate("payments.shift.open")}
            </DialogTitle>
            <DialogDescription>
              {translate("payments.shift.open_hint")}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payments.shift.opening_cash")}
            </span>
            <Input
              inputMode="numeric"
              value={cashText}
              onChange={(event) => setCashText(event.target.value)}
              aria-label={translate("payments.shift.opening_cash")}
            />
          </label>
          {branchesOn ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                {translate("payments.desk.branch")}
              </span>
              <NativeSelect
                value={branchId}
                onChange={setBranchId}
                aria-label={translate("payments.desk.branch")}
              >
                <option value="">
                  {translate("payments.shift.my_branch")}
                </option>
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpening(false)}>
              {translate("ra.action.cancel")}
            </Button>
            <Button onClick={open}>{translate("payments.shift.open")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent className="rounded-[28px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[24px] font-normal">
              {translate("payments.shift.close")}
            </DialogTitle>
            <DialogDescription>
              {translate("payments.shift.close_hint")}
            </DialogDescription>
          </DialogHeader>
          <Row
            label={translate("payments.shift.expected")}
            value={money(expected ?? 0)}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payments.shift.counted")}
            </span>
            <Input
              inputMode="numeric"
              value={cashText}
              onChange={(event) => setCashText(event.target.value)}
              aria-label={translate("payments.shift.counted")}
            />
          </label>
          {cashText.trim() ? (
            <div
              className={cn(
                "flex items-center justify-between rounded-full px-5 py-2.5",
                counted - (expected ?? 0) === 0
                  ? "bg-muted"
                  : "bg-neon text-neon-ink",
              )}
              data-testid="shift-discrepancy"
            >
              <span className="text-sm">
                {translate("payments.shift.discrepancy")}
              </span>
              <span className="text-lg font-light tabular-nums">
                {counted - (expected ?? 0) > 0 ? "+" : ""}
                {money(counted - (expected ?? 0))}
              </span>
            </div>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("payments.shift.note")}
            </span>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              aria-label={translate("payments.shift.note")}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClosing(false)}>
              {translate("ra.action.cancel")}
            </Button>
            <Button disabled={!cashText.trim()} onClick={close}>
              {translate("payments.shift.close")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </StudioCard>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

/** «Должники»: done treatment not paid in full, with a reminder task */
const DebtorsTab = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const [create] = useCreate();
  const [paying, setPaying] = useState<PatientAccount | null>(null);
  const [sort, setSort] = useState<"debt" | "last_visit_at">("debt");
  const { data: debtors = [], isPending } = useGetList<PatientAccount>(
    "patient_accounts",
    {
      filter: { "debt@gt": 0 },
      sort: { field: sort, order: sort === "debt" ? "DESC" : "ASC" },
      pagination: { page: 1, perPage: 500 },
    },
  );
  const totalDebt = debtors.reduce((sum, row) => sum + row.debt, 0);

  const remind = (row: PatientAccount) => {
    if (row.last_deal_id == null) {
      notify("payments.debtors.no_deal", { type: "warning" });
      return;
    }
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(10, 0, 0, 0);
    create(
      "tasks",
      {
        data: {
          deal_id: row.last_deal_id,
          type: "call",
          text: translate("payments.debtors.task_text", {
            amount: money(row.debt),
          }),
          due_date: due.toISOString(),
        },
      },
      {
        onSuccess: () => notify("payments.debtors.reminded", { type: "info" }),
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };

  const columns: ReportColumn<PatientAccount>[] = [
    {
      label: translate("payments.desk.columns.patient"),
      render: (row) =>
        [row.last_name, row.first_name, row.middle_name]
          .filter(Boolean)
          .join(" "),
    },
    {
      label: translate("payments.debtors.phone"),
      render: (row) => row.phones?.[0] ?? "",
    },
    {
      label: translate("payments.account.debt"),
      render: (row) => money(row.debt),
      csv: (row) => row.debt,
    },
    {
      label: translate("payments.account.deposit"),
      render: (row) => money(row.deposit),
      csv: (row) => row.deposit,
    },
    {
      label: translate("payments.debtors.last_visit"),
      render: (row) =>
        row.last_visit_at
          ? new Date(row.last_visit_at).toLocaleDateString("ru-RU")
          : "",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <section className="flex flex-col rounded-[28px] bg-neon p-6 text-neon-ink lg:col-span-4">
        <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("payments.debtors.total")}
        </h2>
        <p className="mt-1 text-sm opacity-80">
          {translate("payments.debtors.count", { count: debtors.length })}
        </p>
        <p
          className="mt-auto pt-10 text-[52px] leading-none font-light tracking-[-0.04em] tabular-nums"
          data-testid="debt-total"
        >
          {money(totalDebt)}
        </p>
        <p className="mt-3 text-sm opacity-80">
          {translate("payments.debtors.hint")}
        </p>
      </section>
      <StudioCard
        title={translate("payments.debtors.title")}
        className="lg:col-span-8"
        tools={
          <div className="flex gap-2">
            <Pills
              label={translate("payments.debtors.sort")}
              value={sort}
              options={[
                { value: "debt", label: translate("payments.debtors.by_debt") },
                {
                  value: "last_visit_at",
                  label: translate("payments.debtors.by_visit"),
                },
              ]}
              onChange={(value) => setSort(value as typeof sort)}
            />
          </div>
        }
      >
        {isPending ? null : debtors.length ? (
          <>
            <ul className="flex flex-col gap-1.5" data-testid="debtors-list">
              {debtors.map((row) => {
                const days = daysSince(row.last_visit_at);
                return (
                  <li
                    key={row.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 rounded-2xl bg-muted/60 px-4 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <Link
                        to={`/patients/${row.id}/show`}
                        className="block truncate text-foreground"
                      >
                        {[row.last_name, row.first_name]
                          .filter(Boolean)
                          .join(" ") || `#${row.id}`}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          row.phones?.[0],
                          days != null
                            ? translate("payments.debtors.days_ago", { days })
                            : translate("payments.debtors.no_visit"),
                          row.deposit > 0
                            ? `${translate("payments.account.deposit")} ${money(row.deposit)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="text-lg font-light whitespace-nowrap tabular-nums">
                      {money(row.debt)}
                    </span>
                    <span className="flex gap-2">
                      <Button size="sm" onClick={() => setPaying(row)}>
                        {translate("payments.account.accept")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => remind(row)}
                      >
                        {translate("payments.debtors.remind")}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCsv("dolzhniki.csv", columns, debtors)}
              >
                {translate("payments.desk.export")}
              </Button>
            </div>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {translate("payments.debtors.empty")}
          </p>
        )}
      </StudioCard>
      {paying ? (
        <PaymentDialog
          open
          onOpenChange={(open) => !open && setPaying(null)}
          patientId={paying.id}
          dealId={paying.last_deal_id ?? null}
          mode="payment"
        />
      ) : null}
    </div>
  );
};

/** «Смены»: opened, closed, expected against counted */
const ShiftsTab = () => {
  const translate = useTranslate();
  const rights = usePaymentRights();
  const { data: shifts = [], isPending } = useGetList<CashShift>(
    "cash_shifts",
    {
      sort: { field: "opened_at", order: "DESC" },
      pagination: { page: 1, perPage: 100 },
    },
  );
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
  });
  const nameOf = (id: Identifier | null | undefined) =>
    fullName(sales.find((sale) => String(sale.id) === String(id)));
  return (
    <StudioCard
      title={translate("payments.desk.tabs.shifts")}
      subtitle={
        rights.seesAll ? undefined : translate("payments.shift.own_only")
      }
    >
      {isPending ? null : shifts.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="shifts-table">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {(
                  [
                    "cashier",
                    "opened",
                    "closed",
                    "opening",
                    "expected",
                    "counted",
                    "discrepancy",
                  ] as const
                ).map((key) => (
                  <th key={key} className="px-3 py-2 font-normal">
                    {translate(`payments.shift.columns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id} className="border-t border-border/60">
                  <td className="px-3 py-2.5">{nameOf(shift.sales_id)}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {clock(shift.opened_at)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {shift.closed_at ? (
                      clock(shift.closed_at)
                    ) : (
                      <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs text-primary-foreground">
                        {translate("payments.shift.is_open")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {money(shift.opening_cash)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {shift.expected_cash != null
                      ? money(shift.expected_cash)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {shift.counted_cash != null
                      ? money(shift.counted_cash)
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {shift.discrepancy != null ? (
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5",
                          shift.discrepancy === 0
                            ? "bg-muted"
                            : "bg-neon text-neon-ink",
                        )}
                      >
                        {shift.discrepancy > 0 ? "+" : ""}
                        {money(shift.discrepancy)}
                      </span>
                    ) : (
                      "—"
                    )}
                    {shift.note ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {shift.note}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {translate("payments.shift.list_empty")}
        </p>
      )}
    </StudioCard>
  );
};
