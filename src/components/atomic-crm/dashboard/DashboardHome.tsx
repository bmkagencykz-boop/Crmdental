import {
  useGetIdentity,
  useGetList,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  findById,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { formatMoney } from "../deals/kanbanFormat";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, Sale, Task, TaskType } from "../types";

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
};

const shortDateTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(new Date(value))
        .replace(",", " ·")
    : null;

const initials = (name?: string | null) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

/** A round «+» used by the actions of the desk */
const PlusCircle = ({ dark = false }: { dark?: boolean }) => (
  <span
    className={cn(
      "flex size-7 items-center justify-center rounded-full text-base leading-none font-semibold",
      dark ? "bg-foreground text-background" : "bg-muted text-foreground",
    )}
    aria-hidden
  >
    +
  </span>
);

/**
 * The desk header: «+ Новая сделка» on the left, the day's figures on the
 * right with small change chips (like the reference «23 в работе ↑13»).
 */
export const DashboardHeader = () => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 1000 },
    filter: { "archived_at@is": null },
  });
  const { data: tasks = [] } = useGetList<Task>("tasks", {
    pagination: { page: 1, perPage: 1000 },
  });
  const today = startOfToday();
  const tomorrow = addDays(today, 1);
  const open = deals.filter((deal) => deal.stage_kind === "open");
  const newToday = deals.filter(
    (deal) => new Date(deal.created_at) >= today,
  ).length;
  const doneToday = tasks.filter(
    (task) => task.done_date && new Date(task.done_date) >= today,
  ).length;
  const dueToday = tasks.filter((task) => {
    const due = new Date(task.due_date);
    return !task.done_date && due >= today && due < tomorrow;
  }).length;
  const overdue = tasks.filter(
    (task) => !task.done_date && new Date(task.due_date) < today,
  ).length;
  const paid = deals.reduce((sum, deal) => sum + (deal.paid_amount ?? 0), 0);

  return (
    <div className="mb-7 flex flex-wrap items-center gap-6">
      <Link
        to="/deals/create"
        className="flex h-12 items-center gap-3 rounded-full bg-card py-1 pr-5 pl-2 text-sm font-semibold text-foreground no-underline shadow-card transition-colors hover:text-primary"
      >
        <PlusCircle dark />
        {translate("resources.deals.action.new")}
      </Link>
      <div className="ml-auto flex flex-wrap items-end gap-x-9 gap-y-3">
        <Figure
          value={String(open.length)}
          label={translate("crm.dashboard.summary.open_deals")}
          chip={newToday > 0 ? `↑ ${newToday}` : undefined}
          chipTone="green"
          to="/deals"
        />
        <Figure
          value={String(dueToday)}
          label={translate("crm.dashboard.summary.due_today")}
          chip={doneToday > 0 ? `✓ ${doneToday}` : undefined}
          chipTone="green"
          to="/tasks"
        />
        <Figure
          value={String(overdue)}
          label={translate("crm.dashboard.summary.overdue")}
          chip={overdue > 0 ? "!" : undefined}
          chipTone="red"
          to="/tasks"
        />
        <Figure
          value={formatMoney(paid, currency, paid >= 1_000_000)}
          label={translate("crm.dashboard.summary.paid")}
          accent
        />
      </div>
    </div>
  );
};

