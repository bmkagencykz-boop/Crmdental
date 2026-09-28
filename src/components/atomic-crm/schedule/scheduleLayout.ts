import type { Identifier } from "ra-core";

import {
  addDays,
  dayKeyOf,
  minuteOfDay,
  weekdayOf,
  zonedMoment,
  type DayKey,
} from "../tasks/calendarLayout";
import type {
  DayHours,
  DoctorException,
  HoursRange,
  Visit,
  VisitStatus,
  WeekDay,
  WeeklyHours,
} from "./types";

/**
 * Pure logic of the schedule (stage 28): the grid of a day (15-minute rows
 * over the clinic hours) with a column per doctor or per chair, or a week of
 * one doctor or chair; visits placed side by side when they overlap; the
 * hours of a doctor on a day (weekly template, exceptions, clinic hours);
 * the warnings outside the hours; the conflicts of a move and the free slots.
 *
 * Days are "YYYY-MM-DD" of the clinic's wall clock, times are minutes after
 * the clinic's midnight (tasks/calendarLayout.ts).
 */

export const SLOT_MINUTES = 15;
/** Visit durations offered by the dialog, minutes */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120, 180];
export const DEFAULT_VISIT_MINUTES = 30;

export type GroupBy = "doctor" | "chair";
export type ScheduleView = "day" | "week";

/** Active visits hold their slot; cancelled and missed ones do not */
export const isActiveStatus = (status: VisitStatus) =>
  status !== "cancelled" && status !== "no_show";

/** "09:30" → 570 */
export const parseHm = (value: string | null | undefined): number | null => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
};

/** 570 → "09:30" (inputs and the database) */
export const toHm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

//
// Hours
//

export type Hours = { start: number; end: number; breaks: HoursRange[] };

const toHours = (range: DayHours): Hours | null => {
  const start = parseHm(range.start);
  const end = parseHm(range.end);
  if (start == null || end == null || end <= start) return null;
  return { start, end, breaks: range.breaks ?? [] };
};

/** Clinic hours of the grid (Settings → Расписание) */
export const clinicHours = (settings?: {
  hours_start?: string;
  hours_end?: string;
}): Hours =>
  toHours({
    start: settings?.hours_start ?? "09:00",
    end: settings?.hours_end ?? "21:00",
  }) ?? { start: 9 * 60, end: 21 * 60, breaks: [] };

/** ISO weekday key of a day: "1" Monday … "7" Sunday */
export const weekDayOf = (day: DayKey) => String(weekdayOf(day) + 1) as WeekDay;

/**
 * Hours of a doctor on a day, null when off: an exception of the day wins
 * (no hours: off), then the weekly template (a missing weekday: off); a
 * doctor without template works the clinic hours.
 */
export const doctorHoursOn = (
  doctor: { id: Identifier; working_hours?: WeeklyHours | null } | undefined,
  day: DayKey,
  exceptions: DoctorException[],
  clinic: Hours,
): Hours | null => {
  if (!doctor) return clinic;
  const exception = exceptions.find(
    (item) =>
      String(item.doctor_id) === String(doctor.id) &&
      item.day.slice(0, 10) === day,
  );
  if (exception) {
    if (!exception.start_time || !exception.end_time) return null;
    return toHours({
      start: exception.start_time,
      end: exception.end_time,
    });
  }
  const template = doctor.working_hours ?? {};
  if (Object.keys(template).length === 0) return clinic;
  const range = template[weekDayOf(day)];
  return range ? toHours(range) : null;
};

export type HoursWarning = "day_off" | "outside_hours" | "break" | null;

/** Why a visit of these minutes falls outside the doctor's hours (saved anyway) */
export const hoursWarning = (
  hours: Hours | null,
  start: number,
  end: number,
): HoursWarning => {
  if (!hours) return "day_off";
  if (start < hours.start || end > hours.end) return "outside_hours";
  const inBreak = hours.breaks.some((pause) => {
    const from = parseHm(pause.start);
    const to = parseHm(pause.end);
    return from != null && to != null && start < to && end > from;
  });
  return inBreak ? "break" : null;
};

//
// The grid
//

export type GridRange = { start: number; end: number };

/**
 * Rows of the grid: the clinic hours, widened to whole hours around the
 * visits shown outside of them
 */
export const gridRange = (
  clinic: Hours,
  visits: Pick<Visit, "starts_at" | "ends_at">[],
  days: DayKey[],
  timeZone?: string | null,
): GridRange => {
  let start = clinic.start;
  let end = clinic.end;
  visits.forEach((visit) => {
    const box = visitMinutes(visit, timeZone);
    if (!days.includes(box.day)) return;
    start = Math.min(start, Math.floor(box.start / 60) * 60);
    end = Math.max(end, Math.ceil(box.end / 60) * 60);
  });
  start = Math.floor(start / SLOT_MINUTES) * SLOT_MINUTES;
  end = Math.min(Math.ceil(end / SLOT_MINUTES) * SLOT_MINUTES, 24 * 60);
  return { start, end };
};

