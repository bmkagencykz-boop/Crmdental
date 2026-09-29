import { useGetList, useTranslate } from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { useDoctors } from "../dictionaries/useDictionaries";
import { Implant3D } from "../misc/Dental3D";
import { exportCsv, type ReportColumn } from "../reports/csv";
import {
  labSettlement,
  localDay,
  monthStart,
  sameMonth,
  shiftMonth,
  shortDay,
  tenge,
} from "./labMath";
import { LabPaymentDialog, LabPaymentsCard } from "./LabPayments";
import type {
  LabOrderCost,
  LabPaymentSummary,
  LabSettlementRow,
} from "./types";
import { useLabDictionaries } from "./useLab";

/**
 * «Сумма лаборатории» (owner, head): what the clinic owes each lab for the
 * works ready in the month, the lab cost of each doctor (the payroll of
 * stage 39 reads the same public.lab_order_costs), the works of the month
 * and the CSV; what was paid for the month, the balance, «Оплатить» and
 * the payments (stage 42). Same numbers as public.report_lab_settlement.
 */
export const LabSettlement = () => {
  const translate = useTranslate();
  const { labs } = useLabDictionaries();
  const { data: doctors } = useDoctors();
  const [month, setMonth] = useState(() => monthStart(localDay()));
  const next = shiftMonth(month, 1);
  // Every month up to this one: the balance carried over (stage 42)
  const { data: history = [], isPending } = useGetList<LabOrderCost>(
    "lab_order_costs",
    {
      filter: { "ready_at@lt": next },
      pagination: { page: 1, perPage: 10000 },
      sort: { field: "ready_at", order: "ASC" },
    },
  );
  const { data: payments = [] } = useGetList<LabPaymentSummary>(
    "lab_payments_summary",
    {
      filter: { "month@lt": next },
      pagination: { page: 1, perPage: 5000 },
      sort: { field: "paid_at", order: "DESC" },
    },
  );
  const costs = useMemo(
    () => history.filter((line) => sameMonth(line.ready_at, month)),
    [history, month],
  );
  const rows = useMemo(
    () => labSettlement(history, labs, month, payments),
    [history, labs, month, payments],
  );
  const monthPayments = payments.filter((payment) =>
    sameMonth(payment.month, month),
  );
  const [paying, setPaying] = useState<LabSettlementRow | null>(null);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalPaid = rows.reduce((sum, row) => sum + row.paid, 0);
  const totalDue = rows.reduce(
    (sum, row) => sum + Math.max(0, row.total_balance),
    0,
  );
  const max = Math.max(1, ...rows.map((row) => row.amount));
  const byDoctor = useMemo(() => {
    const sums = new Map<string, number>();
    for (const line of costs) {
      const key = line.doctor_id == null ? "" : String(line.doctor_id);
      sums.set(key, (sums.get(key) ?? 0) + line.qty * line.price);
    }
    return [...sums.entries()]
      .map(([id, amount]) => ({
        id,
        name:
          doctors.find((d) => String(d.id) === id)?.name ??
          translate("lab.settlement.no_doctor"),
        amount,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [costs, doctors, translate]);
  const monthTitle = new Date(`${month}T00:00:00`).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });
  const labName = (id: unknown) =>
    labs.find((l) => String(l.id) === String(id))?.name ?? "—";
  const doctorName = (id: unknown) =>
    doctors.find((d) => String(d.id) === String(id))?.name ?? "—";
  const columns: ReportColumn<LabOrderCost>[] = [
    {
      label: translate("lab.fields.number"),
      render: (line) => line.order_number,
    },
    {
      label: translate("lab.fields.ready_at"),
      render: (line) => shortDay(line.ready_at, true),
    },
    {
      label: translate("lab.fields.lab"),
      render: (line) => labName(line.lab_id),
    },
    {
      label: translate("lab.fields.doctor"),
      render: (line) => doctorName(line.doctor_id),
    },
    { label: translate("lab.fields.work_type"), render: (line) => line.name },
    {
      label: translate("lab.fields.qty"),
      render: (line) => line.qty,
      numeric: true,
    },
    {
      label: translate("lab.fields.price"),
      render: (line) => tenge(line.price),
      csv: (line) => line.price,
      numeric: true,
    },
    {
      label: translate("lab.fields.lab_cost"),
      render: (line) => tenge(line.qty * line.price),
      csv: (line) => line.qty * line.price,
      numeric: true,
    },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="lab-settlement">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label={translate("lab.settlement.prev_month")}
          title={translate("lab.settlement.prev_month")}
        >
          ‹
        </Button>
        <h2 className="min-w-44 text-center text-[22px] font-normal tracking-[-0.02em] first-letter:uppercase">
          {monthTitle}
        </h2>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label={translate("lab.settlement.next_month")}
          title={translate("lab.settlement.next_month")}
        >
          ›
        </Button>
        <Button
          variant="outline"
          className="ml-auto"
          disabled={!costs.length}
          onClick={() =>
            exportCsv(
              `${translate("lab.settlement.file")}-${month.slice(0, 7)}.csv`,
              columns,
              costs,
            )
          }
        >
          {translate("lab.settlement.export")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section
          className="relative flex min-h-[15rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink lg:col-span-4"
          aria-label={translate("lab.settlement.total")}
        >
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("lab.settlement.total")}
          </h2>
          <p className="mt-1 text-sm opacity-80">
            {translate("lab.settlement.hint")}
          </p>
          <p
            className="mt-auto text-[48px] leading-none font-light tracking-[-0.04em] tabular-nums"
            data-testid="lab-settlement-total"
          >
            {tenge(total)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-white/45 px-3 py-1.5">
              {translate("cash_out.lab.total_paid")}: {tenge(totalPaid)}
            </span>
            <span
              className="rounded-full bg-white/45 px-3 py-1.5"
              data-testid="lab-settlement-due"
            >
              {translate("cash_out.lab.total_balance_hint")}: {tenge(totalDue)}
            </span>
          </div>
          <Implant3D className="pointer-events-none absolute -top-4 -right-6 size-36 opacity-90" />
        </section>

        <StudioCard
          title={translate("lab.settlement.title")}
          subtitle={monthTitle}
          className="lg:col-span-8"
        >
          {isPending ? null : rows.length ? (
            <ul
              className="flex flex-col gap-2.5"
              data-testid="lab-settlement-labs"
            >
              {rows.map((row, index) => (
                <li key={row.lab_id} className="flex items-center gap-3">
                  <span className="w-36 shrink-0">
                    <span className="block truncate text-sm">
                      {row.lab_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {translate("lab.settlement.orders", {
                        smart_count: row.orders_count,
                      })}
                      {" · "}
                      {translate("lab.settlement.works", {
                        count: row.items_count,
                      })}
                      {row.is_own
                        ? ` · ${translate("lab.settlement.own")}`
                        : ""}
                    </span>
                  </span>
                  <span className="relative h-10 flex-1 overflow-hidden rounded-xl bg-muted">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-xl",
                        index === 0
                          ? "hatch border border-foreground/15 bg-pill"
                          : "bg-pill",
                      )}
                      style={{
                        width: `${Math.max((row.amount / max) * 100, 6)}%`,
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm tabular-nums">
                      {tenge(row.amount)}
                    </span>
                  </span>
                  <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    <span className="block">
                      {translate("cash_out.lab.paid")} {tenge(row.paid)}
                    </span>
                    <span
                      className={cn(
                        "block",
                        row.total_balance > 0 && "text-foreground",
                      )}
                      data-testid="lab-settlement-balance"
                    >
                      {translate("cash_out.lab.balance")}{" "}
                      {tenge(row.total_balance)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={row.total_balance > 0 ? "default" : "outline"}
                    onClick={() => setPaying(row)}
                  >
                    {translate("cash_out.lab.pay")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate("lab.settlement.empty")}
            </p>
          )}
        </StudioCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <LabPaymentsCard
          payments={monthPayments}
          subtitle={monthTitle}
          className="lg:col-span-8"
        />
        <StudioCard
          title={translate("lab.settlement.by_doctor")}
          subtitle={translate("lab.settlement.by_doctor_hint")}
          className="lg:col-span-4"
        >
          <ul
            className="flex flex-col gap-2"
            data-testid="lab-settlement-doctors"
          >
            {byDoctor.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm"
              >
                <span className="truncate">{row.name}</span>
                <span className="tabular-nums">{tenge(row.amount)}</span>
              </li>
            ))}
          </ul>
        </StudioCard>
      </div>

      <StudioCard
        title={translate("lab.settlement.details")}
        subtitle={monthTitle}
      >
        {costs.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
                {costs.map((line) => (
                  <tr key={line.id} className="border-t border-border/50">
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
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("lab.settlement.empty")}
          </p>
        )}
      </StudioCard>
      {paying ? (
        <LabPaymentDialog
          row={paying}
          month={month}
          monthTitle={monthTitle}
          onClose={() => setPaying(null)}
        />
      ) : null}
    </div>
  );
};
