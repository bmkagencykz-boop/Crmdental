import {
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { addDays, todayKey } from "../tasks/calendarLayout";
import { addMonths, bucketOf, monthsBetween } from "./financeMath";
import { cashFlowRows, type TableRow } from "./financeTable";
import {
  Chips,
  downloadTable,
  Empty,
  FinanceChart,
  FinanceTable,
  num,
  PeriodBar,
  periodLabel,
  Tile,
} from "./FinanceParts";
import { TransactionDialog } from "./TransactionDialog";
import type { FinanceTransaction, Granularity } from "./types";
import {
  presetRange,
  useCashFlow,
  useCashFlowMovements,
  useFinanceAccounts,
  useFinanceArticles,
  useRefreshFinance,
  type MonthRange,
} from "./useFinance";

const nextBucket = (bucket: string, granularity: Granularity) =>
  granularity === "day"
    ? addDays(bucket, 1)
    : granularity === "week"
      ? addDays(bucket, 7)
      : addMonths(bucket, 1);

/**
 * «ДДС» (stage 44): the cash flow statement by month (week, day) — the
 * articles grouped by activity, the net flow, the balances of the accounts;
 * a click on a value lists its movements. Money outside the cash desk is
 * added with «Движение».
 */
export const CashFlowTab = ({ canEdit }: { canEdit: boolean }) => {
  const translate = useTranslate();
  const today = todayKey();
  const [range, setRange] = useState<MonthRange>(() =>
    presetRange("last12", today),
  );
  const [branch, setBranch] = useState("");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [adding, setAdding] = useState(false);
  const [drill, setDrill] = useState<{
    title: string;
    from: string;
    to: string;
    article_id?: Identifier | null;
    account_id?: Identifier | null;
    transfers?: boolean;
  } | null>(null);
  const from = range.from;
  const to = addMonths(range.to, 1);
  const {
    data: report,
    isPending,
    error,
  } = useCashFlow({
    from,
    to,
    branch_id: branch || null,
    granularity,
  });
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: articles = [] } = useFinanceArticles();
  const rows = useMemo(
    () => (report ? cashFlowRows(report, articles, accounts) : []),
    [report, articles, accounts],
  );
  const headers = (report?.periods ?? []).map((p) =>
    periodLabel(p, granularity),
  );
  const labelOf = (row: TableRow) =>
    row.labelKey ? translate(row.labelKey) : (row.name ?? "");
  const currentBucket = bucketOf(today, granularity);

  const onGranularity = (value: Granularity) => {
    // A day or a week view: at most a quarter
    if (
      value !== "month" &&
      monthsBetween(range.from, addMonths(range.to, 1)).length > 3
    ) {
      setRange(presetRange("quarter", today));
    }
    setGranularity(value);
  };

  const onCell = (row: TableRow, index: number | null) => {
    if (!report) return;
    const period = index == null ? null : report.periods[index];
    const cellFrom = period == null ? from : period < from ? from : period;
    const end = period == null ? to : nextBucket(period, granularity);
    setDrill({
      title: `${labelOf(row)} · ${period == null ? translate("finance.total") : periodLabel(period, granularity)}`,
      from: cellFrom,
      to: end > to ? to : end,
      article_id: row.articleId ?? null,
      account_id: row.articleId == null ? (row.accountId ?? null) : null,
      transfers: row.transfers,
    });
  };

  const exportTable = () =>
    downloadTable({
      rows,
      headers,
      labelOf,
      labelHeader: translate("finance.cash_flow.article"),
      totalHeader: translate("finance.total"),
      filename: `dds-${from}-${to}`,
    });

  return (
    <div className="flex flex-col gap-5" data-testid="finance-cash-flow">
      <PeriodBar
        range={range}
        onRange={setRange}
        branch={branch}
        onBranch={setBranch}
        today={today}
      >
        <Chips<Granularity>
          label={translate("finance.cash_flow.granularity")}
          value={granularity}
          options={(["month", "week", "day"] as const).map((value) => ({
            value,
            label: translate(`finance.cash_flow.granularities.${value}`),
          }))}
          onChange={onGranularity}
        />
        <Button
          variant="outline"
          className="h-11 px-5"
          onClick={exportTable}
          disabled={!report}
        >
          {translate("finance.csv")}
        </Button>
        {canEdit ? (
          <Button
            className="h-11 px-5"
            onClick={() => setAdding(true)}
            data-testid="finance-add-transaction"
          >
            {translate("finance.transaction.action")}
          </Button>
        ) : null}
      </PeriodBar>

      {error ? <Empty>{(error as Error).message}</Empty> : null}
      {report ? (
        <>
          <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
            {report.balances ? (
              <Tile
                label={translate("finance.cash_flow.opening")}
                value={report.total.opening}
              />
            ) : (
              <Tile
                label={translate("finance.cash_flow.net")}
                value={report.total.net}
                tone={report.total.net < 0 ? "negative" : undefined}
              />
            )}
            <Tile
              label={translate("finance.cash_flow.inflow")}
              value={report.total.inflow}
              testId="finance-inflow"
            />
            <Tile
              label={translate("finance.cash_flow.outflow")}
              value={report.total.outflow}
            />
            {report.balances ? (
              <Tile
                accent
                label={translate("finance.cash_flow.closing")}
                value={report.total.closing}
                hint={translate("finance.cash_flow.net_hint", {
                  amount: `${num(report.total.net)} ₸`,
                })}
                testId="finance-closing"
              />
            ) : (
              <Tile
                accent
                label={translate("finance.cash_flow.branch_only")}
                value={report.total.net}
                hint={translate("finance.cash_flow.no_balances")}
              />
            )}
          </div>
          <StudioCard
            title={translate("finance.cash_flow.chart")}
            subtitle={translate("finance.cash_flow.chart_hint")}
          >
            <FinanceChart
              labels={headers}
              a={report.totals.map((t) => t.inflow)}
              b={report.totals.map((t) => t.outflow)}
              line={
                report.balances
                  ? report.totals.map((t) => t.closing)
                  : report.totals.map((t) => t.net)
              }
              aLabel={translate("finance.cash_flow.inflow")}
              bLabel={translate("finance.cash_flow.outflow")}
              lineLabel={translate(
                report.balances
                  ? "finance.cash_flow.closing"
                  : "finance.cash_flow.net",
              )}
              testId="finance-cash-chart"
            />
          </StudioCard>
          <StudioCard
            title={translate("finance.cash_flow.table")}
            subtitle={translate("finance.cash_flow.table_hint")}
          >
            {rows.length > 1 ? (
              <FinanceTable
                rows={rows}
                headers={headers}
                labelOf={labelOf}
                totalLabel={translate("finance.total")}
                onCell={onCell}
                highlight={(i) => report.periods[i] === currentBucket}
                testId="finance-cash-table"
              />
            ) : (
              <Empty>{translate("finance.cash_flow.empty")}</Empty>
            )}
          </StudioCard>
        </>
      ) : isPending ? (
        <Empty>{translate("finance.loading")}</Empty>
      ) : null}

      <TransactionsCard canEdit={canEdit} from={from} to={to} />

      {adding ? <TransactionDialog open onOpenChange={setAdding} /> : null}
      {drill ? (
        <MovementsDialog
          drill={drill}
          branch={branch}
          onClose={() => setDrill(null)}
        />
      ) : null}
    </div>
  );
};

