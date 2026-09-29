import type { Identifier } from "ra-core";

import { inBranch } from "../branches/branches";
import {
  addDays,
  dayKeyOf,
  minuteOfDay,
  todayKey,
  weekdayOf,
  zonedMoment,
  type DayKey,
} from "../tasks/calendarLayout";
import {
  busyIntervals,
  DEFAULT_VISIT_MINUTES,
  doctorHoursOn,
  findFreeSlots,
  parseHm,
  visitMinutes,
  type Hours,
  type Interval,
} from "../schedule/scheduleLayout";
import type {
  BusySlot,
  DoctorException,
  Visit,
  WeeklyHours,
} from "../schedule/types";
import {
  ACTIVE_STATUSES,
  type DayPart,
  type WaitingEntry,
  type WaitingStatus,
} from "./types";

/**
 * Pure logic of the waiting list (stage 38): does an entry fit a slot (the
 * twin of private.waiting_entry_fits), the nearest free slots of an entry
 * from the doctors' hours and the visits (schedule/scheduleLayout.ts
 * findFreeSlots), the groups of the page and the text of an offer.
 */

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** Part of the day of a start: morning before 12:00, day before 16:00 */
export const dayPartOf = (minute: number): DayPart =>
  minute < 12 * 60 ? "morning" : minute < 16 * 60 ? "day" : "evening";

export const isActiveEntry = (entry: Pick<WaitingEntry, "status">) =>
  ACTIVE_STATUSES.includes(entry.status);

/** ISO day of the week (1 Monday … 7 Sunday) of a day of the clinic */
export const isoWeekday = (day: DayKey) => weekdayOf(day) + 1;

/**
 * Whether a start (day and minutes of the clinic) is inside the wishes of
 * the entry: period, days of the week, parts of the day, hour range.
 */
export const fitsWishes = (
  entry: Pick<
    WaitingEntry,
    "date_from" | "date_to" | "weekdays" | "day_parts" | "time_from" | "time_to"
  >,
  day: DayKey,
  minute: number,
) => {
  if (day < entry.date_from.slice(0, 10)) return false;
  if (entry.date_to && day > entry.date_to.slice(0, 10)) return false;
  if (entry.weekdays?.length && !entry.weekdays.includes(isoWeekday(day))) {
    return false;
  }
  if (entry.day_parts?.length && !entry.day_parts.includes(dayPartOf(minute))) {
    return false;
  }
  const from = parseHm(entry.time_from);
  const to = parseHm(entry.time_to);
  if (from != null && to != null && (minute < from || minute >= to)) {
    return false;
  }
  return true;
};

export type Slot = {
  doctor_id: Identifier | null;
  starts_at: string;
  ends_at: string;
  branch_id?: Identifier | null;
};

/** Twin of private.waiting_entry_fits: an entry fits a slot of a doctor */
export const entryFitsSlot = (
  entry: WaitingEntry,
  slot: Slot,
  timeZone?: string | null,
) => {
  if (!isActiveEntry(entry)) return false;
  if (entry.doctor_id != null && !same(entry.doctor_id, slot.doctor_id)) {
    return false;
  }
  if (
    entry.branch_id != null &&
    slot.branch_id != null &&
    !same(entry.branch_id, slot.branch_id)
  ) {
    return false;
  }
  const day = dayKeyOf(slot.starts_at, timeZone);
  const minute = minuteOfDay(slot.starts_at, timeZone);
  if (!fitsWishes(entry, day, minute)) return false;
  const length =
    (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) /
    60000;
  return entry.duration_minutes == null || entry.duration_minutes <= length;
};

type DoctorLike = {
  id: Identifier;
  name: string;
  is_active: boolean;
  working_hours?: WeeklyHours | null;
  visit_minutes?: number | null;
  branch_id?: Identifier | null;
};

/** Length of the visit of an entry: its own, the service's, the doctor's */
export const entryDuration = (
  entry: Pick<WaitingEntry, "duration_minutes">,
  doctor?: Pick<DoctorLike, "visit_minutes">,
  serviceMinutes?: number | null,
) =>
  entry.duration_minutes ||
  serviceMinutes ||
  doctor?.visit_minutes ||
  DEFAULT_VISIT_MINUTES;

export type FreeSlot = {
  doctor_id: Identifier;
  day: DayKey;
  /** Minutes of the clinic */
  start: number;
  end: number;
  starts_at: string;
  ends_at: string;
};

/**
 * The nearest free slots of an entry, over `days` days from today (or the
 * start of its period) to the end of its period: for its doctor (or every
 * active doctor of its branch), inside the doctor's hours, clear of the
 * active visits and of the busy time of the visits the employee does not
 * see, in the entry's days and parts of the day, never in the past. Options
 * of one doctor on one day do not overlap each other; sorted by time.
 */
