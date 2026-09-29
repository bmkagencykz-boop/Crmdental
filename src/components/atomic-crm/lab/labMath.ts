import type { Identifier } from "ra-core";

import { formatTenge } from "../onboarding/servicePresets";
import type {
  Lab,
  LabOrder,
  LabOrderCost,
  LabPayment,
  LabSettlementRow,
  LabStatus,
} from "./types";

/**
 * Pure rules of the lab work orders (stage 40), shared by the page and the
 * demo. Twins of supabase/schemas/40_lab_orders.sql: overdueDays ↔
 * private.lab_overdue_days, applyLabStatus ↔ the status part of
 * private.handle_lab_order_before_write, labSettlement ↔
 * public.report_lab_settlement, dueReminders ↔ private.lab_orders_tick.
 * Dates are local days «YYYY-MM-DD».
 */

/** The shades of the VITA classical guide */
export const VITA_SHADES = [
  "A1",
  "A2",
  "A3",
  "A3.5",
  "A4",
  "B1",
  "B2",
  "B3",
  "B4",
  "C1",
  "C2",
  "C3",
  "C4",
  "D2",
  "D3",
  "D4",
  "BL1",
  "BL2",
  "BL3",
  "BL4",
];

/** The order of the statuses on the board and in the menus */
export const STATUS_FLOW: LabStatus[] = [
  "clinic",
  "courier",
  "lab",
  "fitting",
  "remake",
  "ready",
  "delivered",
];

/** Active: the work is not back from the lab yet */
export const isActive = (status: LabStatus) =>
  status !== "ready" && status !== "delivered";

const pad = (n: number) => String(n).padStart(2, "0");

