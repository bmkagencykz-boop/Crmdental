import { useGetList, useTranslate } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, Sale, Task } from "../types";

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Key figures of the clinic's pipeline and the team with their open deals.
 */
export const DashboardSummary = () => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 1000 },
    filter: { "archived_at@is": null },
  });
  const { data: tasks = [] } = useGetList<Task>("tasks", {
    pagination: { page: 1, perPage: 1000 },
    filter: { "done_date@is": null },
  });
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "first_name", order: "ASC" },
    filter: { "disabled@neq": true },
  });

  const openDeals = deals.filter((deal) => deal.stage_kind === "open");
  const pipeline = openDeals.reduce(
    (sum, deal) => sum + (deal.plan_amount ?? 0),
    0,
  );
  // Money actually received on deals (payments)
  const won = deals.reduce((sum, deal) => sum + (deal.paid_amount ?? 0), 0);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dueToday = tasks.filter((task) => {
    const due = new Date(task.due_date);
    return due >= today && due < tomorrow;
  }).length;
  const overdue = tasks.filter(
    (task) => new Date(task.due_date) < today,
  ).length;

  const dealsBySale = new Map<string, number>();
  openDeals.forEach((deal) => {
    const key = String(deal.sales_id);
    dealsBySale.set(key, (dealsBySale.get(key) ?? 0) + 1);
  });

  return (
    <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border shadow-card md:grid-cols-4">
        <Stat
          label={translate("crm.dashboard.summary.pipeline")}
          value={formatMoney(pipeline, currency, pipeline >= 1_000_000)}
          to="/deals"
        />
        <Stat
          label={translate("crm.dashboard.summary.open_deals")}
          value={String(openDeals.length)}
          to="/deals"
        />
        <Stat
          label={translate("crm.dashboard.summary.due_today")}
          value={String(dueToday)}
        />
        <Stat
          label={translate("crm.dashboard.summary.overdue")}
          value={String(overdue)}
          tone={overdue > 0 ? "alert" : undefined}
        />
      </div>
      <div className="flex flex-col justify-between gap-4 rounded-lg bg-primary p-6 text-primary-foreground">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium opacity-70">
              {translate("crm.dashboard.summary.paid")}
            </p>
            <p className="mt-1 text-[1.9rem] font-bold leading-none tracking-[-0.03em] tabular-nums">
              {formatMoney(won, currency, won >= 1_000_000)}
            </p>
          </div>
        </div>
        <TeamRow sales={sales} dealsBySale={dealsBySale} />
      </div>
    </div>
  );
};

const Stat = ({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: string;
  to?: string;
  tone?: "alert";
}) => {
  const content = (
    <>
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-[1.75rem] font-bold leading-none tracking-[-0.03em] tabular-nums",
          tone === "alert" && "text-brand-red",
        )}
      >
        {value}
      </p>
    </>
  );
  const className = "block bg-card px-6 py-6 no-underline text-foreground";
  return to ? (
    <Link
      to={to}
      className={cn(className, "transition-colors hover:bg-pill-hover")}
    >
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
};

const badgeTones = ["bg-[#1A1517]", "bg-[#B23A5B]", "bg-[#6E6468]"];

const TeamRow = ({
  sales,
  dealsBySale,
}: {
  sales: Sale[];
  dealsBySale: Map<string, number>;
}) => (
  <div className="flex flex-wrap items-center gap-2.5">
    {sales.slice(0, 8).map((sale, index) => {
      const count = dealsBySale.get(String(sale.id)) ?? 0;
      const name = `${sale.first_name} ${sale.last_name}`;
      return (
        <div key={sale.id} className="relative" title={name}>
          <span className="flex size-11 items-center justify-center overflow-hidden rounded-full border-2 border-white/80 bg-white/70 text-xs font-bold text-[#1A1517]">
            {sale.avatar?.src ? (
              <img
                src={sale.avatar.src}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              `${sale.first_name[0] ?? ""}${sale.last_name[0] ?? ""}`
            )}
          </span>
          {count > 0 ? (
            <span
              className={cn(
                "absolute -bottom-1 left-1/2 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white/80",
                badgeTones[index % badgeTones.length],
              )}
            >
              {count}
            </span>
          ) : null}
        </div>
      );
    })}
  </div>
);