export const slotCount = (range: GridRange) =>
  (range.end - range.start) / SLOT_MINUTES;

/** Day and minutes of a visit (the end is clipped to its day) */
export const visitMinutes = (
  visit: Pick<Visit, "starts_at" | "ends_at">,
  timeZone?: string | null,
) => {
  const day = dayKeyOf(visit.starts_at, timeZone);
  const start = minuteOfDay(visit.starts_at, timeZone);
  const sameDay = dayKeyOf(visit.ends_at, timeZone) === day;
  const end = sameDay ? minuteOfDay(visit.ends_at, timeZone) : 24 * 60;
  return { day, start, end: Math.max(end, start + 5) };
};

/** Minutes of a slot at a height of a column (click, drop) */
export const slotAt = (
  offsetY: number,
  slotHeight: number,
  range: GridRange,
) =>
  range.start +
  Math.min(
    Math.max(Math.floor(offsetY / slotHeight), 0),
    slotCount(range) - 1,
  ) *
    SLOT_MINUTES;

export type Column = {
  /** doctor / chair id, or "none" for the visits without one */
  key: string;
  id: Identifier | null;
  name: string;
  /** Inactive: shown only because it has visits */
  inactive?: boolean;
};

/**
 * Columns of the day view: the active doctors (or chairs) in their order,
 * the inactive ones that have visits, and «Без врача» / «Без кресла» when
 * some visit has none.
 */
export const columnsFor = (
  items: { id: Identifier; name: string; is_active: boolean; position: number }[],
  visits: Visit[],
  groupBy: GroupBy,
  noneLabel: string,
): Column[] => {
  const field = groupBy === "doctor" ? "doctor_id" : "chair_id";
  const used = new Set(
    visits.map((visit) => visit[field]).filter((id) => id != null).map(String),
  );
  const columns: Column[] = [...items]
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))
    .filter((item) => item.is_active || used.has(String(item.id)))
    .map((item) => ({
      key: String(item.id),
      id: item.id,
      name: item.name,
      inactive: !item.is_active,
    }));
  if (visits.some((visit) => visit[field] == null)) {
    columns.push({ key: "none", id: null, name: noneLabel });
  }
  return columns;
};

/** Key of the column of a visit */
export const columnKeyOf = (visit: Visit, groupBy: GroupBy) => {
  const id = groupBy === "doctor" ? visit.doctor_id : visit.chair_id;
  return id == null ? "none" : String(id);
};

export type Block<T> = {
  item: T;
  start: number;
  end: number;
  column: number;
  columns: number;
};

/**
 * Intervals of one column placed side by side when they overlap: a group of
 * intervals overlapping one another (directly or through others) shares the
 * width, each takes the first free lane at its start. Same algorithm as the
 * task calendar.
 */
