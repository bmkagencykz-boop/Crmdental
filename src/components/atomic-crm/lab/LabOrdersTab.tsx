import {
  useDataProvider,
  useNotify,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { useDoctors } from "../dictionaries/useDictionaries";
import { Molar3D } from "../misc/Dental3D";
import type { CrmDataProvider } from "../providers/types";
import { LabFittingVisitDialog } from "./LabFittingVisit";
import { LabRemakeDialog } from "./LabRemakeDialog";
import {
  CrossGlyph,
  OverdueChip,
  PillTabs,
  PlusGlyph,
  StatusChip,
} from "./LabBits";
import { LabOrderCard } from "./LabOrderCard";
import type { OpenOrder } from "./LabPage";
import {
  EMPTY_FILTERS,
  filterOrders,
  labKpis,
  localDay,
  sameMonth,
  shiftMonth,
  shortDay,
  sortForBoard,
  type LabFilters,
  tenge,
} from "./labMath";
import type { LabOrderSummary, LabStatus } from "./types";
import {
  useLabDictionaries,
  useLabOrderPdf,
  useLabOrders,
  useLabRights,
  useRefreshLab,
} from "./useLab";
import { CountUp } from "../misc/CountUp";

type View = "board" | "list";
type ChipKind = "doctorIds" | "technicianIds" | "labIds";

/**
 * «Наряды»: the KPI row (in work, done this month, overdue deadlines), the
 * filter chips (doctors, technicians, labs: × and «+»), the scope, and the
 * orders as a board of cards or as a list.
 */
export const LabOrdersTab = ({ onOpen }: { onOpen: OpenOrder }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshLab();
  const rights = useLabRights();
  const pdf = useLabOrderPdf();
  const { orders, isPending } = useLabOrders();
  const [view, setView] = useStore<View>("lab.view", "board");
  const [filters, setFilters] = useStore<LabFilters>(
    "lab.filters",
    EMPTY_FILTERS,
  );
  const today = localDay();
  const kpis = useMemo(() => labKpis(orders, today), [orders, today]);
  const shown = useMemo(
    () => sortForBoard(filterOrders(orders, filters), today),
    [orders, filters, today],
  );

  // Stage 43: «Переделка» asks the reason, «Записать на примерку»
  const [remaking, setRemaking] = useState<LabOrderSummary | null>(null);
  const [booking, setBooking] = useState<LabOrderSummary | null>(null);

  const setStatus = async (order: LabOrderSummary, status: LabStatus) => {
    if (status === "remake") {
      setRemaking(order);
      return;
    }
    try {
      await dataProvider.update("lab_orders", {
        id: order.id,
        data: { status },
        previousData: order,
      });
      notify(status === "delivered" ? "lab.closed_ok" : "lab.status_ok", {
        type: "info",
        messageArgs: {
          number: order.number,
          status: translate(`lab.statuses.${status}`),
        },
      });
      await refresh();
    } catch (error) {
      notify((error as Error).message || "ra.notification.http_error", {
        type: "error",
      });
    }
  };

  return (
    <>
      <KpiRow kpis={kpis} orders={orders} today={today} />
      <FilterRow filters={filters} onChange={setFilters} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="lab-count">
          {shown.length} / {orders.length}
        </p>
        <PillTabs
          size="sm"
          label={translate("lab.view.board")}
          value={view}
          onChange={setView}
          options={[
            { value: "board", label: translate("lab.view.board") },
            { value: "list", label: translate("lab.view.list") },
          ]}
        />
      </div>
      {isPending ? null : !shown.length ? (
        <EmptyOrders filtered={orders.length > 0} />
      ) : view === "board" ? (
        <div
          className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-3"
          data-testid="lab-board"
        >
          {shown.map((order) => (
            <LabOrderCard
              key={order.id}
              order={order}
              today={today}
              canWrite={rights.canWrite}
              seesMoney={rights.seesMoney}
              onStatus={setStatus}
              onClose={(o) => setStatus(o, "delivered")}
              onEdit={(o) => onOpen(o.id)}
              onPdf={(o) => pdf(o.id)}
              onBookFitting={setBooking}
            />
          ))}
        </div>
      ) : (
        <OrdersList
          orders={shown}
          seesMoney={rights.seesMoney}
          onOpen={onOpen}
        />
      )}
      {remaking ? (
        <LabRemakeDialog order={remaking} onClose={() => setRemaking(null)} />
      ) : null}
      {booking ? (
        <LabFittingVisitDialog
          order={booking}
          onClose={() => setBooking(null)}
        />
      ) : null}
    </>
  );
};

/** The three KPIs: «23 в работе ↑13 · 13 выполнено · 4 дедлайн» */
const KpiRow = ({
  kpis,
  orders,
  today,
}: {
  kpis: ReturnType<typeof labKpis>;
  orders: LabOrderSummary[];
  today: string;
}) => {
  const translate = useTranslate();
  // Works ready in each of the last six months (hatched: this one)
  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(today, i - 5));
  const perMonth = months.map(
    (month) => orders.filter((o) => sameMonth(o.ready_at, month)).length,
  );
  const max = Math.max(1, ...perMonth);
  const monthLabel = (month: string) =>
    new Date(`${month}T00:00:00`).toLocaleDateString("ru-RU", {
      month: "short",
    });
  const change = kpis.doneChange;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <section
        className="relative flex min-h-[13rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink"
        aria-label={translate("lab.kpi.in_work")}
      >
        <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("lab.kpi.in_work")}
        </h2>
        <p className="mt-1 text-sm opacity-80">
          {translate("lab.kpi.in_work_hint")}
        </p>
        <div className="mt-auto flex items-end gap-3">
          <span
            className="text-[64px] leading-none font-light tracking-[-0.04em] tabular-nums"
            data-testid="lab-kpi-in-work"
          >
            <CountUp>{kpis.inWork}</CountUp>
          </span>
          <span className="mb-2 rounded-full bg-white/50 px-3 py-1.5 text-sm tabular-nums">
            ↑ {translate("lab.kpi.new_in_work", { count: kpis.newInWork })}
          </span>
        </div>
        <Molar3D
          tone="soft"
          className="pointer-events-none absolute -top-6 -right-6 w-36 opacity-90"
        />
      </section>

      <StudioCard
        title={translate("lab.kpi.done")}
        subtitle={translate("lab.kpi.done_hint")}
      >
        <div className="flex flex-1 items-end gap-5">
          <div className="flex flex-col gap-2">
            <span
              className="text-[52px] leading-none font-light tracking-[-0.04em] tabular-nums"
              data-testid="lab-kpi-done"
            >
              <CountUp>{kpis.done}</CountUp>
            </span>
            <span className="w-fit rounded-lg bg-neon px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-neon-ink">
              {translate("lab.kpi.done_change", {
                value: `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}`,
              })}
            </span>
          </div>
          <div className="flex h-24 flex-1 items-end gap-1.5">
            {perMonth.map((count, i) => (
              <div
                key={months[i]}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <div
                  className={cn(
                    "animate-grow-y w-full rounded-[10px]",
                    i === perMonth.length - 1
                      ? "hatch border border-foreground/15 bg-pill"
                      : "bg-muted",
                  )}
                  style={{
                    height: `${Math.max(10, (count / max) * 100)}%`,
                    animationDelay: `${i * 70}ms`,
                  }}
                  title={`${monthLabel(months[i])}: ${count}`}
                />
                <span className="text-[10px] text-muted-foreground">
                  {monthLabel(months[i])}
                </span>
              </div>
            ))}
          </div>
        </div>
      </StudioCard>

      <StudioCard
        title={translate("lab.kpi.overdue")}
        subtitle={translate("lab.kpi.overdue_hint")}
      >
        <div className="flex flex-1 flex-col justify-end gap-3">
          <span
            className={cn(
              "text-[52px] leading-none font-light tracking-[-0.04em] tabular-nums",
              kpis.overdue > 0 && "text-tone-red",
            )}
            data-testid="lab-kpi-overdue"
          >
            <CountUp>{kpis.overdue}</CountUp>
          </span>
          <span className="w-fit rounded-full bg-muted px-3 py-1.5 text-sm">
            {translate("lab.kpi.due_week", { count: kpis.dueThisWeek })}
          </span>
        </div>
      </StudioCard>
    </div>
  );
};