const Figure = ({
  value,
  label,
  chip,
  chipTone,
  to,
  accent,
}: {
  value: string;
  label: string;
  chip?: string;
  chipTone?: "green" | "red";
  to?: string;
  accent?: boolean;
}) => {
  const content = (
    <span className="flex items-end gap-2">
      <span
        className={cn(
          "text-[40px] leading-none font-semibold tracking-[-0.03em] tabular-nums",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="flex flex-col items-start gap-1 pb-0.5">
        {chip ? (
          <span
            className={cn(
              "rounded-full px-1.5 text-[11px] leading-4 font-bold",
              chipTone === "red"
                ? "bg-tone-red/15 text-tone-red"
                : "bg-tone-green/15 text-tone-green",
            )}
          >
            {chip}
          </span>
        ) : null}
        <span className="text-sm leading-tight text-muted-foreground">
          {label}
        </span>
      </span>
    </span>
  );
  return to ? (
    <Link to={to} className="text-foreground no-underline hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
};

/**
 * «В работе»: the open deals with the nearest events as cards in a row,
 * filtered by the chosen employees (chips with ×, «+» adds one).
 */
export const InWorkDeals = () => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const [chosen, setChosen] = useStore<string[]>("dashboard.in_work.sales", []);
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "first_name", order: "ASC" },
    filter: { "disabled@neq": true },
  });
  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 1000 },
    filter: { "archived_at@is": null },
  });
  const cards = useMemo(() => {
    const open = deals.filter(
      (deal) =>
        deal.stage_kind === "open" &&
        !deal.unsorted_at &&
        (chosen.length === 0 || chosen.includes(String(deal.sales_id))),
    );
    const nextAt = (deal: Deal) =>
      deal.appointment_at && new Date(deal.appointment_at) >= startOfToday()
        ? new Date(deal.appointment_at).getTime()
        : deal.next_task_due_at
          ? new Date(deal.next_task_due_at).getTime()
          : Number.MAX_SAFE_INTEGER;
    return open.sort((a, b) => nextAt(a) - nextAt(b)).slice(0, 12);
  }, [deals, chosen]);
  const chosenSales = sales.filter((sale) => chosen.includes(String(sale.id)));
  const others = sales.filter((sale) => !chosen.includes(String(sale.id)));

  return (
    <section className="mb-8" aria-label={translate("dashboard_home.in_work")}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <h2 className="mr-2 text-[22px] font-semibold tracking-[-0.01em]">
          {translate("dashboard_home.in_work")}
        </h2>
        {chosenSales.map((sale) => (
          <span
            key={sale.id}
            className="flex h-8 items-center gap-1.5 rounded-full bg-card pr-1.5 pl-3.5 text-sm font-medium shadow-card"
          >
            {sale.first_name} {sale.last_name}
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() =>
                setChosen(chosen.filter((id) => id !== String(sale.id)))
              }
              aria-label={translate("dashboard_home.remove_filter", {
                name: `${sale.first_name} ${sale.last_name}`,
              })}
            >
              ×
            </button>
          </span>
        ))}
        <AddSaleChip
          sales={others}
          meId={identity?.id}
          onAdd={(id) => setChosen([...chosen, String(id)])}
        />
      </div>
      {cards.length === 0 ? (
        <p className="rounded-xl bg-card px-5 py-8 text-sm text-muted-foreground shadow-card">
          {translate("dashboard_home.nothing_in_work")}
        </p>
      ) : (
        <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pt-3 pb-3 [scrollbar-width:thin]">
          {cards.map((deal) => (
            <DealWorkCard key={deal.id} deal={deal} sales={sales} />
          ))}
        </div>
      )}
    </section>
  );
};

