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
import { accent } from "../misc/accent";
import { Molar3D } from "../misc/Dental3D";
import type { Deal, Sale, Task, TaskType } from "../types";
import { ArrowButton } from "./StudioCards";

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
          "text-[40px] leading-none font-light tracking-[-0.04em] tabular-nums",
          accent ? "text-brand-link" : "text-foreground",
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
        <h2 className="mr-2 text-[30px] font-normal tracking-[-0.03em]">
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
        <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-3 [scrollbar-width:thin]">
          {cards.map((deal, index) => (
            <DealWorkCard
              key={deal.id}
              deal={deal}
              sales={sales}
              highlighted={index === 0}
            />
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

/**
 * A deal as the reference's person card: the patient on top with the round
 * «↗» in the notch, the service and its date in the middle, the stage pill
 * and the «write» / «call» buttons at the bottom. The first card is neon.
 */
const DealWorkCard = ({
  deal,
  sales,
  highlighted,
}: {
  deal: Deal;
  sales: Sale[];
  highlighted: boolean;
}) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: services } = useServices();
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
  const patient =
    [deal.patient_last_name, deal.patient_first_name]
      .filter(Boolean)
      .join(" ") ||
    deal.patient_phone ||
    translate("dashboard_home.patient");
  const service = findById(services, deal.service_id)?.name ?? deal.name ?? "—";
  const when = shortDateTime(deal.appointment_at ?? deal.next_task_due_at);
  const people = [deal.doctor_name, saleName].filter(Boolean) as string[];
  return (
    <article
      className="relative w-[21rem] shrink-0 snap-start"
      data-testid="dashboard-deal-card"
    >
      <div
        className={cn(
          "notch flex h-full flex-col gap-5 rounded-[28px] p-4",
          highlighted ? "bg-neon text-neon-ink" : "bg-card",
        )}
      >
        <div className="flex items-center gap-3 pr-16">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              highlighted ? "bg-white/70" : "bg-pill",
            )}
          >
            {initials(patient)}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[19px] font-normal tracking-[-0.02em]">
              {patient}
            </div>
            <div
              className={cn(
                "truncate text-xs",
                highlighted ? "text-neon-ink/70" : "text-muted-foreground",
              )}
            >
              {formatMoney(deal.plan_amount, currency)} · № {deal.id}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full border",
              highlighted
                ? "border-neon-ink/15 bg-white/60"
                : "border-border bg-pill",
            )}
          >
            <Molar3D className="h-7" tone={highlighted ? "ink" : "neon"} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[17px] font-normal tracking-[-0.01em]">
              {service}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs">
              <span className="flex">
                {people.map((name, index) => (
                  <span
                    key={name}
                    className={cn(
                      "-ml-1.5 flex size-5 items-center justify-center rounded-full border text-[8px] font-bold first:ml-0",
                      highlighted
                        ? "border-neon bg-white text-neon-ink"
                        : "border-card bg-primary text-primary-foreground",
                    )}
                    style={{ zIndex: 5 - index }}
                    title={name}
                  >
                    {initials(name)}
                  </span>
                ))}
              </span>
              <span className="truncate tabular-nums">
                {when ?? translate("dashboard_home.no_task")}
              </span>
              {overdueDays > 0 ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 text-[10px] font-semibold",
                    highlighted
                      ? "bg-neon-ink text-white"
                      : "bg-neon text-neon-ink",
                  )}
                >
                  {translate("dashboard_home.overdue_days", {
                    smart_count: overdueDays,
                  })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2">
          <Link
            to={`/deals/${deal.id}/show`}
            className={cn(
              "flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border pr-4 pl-1.5 text-sm no-underline",
              highlighted
                ? "border-neon-ink/20 text-neon-ink"
                : "border-border text-foreground hover:bg-pill",
            )}
          >
            <span
              className="size-9 shrink-0 rounded-full"
              style={{ background: accent(stage?.color) }}
            />
            <span className="truncate">{stage?.name ?? "—"}</span>
            <span className="ml-auto text-xs" aria-hidden>
              ▾
            </span>
          </Link>
          <Link
            to={`/deals/${deal.id}/show`}
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-full border no-underline",
              highlighted
                ? "border-neon-ink/20 text-neon-ink"
                : "border-border text-foreground hover:bg-pill",
            )}
            aria-label={translate("dashboard_home.write")}
            title={translate("dashboard_home.write")}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
              <path d="M4 7l8 6 8-6" />
            </svg>
          </Link>
          {deal.patient_phone ? (
            <a
              href={`tel:${deal.patient_phone}`}
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground no-underline"
              aria-label={translate("dashboard_home.call")}
              title={deal.patient_phone}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z" />
              </svg>
            </a>
          ) : null}
        </div>
      </div>
      <ArrowButton
        to={`/deals/${deal.id}/show`}
        label={translate("dashboard_home.open_deal")}
        className="absolute top-0 right-0"
      />
    </article>
  );
};

const TASK_TONE: Record<TaskType, string> = {
  call: "bg-neon text-neon-ink",
  message: "bg-primary text-primary-foreground",
  meeting: "bg-tone-violet text-white",
  reminder: "bg-neon-soft text-neon-ink",
  other: "bg-pill text-foreground",
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
        <h2 className="text-[26px] font-normal tracking-[-0.03em]">
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
