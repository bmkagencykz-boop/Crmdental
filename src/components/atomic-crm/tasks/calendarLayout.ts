import {
  DEFAULT_TIME_ZONE,
  wallClock,
} from "../providers/commons/automessages";
import type { Task, TaskType } from "../types";

/**
 * Pure logic of the task calendar (stage 23): days of a view in the clinic
 * time zone, placing tasks in the 30-minute slots of 8:00-21:00 (overlapping
 * tasks side by side), and the reschedule math of drag and drop and of the
 * quick «+1 час», «завтра», «через неделю» actions.
 *
 * Days are keys "YYYY-MM-DD" of the clinic's wall clock, times of a day are
 * minutes after midnight of that wall clock.
 */

export type CalendarView = "day" | "week" | "month";
export type DayKey = string;

export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 21;
export const SLOT_MINUTES = 30;
export const GRID_START = DAY_START_HOUR * 60;
export const GRID_END = DAY_END_HOUR * 60;
/** Rows of the time grid: 26 half-hours from 8:00 to 21:00 */
export const SLOT_COUNT = (GRID_END - GRID_START) / SLOT_MINUTES;
/** Tasks listed in a day of the month view before «ещё N» */
export const MONTH_PREVIEW = 3;
/** Choices of the duration input, in minutes */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const zoneOf = (timeZone?: string | null) => timeZone || DEFAULT_TIME_ZONE;
const pad = (n: number) => String(n).padStart(2, "0");

/** Duration of a task of this type when none is set: a meeting takes an hour */
export const defaultDuration = (type?: TaskType | null) =>
  type === "meeting" ? 60 : 30;

export const taskDuration = (
  task: Pick<Task, "type"> & { duration_minutes?: number | null },
) =>
  task.duration_minutes && task.duration_minutes > 0
    ? task.duration_minutes
    : defaultDuration(task.type);

//
// Days of the clinic
//

const parseKey = (key: DayKey) => {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
};

const utcKey = (time: number): DayKey => {
  const date = new Date(time);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** The day key as a UTC midnight date, for Intl formatting with timeZone UTC */
export const keyToDate = (key: DayKey) => {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day));
};

/** Day of the clinic a moment falls on */
export const dayKeyOf = (value: Date | string, timeZone?: string | null) => {
  const wall = wallClock(new Date(value), zoneOf(timeZone));
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
};

/** Minutes after the clinic's midnight */
export const minuteOfDay = (value: Date | string, timeZone?: string | null) => {
  const wall = wallClock(new Date(value), zoneOf(timeZone));
  return wall.hour * 60 + wall.minute;
};

export const todayKey = (timeZone?: string | null, now = new Date()) =>
  dayKeyOf(now, timeZone);

export const addDays = (key: DayKey, days: number): DayKey => {
  const { year, month, day } = parseKey(key);
  return utcKey(Date.UTC(year, month - 1, day + days));
};

/** 0 for Monday … 6 for Sunday */
export const weekdayOf = (key: DayKey) => (keyToDate(key).getUTCDay() + 6) % 7;

/** Monday of the week of a day (weeks start on Monday in Kazakhstan) */
export const startOfWeek = (key: DayKey) => addDays(key, -weekdayOf(key));

/** The moment a wall clock time of a day of the clinic happens */
export const zonedMoment = (
  key: DayKey,
  minutes: number,
  timeZone?: string | null,
) => {
  const zone = zoneOf(timeZone);
  const { year, month, day } = parseKey(key);
  const target = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = target;
  // Two passes are enough outside of the (skipped) DST transition hours
  for (let i = 0; i < 2; i++) {
    const wall = wallClock(new Date(guess), zone);
    const shown = Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day,
      wall.hour,
      wall.minute,
      wall.second,
    );
    guess += target - shown;
  }
  return new Date(guess);
};

export type CalendarRange = {
  view: CalendarView;
  /** Days shown: 1 (day), 7 (week), whole weeks around the month (month) */
  days: DayKey[];
  /** First moment shown, included */
  start: Date;
  /** Moment after the last day shown, excluded */
  end: Date;
};

const daysBetween = (from: DayKey, to: DayKey) => {
  const days: DayKey[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) days.push(key);
  return days;
};

/** Days and moments of a view around a day, in the clinic time zone */
export const calendarRange = (
  view: CalendarView,
  anchor: DayKey,
  timeZone?: string | null,
): CalendarRange => {
  let days: DayKey[];
  if (view === "day") {
    days = [anchor];
  } else if (view === "week") {
    days = daysBetween(startOfWeek(anchor), addDays(startOfWeek(anchor), 6));
  } else {
    const { year, month } = parseKey(anchor);
    const first = `${year}-${pad(month)}-01`;
    const last = utcKey(Date.UTC(year, month, 0));
    days = daysBetween(startOfWeek(first), addDays(startOfWeek(last), 6));
  }
  return {
    view,
    days,
    start: zonedMoment(days[0], 0, timeZone),
    end: zonedMoment(addDays(days[days.length - 1], 1), 0, timeZone),
  };
};

/** The day shown after «‹» or «›»: a day, a week or a month away */
export const shiftAnchor = (
  view: CalendarView,
  anchor: DayKey,
  direction: 1 | -1,
): DayKey => {
  if (view === "day") return addDays(anchor, direction);
  if (view === "week") return addDays(anchor, 7 * direction);
  const { year, month } = parseKey(anchor);
  return utcKey(Date.UTC(year, month - 1 + direction, 1));
};

