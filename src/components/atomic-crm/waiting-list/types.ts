import type { Identifier } from "ra-core";

/** Statuses of an entry, in their order */
export const WAITING_STATUSES = [
  "waiting",
  "offered",
  "booked",
  "cancelled",
] as const;
export type WaitingStatus = (typeof WAITING_STATUSES)[number];

/** Still on the list: a time can be offered and booked */
export const ACTIVE_STATUSES: WaitingStatus[] = ["waiting", "offered"];

export const PRIORITIES = ["normal", "urgent"] as const;
export type WaitingPriority = (typeof PRIORITIES)[number];

/** Parts of the day by the start of the visit: < 12:00, < 16:00, later */
export const DAY_PARTS = ["morning", "day", "evening"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** ISO days of the week, 1 (Monday) … 7 (Sunday) */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** An entry of the waiting list (public.waiting_list, stage 38) */
export type WaitingEntry = {
  id: Identifier;
  patient_id: Identifier;
  deal_id?: Identifier | null;
  /** null: any doctor */
  doctor_id?: Identifier | null;
  service_id?: Identifier | null;
  /** A direction in words when there is no service */
  direction?: string | null;
  branch_id?: Identifier | null;
  /** YYYY-MM-DD */
  date_from: string;
  /** YYYY-MM-DD; null: open-ended */
  date_to?: string | null;
  /** ISO days; empty: any day */
  weekdays: number[];
  /** empty: any time */
  day_parts: DayPart[];
  /** "HH:MM[:SS]" — an hour range of the start (both or none) */
  time_from?: string | null;
  time_to?: string | null;
  duration_minutes?: number | null;
  priority: WaitingPriority;
  status: WaitingStatus;
  comment?: string | null;
  visit_id?: Identifier | null;
  /** The responsible and the author */
  sales_id?: Identifier | null;
  created_by?: Identifier | null;
  offered_at?: string | null;
  offered_by?: Identifier | null;
  offered_starts_at?: string | null;
  offered_doctor_id?: Identifier | null;
  /** A freed slot of the schedule that fits (automatic matching) */
  slot_starts_at?: string | null;
  slot_ends_at?: string | null;
  slot_doctor_id?: Identifier | null;
  slot_found_at?: string | null;
  status_changed_at?: string;
  created_at: string;
  updated_at?: string;
};
