import type { Identifier } from "ra-core";

import { PERIODS, periodStart } from "../periods";
import { WAITING_FILTER } from "../../providers/commons/responseTime";

/**
 * Filters of the deals shared by the board and the list (stage 21), and the
 * saved filters: serialization with relative values, built-in presets.
 */

/** Pseudo filter «Без задач» / «Просроченные задачи» of the deals */
export const TASK_STATE_FILTER = "task_state";
export type TaskStateFilter = "no_task" | "overdue";

/**
 * Turns the task-state pseudo filter into columns of deals_summary (both
 * data providers): no open task, or the nearest open task past its due
 * date; both for open deals only (closed deals are not controlled).
 */
export const applyTaskStateFilter = <
  Params extends { filter?: Record<string, any> },
>(
  params: Params,
  now = new Date(),
): Params => {
  const state = params.filter?.[TASK_STATE_FILTER] as
    | TaskStateFilter
    | undefined;
  if (!params.filter || !(TASK_STATE_FILTER in params.filter)) return params;
  const { [TASK_STATE_FILTER]: _, ...filter } = params.filter;
  if (state === "no_task") {
    return {
      ...params,
      filter: { ...filter, stage_kind: "open", nb_open_tasks: 0 },
    };
  }
  if (state === "overdue") {
    return {
      ...params,
      filter: {
        ...filter,
        stage_kind: "open",
        "next_task_due_at@lt": now.toISOString(),
      },
    };
  }
  return { ...params, filter };
};

/** A row of public.saved_filters */
export type SavedFilter = {
  id: Identifier;
  organization_id?: Identifier;
  /** null: the whole clinic; else the personal filter of this employee */
  sales_id: Identifier | null;
  name: string;
  resource: "deals";
  /** Serialized filter values (serializeFilter) */
  filter: Record<string, unknown>;
  position: number;
  created_at?: string;
};

// --- relative values of the saved filters ------------------------------------

/** The current employee */
export const ME = "$me";
/** Start of the current month */
export const MONTH_START = "$month_start";
/** A period of the board filter: "$period:week" */
const PERIOD_PREFIX = "$period:";

export type FilterValues = Record<string, unknown>;

export type FilterContext = {
  me?: Identifier | null;
  now?: Date;
};

export const monthStart = (now = new Date()) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.toISOString();
};

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

/**
 * The filter values of a list as they are saved: empty values dropped, the
 * current employee, the board periods and the start of the month kept as
 * tokens so that the filter still means the same thing tomorrow
 */
export const serializeFilter = (
  values: FilterValues,
  { me, now = new Date() }: FilterContext = {},
): FilterValues => {
  const result: FilterValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (isEmpty(value)) continue;
    if (key === "sales_id" && me != null && String(value) === String(me)) {
      result[key] = ME;
      continue;
    }
    if (key.endsWith("@gte") && typeof value === "string") {
      const period = PERIODS.find(
        ({ days }) => periodStart(days, now) === value,
      );
      if (period) {
        result[key] = `${PERIOD_PREFIX}${period.key}`;
        continue;
      }
      if (value === monthStart(now)) {
        result[key] = MONTH_START;
        continue;
      }
    }
    result[key] = value;
  }
  return result;
};

/** The saved values made concrete for now and for the current employee */
export const deserializeFilter = (
  saved: FilterValues,
  { me, now = new Date() }: FilterContext = {},
): FilterValues => {
  const result: FilterValues = {};
  for (const [key, value] of Object.entries(saved ?? {})) {
    if (value === ME) {
      if (me != null) result[key] = me;
      continue;
    }
    if (value === MONTH_START) {
      result[key] = monthStart(now);
      continue;
    }
    if (typeof value === "string" && value.startsWith(PERIOD_PREFIX)) {
      const period = PERIODS.find(
        ({ key: name }) => name === value.slice(PERIOD_PREFIX.length),
      );
      if (period) result[key] = periodStart(period.days, now);
      continue;
    }
    result[key] = value;
  }
  return result;
};

const canonical = (values: FilterValues) =>
  JSON.stringify(
    Object.entries(values)
      .filter(([, value]) => !isEmpty(value))
      .map(([key, value]) => [key, String(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** Whether the list shows exactly this saved filter */
export const isSameFilter = (
  saved: FilterValues,
  current: FilterValues,
  context: FilterContext = {},
) => canonical(deserializeFilter(saved, context)) === canonical(current);

// --- built-in presets ----------------------------------------------------------

export type FilterPreset = {
  id: string;
  filter: FilterValues;
};

/** «Мои сделки», «Без задач», «Просроченные задачи», «Ждут ответа», «Закрытые за месяц», «Новые сегодня» */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: "mine", filter: { sales_id: ME } },
  { id: "no_task", filter: { [TASK_STATE_FILTER]: "no_task" } },
  { id: "overdue", filter: { [TASK_STATE_FILTER]: "overdue" } },
  { id: "waiting", filter: { [WAITING_FILTER]: true } },
  { id: "closed_month", filter: { "closed_at@gte": MONTH_START } },
  { id: "new_today", filter: { "created_at@gte": `${PERIOD_PREFIX}today` } },
];

/** Filters shown as inputs: the others (presets) are only in the values */
export const displayedFiltersOf = (values: FilterValues) =>
  Object.fromEntries(Object.keys(values).map((key) => [key, true]));