/** Whether a day belongs to the month of the anchor (month view shading) */
export const sameMonth = (a: DayKey, b: DayKey) =>
  a.slice(0, 7) === b.slice(0, 7);

//
// Placing tasks
//

export type TaskStatus = "open" | "overdue" | "done";

/** Done, or overdue once its time has passed (amoCRM), or open */
export const taskStatus = (
  task: Pick<Task, "due_date" | "done_date">,
  now = new Date(),
): TaskStatus =>
  task.done_date
    ? "done"
    : new Date(task.due_date).getTime() < now.getTime()
      ? "overdue"
      : "open";

export type DayBlock<T> = {
  task: T;
  /** Minutes after midnight, within the grid */
  start: number;
  end: number;
  /** Column among the overlapping tasks, and their number */
  column: number;
  columns: number;
};

export type DayLayout<T> = {
  /** Tasks within 8:00-21:00, placed in the grid */
  blocks: DayBlock<T>[];
  /** Tasks of the day before 8:00 or from 21:00, listed above the grid */
  outside: T[];
};

type CalendarTask = Pick<Task, "id" | "type" | "due_date"> & {
  duration_minutes?: number | null;
};

const byDue = <T extends CalendarTask>(a: T, b: T) =>
  new Date(a.due_date).getTime() - new Date(b.due_date).getTime() ||
  String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

/**
 * The tasks of a day in the time grid. Overlapping tasks share the width of
 * the day side by side: a group of tasks that overlap one another, directly
 * or through others, is split in as many columns as it needs, and each task
 * takes the first column free at its start.
 */
export const layoutDay = <T extends CalendarTask>(
  tasks: T[],
  day: DayKey,
  timeZone?: string | null,
): DayLayout<T> => {
  const outside: T[] = [];
  const placed: DayBlock<T>[] = [];
  tasks
    .filter((task) => dayKeyOf(task.due_date, timeZone) === day)
    .sort(byDue)
    .forEach((task) => {
      const start = minuteOfDay(task.due_date, timeZone);
      if (start < GRID_START || start >= GRID_END) {
        outside.push(task);
        return;
      }
      placed.push({
        task,
        start,
        end: Math.min(start + taskDuration(task), GRID_END),
        column: 0,
        columns: 1,
      });
    });
  // Longer tasks first among those starting together: they take column 0
  placed.sort((a, b) => a.start - b.start || b.end - a.end);

  let group: DayBlock<T>[] = [];
  let groupEnd = -1;
  let columnEnds: number[] = [];
  const closeGroup = () => {
    group.forEach((block) => (block.columns = columnEnds.length));
    group = [];
    columnEnds = [];
  };
  placed.forEach((block) => {
    if (block.start >= groupEnd) {
      closeGroup();
    }
    let column = columnEnds.findIndex((end) => end <= block.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(block.end);
    } else {
      columnEnds[column] = block.end;
    }
    block.column = column;
    group.push(block);
    groupEnd = Math.max(groupEnd, block.end);
  });
  closeGroup();

  return { blocks: placed, outside };
};

/** Position of a block in slot units and width fractions */
export const blockBox = (block: DayBlock<unknown>) => ({
  top: (block.start - GRID_START) / SLOT_MINUTES,
  height: Math.max((block.end - block.start) / SLOT_MINUTES, 0.5),
  left: block.column / block.columns,
  width: 1 / block.columns,
});

/** Tasks of each day (month view), by due time */
export const tasksByDay = <T extends CalendarTask>(
  tasks: T[],
  timeZone?: string | null,
) => {
  const days = new Map<DayKey, T[]>();
  [...tasks].sort(byDue).forEach((task) => {
    const key = dayKeyOf(task.due_date, timeZone);
    days.set(key, [...(days.get(key) ?? []), task]);
  });
  return days;
};

//
// Rescheduling
//

/** Minutes of the slot at a height of a day column (drop, click) */
export const slotAt = (offsetY: number, slotHeight: number) =>
  GRID_START +
  Math.min(Math.max(Math.floor(offsetY / slotHeight), 0), SLOT_COUNT - 1) *
    SLOT_MINUTES;

/** Label of a slot: 8:00, 8:30 … */
export const formatMinutes = (minutes: number) =>
  `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;

/** A task dropped on a slot of the time grid */
export const moveToSlot = (
  day: DayKey,
  minutes: number,
  timeZone?: string | null,
) => zonedMoment(day, minutes, timeZone).toISOString();

/** A task dropped on a day of the month: same time, another day */
export const moveToDay = (due: string, day: DayKey, timeZone?: string | null) =>
  zonedMoment(day, minuteOfDay(due, timeZone), timeZone).toISOString();

export type QuickReschedule = "hour" | "tomorrow" | "week";
export const QUICK_RESCHEDULES: QuickReschedule[] = [
  "hour",
  "tomorrow",
  "week",
];

/**
 * «+1 час»: an hour after the due time, or after now when the task is
 * already late (to the minute). «Завтра» and «через неделю»: tomorrow or in
 * seven days from today, at the task's time of day.
 */
export const quickReschedule = (
  kind: QuickReschedule,
  due: string,
  timeZone?: string | null,
  now = new Date(),
) => {
  if (kind === "hour") {
    const base = Math.max(new Date(due).getTime(), now.getTime());
    return new Date(Math.ceil((base + HOUR) / MINUTE) * MINUTE).toISOString();
  }
  const today = todayKey(timeZone, now);
  return moveToDay(due, addDays(today, kind === "tomorrow" ? 1 : 7), timeZone);
};