export const nearestSlots = ({
  entry,
  doctors,
  visits,
  busy = [],
  exceptions,
  clinic,
  timeZone,
  now = new Date(),
  days = 21,
  limit = 3,
  serviceMinutes,
}: {
  entry: WaitingEntry;
  doctors: DoctorLike[];
  visits: Visit[];
  busy?: BusySlot[];
  exceptions: DoctorException[];
  clinic: Hours;
  timeZone?: string | null;
  now?: Date;
  days?: number;
  limit?: number;
  serviceMinutes?: number | null;
}): FreeSlot[] => {
  if (!isActiveEntry(entry) || limit <= 0) return [];
  const today = todayKey(timeZone, now);
  const nowMinute = minuteOfDay(now, timeZone);
  const candidates =
    entry.doctor_id != null
      ? doctors.filter((doctor) => same(doctor.id, entry.doctor_id))
      : inBranch(
          doctors.filter((doctor) => doctor.is_active),
          entry.branch_id,
        );
  if (!candidates.length) return [];
  const from =
    entry.date_from && entry.date_from.slice(0, 10) > today
      ? entry.date_from.slice(0, 10)
      : today;
  const last = addDays(today, days - 1);
  const to =
    entry.date_to && entry.date_to.slice(0, 10) < last
      ? entry.date_to.slice(0, 10)
      : last;
  const found: FreeSlot[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (entry.weekdays?.length && !entry.weekdays.includes(isoWeekday(day))) {
      continue;
    }
    const ofDay: FreeSlot[] = [];
    for (const doctor of candidates) {
      const duration = entryDuration(entry, doctor, serviceMinutes);
      const hours = doctorHoursOn(doctor, day, exceptions, clinic);
      const taken: Interval[] = [
        ...busyIntervals(
          visits,
          day,
          (visit) => same(visit.doctor_id, doctor.id),
          timeZone,
        ),
        ...busy
          .filter((slot) => same(slot.doctor_id, doctor.id))
          .map((slot) => visitMinutes(slot, timeZone))
          .filter((box) => box.day === day)
          .map(({ start, end }) => ({ start, end })),
      ];
      let lastEnd = -1;
      for (const start of findFreeSlots({
        hours,
        busy: taken,
        duration,
        nowMinute: day === today ? nowMinute : null,
      })) {
        if (start < lastEnd || !fitsWishes(entry, day, start)) continue;
        const starts = zonedMoment(day, start, timeZone);
        ofDay.push({
          doctor_id: doctor.id,
          day,
          start,
          end: start + duration,
          starts_at: starts.toISOString(),
          ends_at: new Date(starts.getTime() + duration * 60000).toISOString(),
        });
        lastEnd = start + duration;
      }
    }
    ofDay.sort(
      (a, b) =>
        a.start - b.start ||
        String(a.doctor_id).localeCompare(String(b.doctor_id)),
    );
    found.push(...ofDay);
    if (found.length >= limit) break;
  }
  return found.slice(0, limit);
};

/** A freed slot highlighted on an active entry, still in the future */
export const freedSlotOf = (entry: WaitingEntry, now = new Date()) =>
  isActiveEntry(entry) &&
  entry.slot_starts_at &&
  new Date(entry.slot_starts_at).getTime() > now.getTime()
    ? {
        doctor_id: entry.slot_doctor_id ?? null,
        starts_at: entry.slot_starts_at,
        ends_at: entry.slot_ends_at ?? entry.slot_starts_at,
      }
    : null;

/** Days an entry has been waiting */
export const waitingDays = (
  entry: Pick<WaitingEntry, "created_at">,
  now = new Date(),
) =>
  Math.max(
    0,
    Math.floor(
      (now.getTime() - new Date(entry.created_at).getTime()) / 86_400_000,
    ),
  );

/** Waiting longer than this is «ждут давно» */
export const LONG_WAIT_DAYS = 14;

export type WaitingGroup = "urgent" | "long" | "recent" | "closed";
export const WAITING_GROUPS: WaitingGroup[] = [
  "urgent",
  "long",
  "recent",
  "closed",
];

/**
 * Groups of the page: urgent entries, those waiting two weeks or more, the
 * recent ones (the oldest first in each), and the closed ones (booked or
 * cancelled, the latest first). Entries with a freed slot come first.
 */
export const groupEntries = (entries: WaitingEntry[], now = new Date()) => {
  const groups: Record<WaitingGroup, WaitingEntry[]> = {
    urgent: [],
    long: [],
    recent: [],
    closed: [],
  };
  for (const entry of entries) {
    if (!isActiveEntry(entry)) groups.closed.push(entry);
    else if (entry.priority === "urgent") groups.urgent.push(entry);
    else if (waitingDays(entry, now) >= LONG_WAIT_DAYS) groups.long.push(entry);
    else groups.recent.push(entry);
  }
  const byAge = (a: WaitingEntry, b: WaitingEntry) =>
    Number(!!freedSlotOf(b, now)) - Number(!!freedSlotOf(a, now)) ||
    a.created_at.localeCompare(b.created_at) ||
    String(a.id).localeCompare(String(b.id));
  groups.urgent.sort(byAge);
  groups.long.sort(byAge);
  groups.recent.sort(byAge);
  groups.closed.sort((a, b) =>
    (b.status_changed_at ?? b.created_at).localeCompare(
      a.status_changed_at ?? a.created_at,
    ),
  );
  return groups;
};