/** Scope, search and the × chips with the «+» menu, like the reference */
const FilterRow = ({
  filters,
  onChange,
}: {
  filters: LabFilters;
  onChange: (filters: LabFilters) => void;
}) => {
  const translate = useTranslate();
  const { data: doctors } = useDoctors();
  const { labs, technicians } = useLabDictionaries();
  const sources: Record<
    ChipKind,
    { label: string; items: Array<{ id: Identifier; name: string }> }
  > = {
    doctorIds: { label: translate("lab.filters.doctors"), items: doctors },
    technicianIds: {
      label: translate("lab.filters.technicians"),
      items: technicians,
    },
    labIds: { label: translate("lab.filters.labs"), items: labs },
  };
  const toggle = (kind: ChipKind, id: Identifier) => {
    const key = String(id);
    const list = filters[kind];
    onChange({
      ...filters,
      [kind]: list.includes(key)
        ? list.filter((value) => value !== key)
        : [...list, key],
    });
  };
  const chips = (Object.keys(sources) as ChipKind[]).flatMap((kind) =>
    filters[kind].map((id) => ({
      kind,
      id,
      name:
        sources[kind].items.find((item) => String(item.id) === id)?.name ??
        `#${id}`,
    })),
  );
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="lab-filters"
    >
      <PillTabs
        size="sm"
        label={translate("lab.scope.active")}
        value={filters.scope}
        onChange={(scope) => onChange({ ...filters, scope })}
        options={(["active", "done", "all"] as const).map((scope) => ({
          value: scope,
          label: translate(`lab.scope.${scope}`),
        }))}
      />
      <Input
        value={filters.q ?? ""}
        onChange={(event) => onChange({ ...filters, q: event.target.value })}
        placeholder={translate("lab.filters.search")}
        className="h-9 w-56 bg-card"
        aria-label={translate("lab.filters.search")}
      />
      {chips.map((chip) => (
        <span
          key={`${chip.kind}-${chip.id}`}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-card pr-1 pl-3.5 text-sm"
          data-testid="lab-filter-chip"
        >
          {chip.name}
          <button
            type="button"
            onClick={() => toggle(chip.kind, chip.id)}
            className="flex size-7 items-center justify-center rounded-full hover:bg-muted"
            aria-label={translate("lab.filters.remove", { name: chip.name })}
            title={translate("lab.filters.remove", { name: chip.name })}
          >
            <CrossGlyph />
          </button>
        </span>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={translate("lab.filters.add")}
          title={translate("lab.filters.add")}
          data-testid="lab-filter-add"
        >
          <PlusGlyph />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="rounded-2xl">
          {(Object.keys(sources) as ChipKind[]).map((kind) => (
            <DropdownMenuSub key={kind}>
              <DropdownMenuSubTrigger className="rounded-xl">
                {sources[kind].label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto rounded-2xl">
                {sources[kind].items.map((item) => (
                  <DropdownMenuCheckboxItem
                    key={item.id}
                    checked={filters[kind].includes(String(item.id))}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggle(kind, item.id)}
                    className="rounded-xl"
                  >
                    {item.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {chips.length || filters.q ? (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_FILTERS, scope: filters.scope })}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {translate("lab.filters.clear")}
        </button>
      ) : null}
    </div>
  );
};

const EmptyOrders = ({ filtered }: { filtered: boolean }) => {
  const translate = useTranslate();
  return (
    <section className="relative flex min-h-[16rem] flex-col items-start justify-center overflow-hidden rounded-[28px] bg-card p-8">
      <h2 className="text-[26px] font-normal tracking-[-0.02em]">
        {filtered
          ? translate("lab.empty.filtered")
          : translate("lab.empty.title")}
      </h2>
      {!filtered ? (
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {translate("lab.empty.hint")}
        </p>
      ) : null}
      <Molar3D className="pointer-events-none absolute -right-4 -bottom-10 w-48" />
    </section>
  );
};

/** The list view: one row per order */
const OrdersList = ({
  orders,
  seesMoney,
  onOpen,
}: {
  orders: LabOrderSummary[];
  seesMoney: boolean;
  onOpen: OpenOrder;
}) => {
  const translate = useTranslate();
  const head = [
    "number",
    "created_at",
    "patient",
    "doctor",
    "lab",
    "works",
    "status",
    "due_at",
    "overdue",
    ...(seesMoney ? ["lab_cost"] : []),
  ];
  return (
    <section className="overflow-x-auto rounded-[28px] bg-card p-3">
      <table className="w-full text-sm" data-testid="lab-list">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {head.map((column) => (
              <th key={column} className="px-3 py-2 font-normal">
                {translate(`lab.fields.${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr
              key={order.id}
              className="cursor-pointer border-t border-border/50 hover:bg-muted/60"
              onClick={() => onOpen(order.id)}
            >
              <td className="px-3 py-2.5 tabular-nums">{order.number}</td>
              <td className="px-3 py-2.5 tabular-nums">
                {shortDay(localDay(new Date(order.created_at)), true)}
              </td>
              <td className="px-3 py-2.5">
                <Link
                  to={`/patients/${order.patient_id}/show`}
                  onClick={(event) => event.stopPropagation()}
                  className="text-foreground no-underline hover:underline"
                >
                  {order.patient_name ?? "—"}
                </Link>
              </td>
              <td className="px-3 py-2.5">{order.doctor_name ?? "—"}</td>
              <td className="px-3 py-2.5">
                {[order.lab_name, order.technician_name]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </td>
              <td
                className="max-w-64 truncate px-3 py-2.5"
                title={order.works ?? ""}
              >
                {order.works ?? "—"}
              </td>
              <td className="px-3 py-2">
                <StatusChip status={order.status} className="h-8" />
              </td>
              <td className="px-3 py-2.5 tabular-nums">
                {shortDay(order.due_at, true)}
              </td>
              <td className="px-3 py-2">
                <OverdueChip days={order.overdue_days} />
              </td>
              {seesMoney ? (
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {tenge(order.lab_cost)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