export const layoutIntervals = <T>(
  items: { item: T; start: number; end: number }[],
): Block<T>[] => {
  const placed: Block<T>[] = items
    .map(({ item, start, end }) => ({ item, start, end, column: 0, columns: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: Block<T>[] = [];
  let groupEnd = -1;
  let lanes: number[] = [];
  const close = () => {
    group.forEach((block) => (block.columns = lanes.length));
    group = [];
    lanes = [];
  };
  placed.forEach((block) => {
    if (block.start >= groupEnd) close();
    let lane = lanes.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(block.end);
    } else {
      lanes[lane] = block.end;
    }
    block.column = lane;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.end);
  });
  close();
  return placed;
};

/** The visits of a day in a column, placed. Cancelled visits sit behind. */
export const layoutVisits = (
  visits: Visit[],
  day: DayKey,
  timeZone?: string | null,
) =>
  layoutIntervals(
    visits
      .map((visit) => ({ item: visit, ...visitMinutes(visit, timeZone) }))
      .filter((box) => box.day === day),
  );

/** Position of a block in slot units and width fractions */
export const blockBox = (block: Block<unknown>, range: GridRange) => ({
  top: (block.start - range.start) / SLOT_MINUTES,
  height: Math.max((block.end - block.start) / SLOT_MINUTES, 1),
  left: block.column / block.columns,
  width: 1 / block.columns,
});

//
// Moves and free slots
//

export type Interval = { start: number; end: number };

export const overlaps = (a: Interval, b: Interval) =>
  a.start < b.end && b.start < a.end;

/**
 * A visit moved or created at [starts_at, ends_at) with a doctor and a
 * chair: the active visit it collides with, and whether the doctor or the
 * chair is taken (the database refuses the same).
 */
export const findConflict = (
  candidate: Pick<Visit, "starts_at" | "ends_at" | "doctor_id" | "chair_id"> & {
    id?: Identifier;
  },
  visits: Pick<
    Visit,
    "id" | "starts_at" | "ends_at" | "doctor_id" | "chair_id" | "status" | "source"
  >[],
): { visit: (typeof visits)[number]; resource: "doctor" | "chair" } | null => {
  const range = {
    start: new Date(candidate.starts_at).getTime(),
    end: new Date(candidate.ends_at).getTime(),
  };
  for (const visit of visits) {
    if (candidate.id != null && String(visit.id) === String(candidate.id))
      continue;
    if (visit.source === "mis" || !isActiveStatus(visit.status)) continue;
    const other = {
      start: new Date(visit.starts_at).getTime(),
      end: new Date(visit.ends_at).getTime(),
    };
    if (!overlaps(range, other)) continue;
    if (
      candidate.doctor_id != null &&
      String(visit.doctor_id) === String(candidate.doctor_id)
    )
      return { visit, resource: "doctor" };
    if (
      candidate.chair_id != null &&
      String(visit.chair_id) === String(candidate.chair_id)
    )
      return { visit, resource: "chair" };
  }
  return null;
};

/** A visit moved to a day and minute, keeping its duration */
export const moveVisit = (
  visit: Pick<Visit, "starts_at" | "ends_at">,
  day: DayKey,
  minutes: number,
  timeZone?: string | null,
) => {
  const duration =
    new Date(visit.ends_at).getTime() - new Date(visit.starts_at).getTime();
  const starts = zonedMoment(day, minutes, timeZone);
  return {
    starts_at: starts.toISOString(),
    ends_at: new Date(starts.getTime() + duration).toISOString(),
  };
};

/**
 * Free starts of a visit of `duration` minutes on a day, every 15 minutes:
 * inside the hours (outside the breaks), clear of the busy intervals, not
 * in the past (now given in minutes of that day).
 */
export const findFreeSlots = ({
  hours,
  busy,
  duration,
  nowMinute,
  step = SLOT_MINUTES,
  limit = Infinity,
}: {
  hours: Hours | null;
  busy: Interval[];
  duration: number;
  nowMinute?: number | null;
  step?: number;
  limit?: number;
}): number[] => {
  if (!hours || duration <= 0) return [];
  const blocked: Interval[] = [
    ...busy,
    ...hours.breaks
      .map((pause) => ({
        start: parseHm(pause.start) ?? 0,
        end: parseHm(pause.end) ?? 0,
      }))
      .filter((pause) => pause.end > pause.start),
  ];
  const slots: number[] = [];
  const first = Math.ceil(hours.start / step) * step;
  for (let start = first; start + duration <= hours.end; start += step) {
    if (nowMinute != null && start < nowMinute) continue;
    const slot = { start, end: start + duration };
    if (blocked.some((interval) => overlaps(slot, interval))) continue;
    slots.push(start);
    if (slots.length >= limit) break;
  }
  return slots;
};

/** Busy minutes of a day for a doctor or a chair (active visits) */
export const busyIntervals = (
  visits: Visit[],
  day: DayKey,
  match: (visit: Visit) => boolean,
  timeZone?: string | null,
  ignoreId?: Identifier,
): Interval[] =>
  visits
    .filter(
      (visit) =>
        isActiveStatus(visit.status) &&
        match(visit) &&
        (ignoreId == null || String(visit.id) !== String(ignoreId)),
    )
    .map((visit) => visitMinutes(visit, timeZone))
    .filter((box) => box.day === day)
    .map(({ start, end }) => ({ start, end }));

//
// Markers and counters
//

/** A visit of tomorrow the patient has not confirmed yet */
export const isUnconfirmedTomorrow = (
  visit: Pick<Visit, "starts_at" | "status">,
  now: Date,
  timeZone?: string | null,
) =>
  visit.status === "scheduled" &&
  dayKeyOf(visit.starts_at, timeZone) ===
    addDays(dayKeyOf(now, timeZone), 1);

/** Visits counted by status */
export const countByStatus = (visits: Pick<Visit, "status">[]) =>
  visits.reduce(
    (counts, visit) => ({
      ...counts,
      [visit.status]: (counts[visit.status] ?? 0) + 1,
    }),
    {} as Partial<Record<VisitStatus, number>>,
  );

/** Duration of a visit in minutes */
export const visitDuration = (visit: Pick<Visit, "starts_at" | "ends_at">) =>
  Math.round(
    (new Date(visit.ends_at).getTime() - new Date(visit.starts_at).getTime()) /
      60000,
  );