/** «2026-09-29» of a local date */
export const localDay = (date: Date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const parseDay = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (day: string, days: number) => {
  const date = parseDay(day);
  date.setDate(date.getDate() + days);
  return localDay(date);
};

/** Whole days from a to b (b − a) */
export const daysBetween = (a: string, b: string) =>
  Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

/** «2026-09-01» of the month of a day */
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

export const shiftMonth = (day: string, months: number) => {
  const date = parseDay(monthStart(day));
  date.setMonth(date.getMonth() + months);
  return localDay(date);
};

export const sameMonth = (day: string | null | undefined, month: string) =>
  !!day && day.slice(0, 7) === month.slice(0, 7);

/** Days an order is overdue (0 when it is not): private.lab_overdue_days */
export const overdueDays = (
  status: LabStatus,
  dueAt: string | null | undefined,
  today: string,
) => {
  if (!isActive(status) || !dueAt || dueAt >= today) return 0;
  return daysBetween(dueAt, today);
};

/**
 * The dates a status stamps (the status part of
 * handle_lab_order_before_write): sent to the lab, ready, given to the
 * patient; a remake counts and reopens the order; a date given to the
 * patient closes it. `before` is null for a new order.
 */
export const applyLabStatus = <T extends Partial<LabOrder>>(
  before: Partial<LabOrder> | null,
  data: T,
  today: string,
): T & Partial<LabOrder> => {
  const next = { ...before, ...data } as Partial<LabOrder>;
  let status = (next.status ?? "clinic") as LabStatus;
  let remakeCount = before ? (before.remake_count ?? 0) : 0;
  if (next.delivered_at && status !== "delivered" && !before?.delivered_at) {
    status = "delivered";
  }
  if (status === "remake" && before?.status !== "remake") {
    remakeCount += 1;
  }
  const sentAt =
    ["lab", "courier", "fitting"].includes(status) && !next.sent_at
      ? today
      : (next.sent_at ?? null);
  const readyAt =
    status === "ready" || status === "delivered"
      ? (next.ready_at ?? today)
      : null;
  const deliveredAt =
    status === "delivered" ? (next.delivered_at ?? today) : null;
  return {
    ...data,
    status,
    remake_count: remakeCount,
    sent_at: sentAt,
    ready_at: readyAt,
    delivered_at: deliveredAt,
  };
};

export type LabEventKind = "fitting1" | "fitting2" | "due";

/** The next fitting or the due date of an active order, today included */
export const nextEvent = (
  order: Pick<LabOrder, "status" | "fitting1_at" | "fitting2_at" | "due_at">,
  today: string,
): { kind: LabEventKind; day: string } | null => {
  if (!isActive(order.status)) return null;
  const events = (
    [
      ["fitting1", order.fitting1_at],
      ["fitting2", order.fitting2_at],
      ["due", order.due_at],
    ] as const
  )
    .filter(([, day]) => !!day && day >= today)
    .map(([kind, day]) => ({ kind, day: day as string }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return events[0] ?? null;
};

/**
 * The reminders private.lab_orders_tick sends for an order today: the day
 * before and the day of a fitting or the due date, and overdue.
 */
export const dueReminders = (
  order: Pick<LabOrder, "status" | "fitting1_at" | "fitting2_at" | "due_at">,
  today: string,
): Array<{ kind: LabEventKind | "overdue"; day: string }> => {
  if (!isActive(order.status)) return [];
  const tomorrow = addDays(today, 1);
  const soon = (day?: string | null) =>
    !!day && day >= today && day <= tomorrow;
  const reminders: Array<{ kind: LabEventKind | "overdue"; day: string }> = [];
  if (soon(order.fitting1_at))
    reminders.push({ kind: "fitting1", day: order.fitting1_at! });
  if (soon(order.fitting2_at))
    reminders.push({ kind: "fitting2", day: order.fitting2_at! });
  if (soon(order.due_at)) reminders.push({ kind: "due", day: order.due_at! });
  if (order.due_at && order.due_at < today)
    reminders.push({ kind: "overdue", day: order.due_at });
  return reminders;
};

type KpiOrder = Pick<LabOrder, "status" | "due_at" | "ready_at" | "created_at">;

/**
 * The KPI row: in work (and how many of them came in the last 30 days),
 * done this month against the last one, overdue deadlines (and the
 * deadlines of the next 7 days).
 */
export const labKpis = (orders: KpiOrder[], today: string) => {
  const month = monthStart(today);
  const lastMonth = shiftMonth(today, -1);
  const monthAgo = addDays(today, -30);
  const active = orders.filter((order) => isActive(order.status));
  const done = orders.filter((order) => sameMonth(order.ready_at, month));
  // The same number of days of the last month, for a fair comparison
  const lastDay = addDays(lastMonth, daysBetween(month, today));
  const doneBefore = orders.filter(
    (order) =>
      sameMonth(order.ready_at, lastMonth) && order.ready_at! <= lastDay,
  );
  return {
    inWork: active.length,
    newInWork: active.filter(
      (order) => localDay(new Date(order.created_at)) >= monthAgo,
    ).length,
    done: done.length,
    doneChange: done.length - doneBefore.length,
    overdue: active.filter(
      (order) => overdueDays(order.status, order.due_at, today) > 0,
    ).length,
    dueThisWeek: active.filter(
      (order) =>
        !!order.due_at &&
        order.due_at >= today &&
        order.due_at <= addDays(today, 7),
    ).length,
  };
};

/** Σ qty × price of the lines of an order */
export const orderCost = (
  lines: Array<{ qty: number; price?: number | null }>,
) =>
  lines.reduce(
    (sum, line) => sum + Number(line.qty) * Number(line.price ?? 0),
    0,
  );

/**
 * «Сумма лаборатории»: per lab, the orders, works and sum of the lines of
 * the works ready in the month, what was paid for the month (lab payments,
 * stage 42), the balance of the month and of every month up to it
 * (public.report_lab_settlement). `costs` may hold the earlier months too:
 * they only count in total_balance. Labs with works, payments or a balance.
 */
export const labSettlement = (
  costs: LabOrderCost[],
  labs: Pick<Lab, "id" | "name" | "is_own">[],
  month: string,
  payments: Pick<LabPayment, "lab_id" | "month" | "amount">[] = [],
): LabSettlementRow[] => {
  const start = monthStart(month);
  const rows = new Map<string, LabSettlementRow & { orders: Set<string> }>();
  const rowOf = (lab: Pick<Lab, "id" | "name" | "is_own">) => {
    const key = String(lab.id);
    const row = rows.get(key) ?? {
      lab_id: lab.id,
      lab_name: lab.name,
      is_own: lab.is_own,
      orders_count: 0,
      items_count: 0,
      amount: 0,
      paid: 0,
      balance: 0,
      total_balance: 0,
      orders: new Set<string>(),
    };
    rows.set(key, row);
    return row;
  };
  const labOf = (id: Identifier | null | undefined) =>
    labs.find((l) => String(l.id) === String(id));
  for (const line of costs) {
    const lab = labOf(line.lab_id);
    if (!lab || !line.ready_at || monthStart(line.ready_at) > start) continue;
    const row = rowOf(lab);
    const sum = Number(line.qty) * Number(line.price);
    row.total_balance += sum;
    if (!sameMonth(line.ready_at, start)) continue;
    row.orders.add(String(line.order_id));
    row.items_count += Number(line.qty);
    row.amount += sum;
  }
  for (const payment of payments) {
    const lab = labOf(payment.lab_id);
    if (!lab || monthStart(payment.month) > start) continue;
    const row = rowOf(lab);
    row.total_balance -= Number(payment.amount);
    if (sameMonth(payment.month, start)) row.paid += Number(payment.amount);
  }
  return [...rows.values()]
    .map(({ orders, ...row }) => ({
      ...row,
      orders_count: orders.size,
      balance: row.amount - row.paid,
    }))
    .filter(
      (row) => row.orders_count > 0 || row.paid > 0 || row.total_balance !== 0,
    )
    .sort(
      (a, b) => b.amount - a.amount || a.lab_name.localeCompare(b.lab_name),
    );
};

/** The lab cost of a doctor in a month (private.lab_cost_for_doctor) */
export const doctorLabCost = (
  costs: LabOrderCost[],
  doctorId: Identifier,
  month: string,
) =>
  costs
    .filter(
      (line) =>
        String(line.doctor_id) === String(doctorId) &&
        sameMonth(line.ready_at, month),
    )
    .reduce((sum, line) => sum + Number(line.qty) * Number(line.price), 0);

export type CourierRange = "day" | "week" | "month";

/** The days of a courier view: a day, its week (Mon–Sun) or its month */
export const courierDays = (range: CourierRange, anchor: string): string[] => {
  if (range === "day") return [anchor];
  if (range === "week") {
    const weekday = (parseDay(anchor).getDay() + 6) % 7;
    const monday = addDays(anchor, -weekday);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }
  const first = monthStart(anchor);
  const days: string[] = [];
  for (let day = first; sameMonth(day, first); day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
};

export type CourierEvent = {
  day: string;
  /** pickup «Привоз» (from the lab), dropoff «Отвоз» (to the lab) */
  direction: "pickup" | "dropoff";
  kind: "send" | "fitting1" | "fitting2" | "due";
  /** The trip already happened (the work is back, or it was sent) */
  done: boolean;
  /** Not sent yet: waits for the courier */
  pending?: boolean;
  orderId: Identifier;
};

type CourierOrder = Pick<
  LabOrder,
  | "id"
  | "status"
  | "lab_id"
  | "sent_at"
  | "fitting1_at"
  | "fitting2_at"
  | "due_at"
  | "ready_at"
>;

/**
 * «Курьеры»: the trips of the external labs' orders on the given days.
 * «Отвоз» — the work goes to the lab (sent, or still in the clinic: today)
 * and back after a fitting; «Привоз» — it comes for a fitting or ready on
 * the due date (ready earlier: the day it was ready). The own lab needs no
 * courier.
 */
export const courierEvents = (
  orders: CourierOrder[],
  labs: Pick<Lab, "id" | "is_own">[],
  days: string[],
  today: string,
): CourierEvent[] => {
  const inRange = new Set(days);
  const own = new Set(
    labs.filter((lab) => lab.is_own).map((lab) => String(lab.id)),
  );
  const events: CourierEvent[] = [];
  const add = (event: CourierEvent) => {
    if (inRange.has(event.day)) events.push(event);
  };
  for (const order of orders) {
    if (order.lab_id != null && own.has(String(order.lab_id))) continue;
    const back = !isActive(order.status);
    if (order.sent_at) {
      add({
        day: order.sent_at,
        direction: "dropoff",
        kind: "send",
        done: true,
        orderId: order.id,
      });
    } else if (order.status === "clinic" || order.status === "courier") {
      add({
        day: today,
        direction: "dropoff",
        kind: "send",
        done: false,
        pending: true,
        orderId: order.id,
      });
    }
    for (const kind of ["fitting1", "fitting2"] as const) {
      const day = order[`${kind}_at`];
      if (!day) continue;
      const passed = back || day < today;
      add({ day, direction: "pickup", kind, done: passed, orderId: order.id });
      add({ day, direction: "dropoff", kind, done: passed, orderId: order.id });
    }
    const arrival = order.ready_at ?? order.due_at;
    if (arrival) {
      add({
        day: arrival,
        direction: "pickup",
        kind: "due",
        done: back,
        orderId: order.id,
      });
    }
  }
  const order = { dropoff: 0, pickup: 1 };
  return events.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      order[a.direction] - order[b.direction] ||
      String(a.orderId).localeCompare(String(b.orderId), undefined, {
        numeric: true,
      }),
  );
};

export type LabFilters = {
  doctorIds: string[];
  technicianIds: string[];
  labIds: string[];
  /** active: in work; done: ready or given; all */
  scope: "active" | "done" | "all";
  q?: string;
};

export const EMPTY_FILTERS: LabFilters = {
  doctorIds: [],
  technicianIds: [],
  labIds: [],
  scope: "active",
  q: "",
};

type FilterOrder = Pick<
  LabOrder,
  "status" | "doctor_id" | "technician_id" | "lab_id" | "number"
> & { patient_name?: string | null; works?: string | null };

/** The chips of the board: doctors, technicians, labs (any of each) */
export const filterOrders = <T extends FilterOrder>(
  orders: T[],
  filters: LabFilters,
): T[] => {
  const has = (list: string[], id: Identifier | null | undefined) =>
    !list.length || (id != null && list.includes(String(id)));
  const q = (filters.q ?? "").trim().toLowerCase();
  return orders.filter(
    (order) =>
      has(filters.doctorIds, order.doctor_id) &&
      has(filters.technicianIds, order.technician_id) &&
      has(filters.labIds, order.lab_id) &&
      (filters.scope === "all" ||
        (filters.scope === "active") === isActive(order.status)) &&
      (!q ||
        [String(order.number), order.patient_name, order.works]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)),
  );
};

/** Board order: overdue first (most days), then the nearest date */
export const sortForBoard = <
  T extends Pick<
    LabOrder,
    "status" | "fitting1_at" | "fitting2_at" | "due_at" | "number"
  >,
>(
  orders: T[],
  today: string,
): T[] => {
  const key = (order: T) => {
    const overdue = overdueDays(order.status, order.due_at, today);
    const next = nextEvent(order, today)?.day ?? "9999-12-31";
    return { overdue, next, active: isActive(order.status) ? 0 : 1 };
  };
  return [...orders].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (
      ka.active - kb.active ||
      kb.overdue - ka.overdue ||
      ka.next.localeCompare(kb.next) ||
      b.number - a.number
    );
  });
};

/** Initials of a name for the avatar: «Ахметова Айгуль» → «АА» */
export const initials = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "—";

/** «29.09» / «29.09.2026» of a day */
export const shortDay = (day: string | null | undefined, withYear = false) => {
  if (!day) return "—";
  const [y, m, d] = day.slice(0, 10).split("-");
  return withYear ? `${d}.${m}.${y}` : `${d}.${m}`;
};

/** Teeth for people: «11, 21, 36» */
export const teethText = (teeth: number[] | null | undefined) =>
  [...(teeth ?? [])].sort((a, b) => a - b).join(", ");

/** «12 500 ₸» */
export const tenge = (amount: number | null | undefined) =>
  `${formatTenge(Math.round(Number(amount ?? 0)))} ₸`;