const AddSaleChip = ({
  sales,
  meId,
  onAdd,
}: {
  sales: Sale[];
  meId?: Identifier;
  onAdd: (id: Identifier) => void;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  if (sales.length === 0) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full border-2 border-foreground/70 text-base leading-none font-semibold text-foreground hover:border-primary hover:text-primary"
          aria-label={translate("dashboard_home.add_filter")}
          title={translate("dashboard_home.add_filter")}
        >
          +
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        {sales.map((sale) => (
          <button
            key={sale.id}
            type="button"
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              onAdd(sale.id);
              setOpen(false);
            }}
          >
            {sale.first_name} {sale.last_name}
            {String(sale.id) === String(meId) ? (
              <span className="text-xs text-muted-foreground">
                {translate("dashboard_home.me")}
              </span>
            ) : null}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};

/** Chip above a card: the stage in its tone, or a warning */
const chipTone = (deal: Deal) => {
  if (deal.next_task_due_at && new Date(deal.next_task_due_at) < new Date()) {
    return "red" as const;
  }
  if (deal.appointment_at && new Date(deal.appointment_at) >= startOfToday()) {
    return "blue" as const;
  }
  return "violet" as const;
};
const CHIP_CLASS = {
  blue: "bg-tone-blue text-white",
};

/** A deal as the reference's «наряд» card */
const DealWorkCard = ({ deal, sales }: { deal: Deal; sales: Sale[] }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: services } = useServices();
  const [expanded, setExpanded] = useState(false);
  const sale = findById(sales, deal.sales_id);
  const saleName = sale ? `${sale.first_name} ${sale.last_name}` : undefined;
  const stage = findById(stages, deal.stage_id);
  const tone = chipTone(deal);
  const overdueDays =
    tone === "red" && deal.next_task_due_at
      ? Math.max(
          1,
          Math.round(
            (Date.now() - new Date(deal.next_task_due_at).getTime()) /
              86_400_000,
          ),
        )
      : 0;
  const patient = [deal.patient_last_name, deal.patient_first_name]
    .filter(Boolean)
    .join(" ");
  return (
    <article
      className="relative flex w-[19rem] shrink-0 snap-start flex-col gap-3 rounded-xl bg-card p-4 shadow-card"
      data-testid="dashboard-deal-card"
    >
      <span className="absolute -top-3 right-4 flex gap-1.5">
        {tone === "red" ? (
          <span className="rounded-full bg-tone-orange px-2.5 py-0.5 text-[11px] font-semibold text-white">
            {translate("dashboard_home.overdue_days", {
              smart_count: overdueDays,
            })}
          </span>
        ) : null}
        {stage ? (
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              tone === "blue" ? CHIP_CLASS.blue : "bg-tone-violet text-white",
            )}
          >
            {stage.name}
          </span>
        ) : null}
      </span>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tone-pink-soft text-xs font-bold text-primary">
          {initials(deal.doctor_name ?? saleName) || "—"}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[11px] text-muted-foreground">
            {translate(
              deal.doctor_name
                ? "dashboard_home.doctor"
                : "dashboard_home.responsible",
            )}
          </div>
          <div className="truncate text-sm font-semibold">
            {deal.doctor_name ?? saleName ?? "—"}
          </div>
        </div>
        <div className="text-right text-[11px] leading-tight text-muted-foreground tabular-nums">
          <div>
            {new Intl.DateTimeFormat("ru-RU").format(new Date(deal.created_at))}
          </div>
          <div className="font-semibold text-foreground">№ {deal.id}</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px] leading-tight">
        <Field
          label={translate("dashboard_home.patient")}
          value={patient || deal.patient_phone || "—"}
        />
        <Field
          label={translate("dashboard_home.appointment")}
          value={shortDateTime(deal.appointment_at) ?? "—"}
        />
        {deal.doctor_name ? (
          <Field
            label={translate("dashboard_home.responsible")}
            value={saleName ?? "—"}
          />
        ) : (
          <Field
            label={translate("dashboard_home.stage")}
            value={stage?.name ?? "—"}
          />
        )}
        <Field
          label={translate("dashboard_home.next_task")}
          value={shortDateTime(deal.next_task_due_at) ?? "—"}
        />
        <Field
          label={translate("dashboard_home.service")}
          value={findById(services, deal.service_id)?.name ?? deal.name ?? "—"}
        />
        <Field
          label={translate("dashboard_home.amount")}
          value={formatMoney(deal.plan_amount, currency)}
        />
      </dl>
      {expanded ? (
        <div className="rounded-lg bg-muted px-3 py-2 text-[13px] leading-snug">
          {deal.next_task_text ? (
            <p>{deal.next_task_text}</p>
          ) : (
            <p className="text-muted-foreground">
              {translate("dashboard_home.no_task")}
            </p>
          )}
          {deal.last_message_text ? (
            <p className="mt-1 line-clamp-2 text-muted-foreground">
              «{deal.last_message_text}»
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground hover:bg-foreground hover:text-background"
          aria-label={translate(
            expanded ? "dashboard_home.collapse" : "dashboard_home.expand",
          )}
          aria-expanded={expanded}
        >
          <svg
            viewBox="0 0 24 24"
            className={cn(
              "size-4 transition-transform",
              expanded && "rotate-180",
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <Link
          to={`/deals/${deal.id}/show`}
          className="flex h-9 flex-1 items-center justify-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline shadow-[0_10px_22px_-12px_rgba(239,59,110,0.9)] hover:bg-primary/90"
        >
          {translate("dashboard_home.open_deal")}
        </Link>
      </div>
    </article>
  );
};

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[11px] text-muted-foreground">{label}</dt>
    <dd className="truncate font-semibold">{value}</dd>
  </div>
);

const TASK_TONE: Record<TaskType, string> = {
  call: "bg-primary text-primary-foreground",
  message: "bg-tone-blue text-white",
  meeting: "bg-tone-violet text-white",
  reminder: "bg-tone-orange text-white",
  other: "bg-tone-pink-soft text-foreground",
};

/**
 * «Задачи на день»: today's tasks along the hours, each a colored pill by
 * its type; done ones are ticked (the reference's day line).
 */
export const DayTimeline = () => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const today = startOfToday();
  const { data: tasks = [] } = useGetList<Task>(
    "tasks",
    {
      pagination: { page: 1, perPage: 200 },
      sort: { field: "due_date", order: "ASC" },
      filter: {
        "due_date@gte": today.toISOString(),
        "due_date@lt": addDays(today, 1).toISOString(),
        ...(identity?.id != null ? { sales_id: identity.id } : {}),
      },
    },
    { enabled: identity?.id != null },
  );
  return (
    <section className="rounded-xl bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
          {translate("dashboard_home.day_tasks")}
        </h2>
        <Link
          to="/tasks"
          className="flex size-8 items-center justify-center rounded-full border-2 border-foreground/70 text-base leading-none font-semibold text-foreground no-underline hover:border-primary hover:text-primary"
          aria-label={translate("dashboard_home.all_tasks")}
          title={translate("dashboard_home.all_tasks")}
        >
          +
        </Link>
        <Link
          to="/tasks"
          className="ml-auto text-sm font-semibold text-foreground no-underline hover:text-primary"
        >
          {translate("dashboard_home.edit")}
        </Link>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("dashboard_home.no_day_tasks")}
        </p>
      ) : (
        <ol className="relative flex flex-col gap-3">
          {tasks.map((task, index) => {
            const done = !!task.done_date;
            return (
              <li key={task.id} className="relative flex items-center gap-3">
                <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">
                  {new Intl.DateTimeFormat("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(task.due_date))}
                </span>
                <span className="relative flex w-5 shrink-0 justify-center self-stretch">
                  {index < tasks.length - 1 ? (
                    <span
                      className="absolute top-1/2 bottom-[-0.75rem] w-px border-l-2 border-dotted border-foreground/20"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-10 my-auto flex size-5 items-center justify-center rounded-full text-[11px] font-bold",
                      done
                        ? "bg-tone-green text-white"
                        : "border-2 border-foreground/25 bg-card",
                    )}
                    aria-label={
                      done ? translate("dashboard_home.done") : undefined
                    }
                  >
                    {done ? "✓" : null}
                  </span>
                </span>
                <Link
                  to={`/deals/${task.deal_id}/show`}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-full px-4 py-2 text-sm font-semibold no-underline transition-opacity hover:opacity-90",
                    done
                      ? "bg-muted text-muted-foreground line-through"
                      : (TASK_TONE[task.type] ?? TASK_TONE.other),
                  )}
                  title={task.text}
                >
                  {task.text}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
