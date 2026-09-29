import { useTranslate } from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

import { StudioCard } from "../dashboard/StudioCards";
import { todayKey } from "../tasks/calendarLayout";
import { addMonths, monthOf } from "./financeMath";
import { pnlRows, type TableRow } from "./financeTable";
import {
  bigMoney,
  downloadTable,
  Empty,
  FinanceChart,
  FinanceTable,
  PeriodBar,
  periodLabel,
  RatioChip,
  Tile,
} from "./FinanceParts";
import {
  presetRange,
  useFinanceArticles,
  usePnl,
  type MonthRange,
} from "./useFinance";

const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${String(value).replace(".", ",")} %`;

/**
 * «ПиУ» (stage 44): the P&L by month (accrual method) — revenue of the
 * services rendered, cost of sales (materials, lab, doctors), gross
 * profit, operating expenses, EBITDA, net profit; the ratios per chair,
 * per visit, the shares of the lab and of the payroll.
 */
export const PnlTab = () => {
  const translate = useTranslate();
  const today = todayKey();
  const [range, setRange] = useState<MonthRange>(() =>
    presetRange("last12", today),
  );
  const [branch, setBranch] = useState("");
  const [rules, setRules] = useState(false);
  const from = range.from;
  const to = addMonths(range.to, 1);
  const {
    data: report,
    isPending,
    error,
  } = usePnl({ from, to, branch_id: branch || null });
  const { data: articles = [] } = useFinanceArticles();
  const rows = useMemo(
    () => (report ? pnlRows(report, articles) : []),
    [report, articles],
  );
  const headers = (report?.months ?? []).map((m) => periodLabel(m));
  const labelOf = (row: TableRow) =>
    row.labelKey ? translate(row.labelKey) : (row.name ?? "");
  const current = monthOf(today);
  const total = report?.total;
  const expenses = (report?.summary ?? []).map((s) => s.revenue - s.net);

  return (
    <div className="flex flex-col gap-5" data-testid="finance-pnl">
      <PeriodBar
        range={range}
        onRange={setRange}
        branch={branch}
        onBranch={setBranch}
        today={today}
      >
        <Button
          variant="outline"
          className="h-11 px-5"
          onClick={() => setRules((v) => !v)}
        >
          {translate("finance.pnl.rules_button")}
        </Button>
        <Button
          variant="outline"
          className="h-11 px-5"
          disabled={!report}
          onClick={() =>
            downloadTable({
              rows,
              headers,
              labelOf,
              labelHeader: translate("finance.pnl.line"),
              totalHeader: translate("finance.total"),
              filename: `pnl-${from}-${to}`,
            })
          }
        >
          {translate("finance.csv")}
        </Button>
      </PeriodBar>
      {rules ? (
        <section
          className="rounded-[28px] bg-card p-6 text-sm leading-relaxed"
          data-testid="finance-pnl-rules"
        >
          <h2 className="mb-2 text-[22px] font-normal tracking-[-0.02em]">
            {translate("finance.pnl.rules_title")}
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
            {["revenue", "cogs", "opex", "cash", "branch"].map((key) => (
              <li key={key}>{translate(`finance.pnl.rules.${key}`)}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {error ? <Empty>{(error as Error).message}</Empty> : null}
      {report && total ? (
        <>
          <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
            <Tile
              accent
              label={translate("finance.pnl.lines.revenue")}
              value={total.revenue}
              testId="finance-revenue"
              hint={translate("finance.pnl.visits", { count: total.visits })}
            />
            <Tile
              label={translate("finance.pnl.lines.gross")}
              value={total.gross}
              tone={total.gross < 0 ? "negative" : undefined}
              hint={`${translate("finance.pnl.lines.gross_margin")}: ${percent(total.gross_margin)}`}
            />
            <Tile
              label={translate("finance.pnl.lines.ebitda")}
              value={total.ebitda}
              tone={total.ebitda < 0 ? "negative" : undefined}
            />
            <Tile
              label={translate("finance.pnl.lines.net")}
              value={total.net}
              tone={total.net < 0 ? "negative" : undefined}
              hint={`${translate("finance.pnl.lines.net_margin")}: ${percent(total.net_margin)}`}
              testId="finance-net"
            />
          </div>
          <div
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            data-testid="finance-ratios"
          >
            <RatioChip
              label={translate("finance.pnl.ratios.revenue_per_chair", {
                chairs: report.chairs,
              })}
              value={
                total.revenue_per_chair == null
                  ? "—"
                  : bigMoney(total.revenue_per_chair).join(" ")
              }
            />
            <RatioChip
              label={translate("finance.pnl.ratios.avg_check")}
              value={
                total.avg_check == null
                  ? "—"
                  : bigMoney(total.avg_check).join(" ")
              }
            />
            <RatioChip
              label={translate("finance.pnl.ratios.lab_share")}
              value={percent(total.lab_share)}
            />
            <RatioChip
              label={translate("finance.pnl.ratios.payroll_share")}
              value={percent(total.payroll_share)}
            />
          </div>
          <StudioCard
            title={translate("finance.pnl.chart")}
            subtitle={translate("finance.pnl.chart_hint")}
          >
            <FinanceChart
              labels={headers}
              a={report.summary.map((s) => s.revenue)}
              b={expenses}
              line={report.summary.map((s) => s.net)}
              aLabel={translate("finance.pnl.lines.revenue")}
              bLabel={translate("finance.pnl.expenses")}
              lineLabel={translate("finance.pnl.lines.net")}
              testId="finance-pnl-chart"
            />
          </StudioCard>
          <StudioCard
            title={translate("finance.pnl.table")}
            subtitle={translate("finance.pnl.table_hint")}
          >
            <FinanceTable
              rows={rows}
              headers={headers}
              labelOf={labelOf}
              totalLabel={translate("finance.total")}
              highlight={(i) => report.months[i] === current}
              testId="finance-pnl-table"
            />
          </StudioCard>
        </>
      ) : isPending ? (
        <Empty>{translate("finance.loading")}</Empty>
      ) : null}
    </div>
  );
};