/** Active entries counted for the chip of the navigation */
export const countActive = (entries: Pick<WaitingEntry, "status">[]) =>
  entries.filter(isActiveEntry).length;

/** Filters of the page: doctor (an entry for any doctor matches every one), service, branch */
export const filterEntries = (
  entries: WaitingEntry[],
  {
    doctorId,
    serviceId,
    branchId,
  }: {
    doctorId?: Identifier | null;
    serviceId?: Identifier | null;
    branchId?: Identifier | null;
  },
) =>
  entries.filter(
    (entry) =>
      (doctorId == null ||
        entry.doctor_id == null ||
        same(entry.doctor_id, doctorId)) &&
      (serviceId == null || same(entry.service_id, serviceId)) &&
      (branchId == null ||
        entry.branch_id == null ||
        same(entry.branch_id, branchId)),
  );

/** What changes when the status of an entry changes (for the demo) */
export const statusPatch = (status: WaitingStatus): Partial<WaitingEntry> =>
  status === "booked" || status === "cancelled"
    ? {
        slot_starts_at: null,
        slot_ends_at: null,
        slot_doctor_id: null,
        slot_found_at: null,
      }
    : {};

/**
 * The text of an offer to the patient: «Здравствуйте, Асель! Освободилось
 * время …». The template comes from the translations, with %{name},
 * %{doctor}, %{date}, %{time}.
 */
export const fillOffer = (
  template: string,
  values: {
    name?: string | null;
    doctor?: string | null;
    date: string;
    time: string;
  },
) =>
  template
    .replace(/%\{name\}/g, values.name?.trim() || "")
    .replace(/%\{doctor\}/g, values.doctor?.trim() || "")
    .replace(/%\{date\}/g, values.date)
    .replace(/%\{time\}/g, values.time)
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/,([.!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();

/** How many entries a freed slot highlights (private.waiting_list_slot_freed) */
export const FREED_SLOT_LIMIT = 5;

type FreedVisit = Pick<
  Visit,
  "id" | "patient_id" | "doctor_id" | "starts_at" | "ends_at" | "status"
> & { branch_id?: Identifier | null };

const holdsTime = (status: Visit["status"]) =>
  status !== "cancelled" && status !== "no_show";

/**
 * The slot a visit change frees (private.handle_visit_waiting_list): an
 * active future visit cancelled, missed, deleted (after null) or moved away
 * (a move that still overlaps its time with the same doctor frees nothing).
 */
export const freedSlotOfChange = (
  before: FreedVisit,
  after: FreedVisit | null,
  now = new Date(),
): (Slot & { patient_id: Identifier }) | null => {
  if (!holdsTime(before.status)) return null;
  if (new Date(before.starts_at).getTime() <= now.getTime()) return null;
  if (
    after &&
    holdsTime(after.status) &&
    String(after.doctor_id ?? "") === String(before.doctor_id ?? "") &&
    new Date(after.starts_at).getTime() < new Date(before.ends_at).getTime() &&
    new Date(before.starts_at).getTime() < new Date(after.ends_at).getTime()
  ) {
    return null;
  }
  return {
    doctor_id: before.doctor_id ?? null,
    starts_at: before.starts_at,
    ends_at: before.ends_at,
    branch_id: before.branch_id ?? null,
    patient_id: before.patient_id,
  };
};

/**
 * The entries a freed slot highlights (private.waiting_list_slot_freed):
 * those that fit it, not of the patient of the freed visit, not already
 * holding this slot; urgent and oldest first, at most five.
 */
export const entriesForFreedSlot = (
  entries: WaitingEntry[],
  slot: Slot & { patient_id?: Identifier | null },
  timeZone?: string | null,
) =>
  entries
    .filter(
      (entry) =>
        !same(entry.patient_id, slot.patient_id) &&
        entryFitsSlot(entry, slot, timeZone) &&
        !(
          entry.slot_starts_at != null &&
          new Date(entry.slot_starts_at).getTime() ===
            new Date(slot.starts_at).getTime() &&
          String(entry.slot_doctor_id ?? "") === String(slot.doctor_id ?? "")
        ),
    )
    .sort(
      (a, b) =>
        Number(b.priority === "urgent") - Number(a.priority === "urgent") ||
        a.created_at.localeCompare(b.created_at) ||
        Number(a.id) - Number(b.id),
    )
    .slice(0, FREED_SLOT_LIMIT);