/** The movements of a cell */
const MovementsDialog = ({
  drill,
  branch,
  onClose,
}: {
  drill: {
    title: string;
    from: string;
    to: string;
    article_id?: Identifier | null;
    account_id?: Identifier | null;
    transfers?: boolean;
  };
  branch: string;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: movements = [], isPending } = useCashFlowMovements({
    from: drill.from,
    to: drill.to,
    branch_id: branch || null,
    article_id: drill.article_id ?? null,
    account_id: drill.account_id ?? null,
    transfers: drill.transfers,
  });
  const total = movements.reduce((sum, m) => sum + m.amount, 0);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-[28px] sm:max-w-2xl"
        data-testid="finance-movements"
      >
        <DialogHeader>
          <DialogTitle className="text-[22px] font-normal">
            {drill.title}
          </DialogTitle>
          <DialogDescription>
            {translate("finance.movements.hint", {
              count: movements.length,
              amount: `${num(total)} ₸`,
            })}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Empty>{translate("finance.loading")}</Empty>
        ) : movements.length ? (
          <ul className="flex flex-col gap-1.5">
            {movements.map((m, i) => (
              <li
                key={`${m.source}-${m.source_id}-${i}`}
                className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2 text-sm"
              >
                <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {m.day.slice(8, 10)}.{m.day.slice(5, 7)}.{m.day.slice(0, 4)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {m.counterparty ?? m.comment ?? "—"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {translate(`finance.movements.sources.${m.source}`)}
                    {m.transfer
                      ? ` · ${translate("finance.movements.transfer")}`
                      : ""}
                    {" · "}
                    {accounts.find((a) => String(a.id) === String(m.account_id))
                      ?.name ?? translate("finance.cash_flow.no_account")}
                    {m.counterparty && m.comment ? ` · ${m.comment}` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    m.amount < 0 ? "text-tone-red" : "",
                  )}
                >
                  {num(m.amount)} ₸
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{translate("finance.movements.empty")}</Empty>
        )}
      </DialogContent>
    </Dialog>
  );
};

/** «Движения вне кассы»: the transactions of the period, changed and removed here */
const TransactionsCard = ({
  canEdit,
  from,
  to,
}: {
  canEdit: boolean;
  from: string;
  to: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshFinance();
  const [remove] = useDelete<FinanceTransaction>();
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: articles = [] } = useFinanceArticles();
  const { data: transactions = [] } = useGetList<FinanceTransaction>(
    "finance_transactions",
    {
      filter: { "occurred_on@gte": from, "occurred_on@lt": to },
      sort: { field: "occurred_on", order: "DESC" },
      pagination: { page: 1, perPage: 1000 },
    },
  );
  const shown = showAll ? transactions : transactions.slice(0, 12);
  const nameOf = (
    list: { id: Identifier; name: string }[],
    id: Identifier | null | undefined,
  ) => list.find((row) => String(row.id) === String(id))?.name ?? "";
  return (
    <StudioCard
      title={translate("finance.transactions.title")}
      subtitle={translate("finance.transactions.hint")}
    >
      {transactions.length ? (
        <ul
          className="flex flex-col gap-1.5"
          data-testid="finance-transactions"
        >
          {shown.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2 text-sm"
            >
              <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                {t.occurred_on.slice(8, 10)}.{t.occurred_on.slice(5, 7)}.
                {t.occurred_on.slice(0, 4)}
              </span>
              <span className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-xs">
                {translate(`finance.transaction.kinds.${t.kind}`)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {t.kind === "transfer"
                    ? `${nameOf(accounts, t.account_id)} → ${nameOf(accounts, t.to_account_id)}`
                    : nameOf(articles, t.article_id)}
                  {t.counterparty ? ` · ${t.counterparty}` : ""}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    t.kind !== "transfer" && t.kind !== "accrual"
                      ? nameOf(accounts, t.account_id)
                      : null,
                    t.comment,
                    t.payroll_adjustment_id != null
                      ? translate("finance.transactions.payout")
                      : null,
                    t.lab_payment_id != null
                      ? translate("finance.transactions.lab_payment")
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  t.kind === "out" ? "text-tone-red" : "",
                )}
              >
                {t.kind === "out" ? "−" : ""}
                {num(t.amount)} ₸
              </span>
              {canEdit ? (
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full px-3"
                    onClick={() => setEditing(t)}
                  >
                    {translate("ra.action.edit")}
                  </Button>
                  {t.payroll_adjustment_id == null &&
                  t.lab_payment_id == null ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-full px-3"
                      aria-label={translate("ra.action.delete")}
                      onClick={() =>
                        remove(
                          "finance_transactions",
                          { id: t.id, previousData: t },
                          {
                            onSuccess: () => {
                              notify("finance.transaction.deleted", {
                                type: "info",
                              });
                              refresh();
                            },
                            onError: (error: any) =>
                              notify(
                                error?.message || "ra.notification.http_error",
                                { type: "error" },
                              ),
                          },
                        )
                      }
                    >
                      ×
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
          {transactions.length > shown.length ? (
            <li>
              <Button
                variant="outline"
                className="h-10 px-5"
                onClick={() => setShowAll(true)}
              >
                {translate("finance.transactions.more", {
                  count: transactions.length - shown.length,
                })}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : (
        <Empty>{translate("finance.transactions.empty")}</Empty>
      )}
      {editing ? (
        <TransactionDialog
          open
          record={editing}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
    </StudioCard>
  );
};
