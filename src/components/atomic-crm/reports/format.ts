import { PERIODS, periodStart } from "../deals/periods";
import type { ReportFilters } from "./reportMath";

export type DurationUnits = { day: string; hour: string; minute: string };

export const RUSSIAN_UNITS: DurationUnits = {
  day: "дн",
  hour: "ч",
  minute: "мин",
};

/**
 * A duration in human words, two largest units: "2 ч 15 мин", "3 дн 4 ч",
 * "45 мин", "< 1 мин". Null (no data) gives "—".
 */
export const formatDuration = (
  seconds: number | null | undefined,
  units: DurationUnits = RUSSIAN_UNITS,
) => {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `< 1 ${units.minute}`;
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  if (days)
    return hours
      ? `${days} ${units.day} ${hours} ${units.hour}`
      : `${days} ${units.day}`;
  if (hours)
    return rest
      ? `${hours} ${units.hour} ${rest} ${units.minute}`
      : `${hours} ${units.hour}`;
  return `${rest} ${units.minute}`;
};

/** Share in percent, whole numbers: "67 %"; nothing to divide gives "—" */
export const formatPercent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)} %` : "—";

/** Period of the reports: a preset of the board, everything, or dates */
export type ReportPeriod =
  | (typeof PERIODS)[number]["key"]
  | "year"
  | "all"
  | "custom";

export const REPORT_PERIODS: ReportPeriod[] = [
  "today",
  "week",
  "month",
  "quarter",
  "year",
  "all",
  "custom",
];

export type ReportFilterState = {
  period: ReportPeriod;
  /** Custom period, local dates YYYY-MM-DD, both included */
  from?: string | null;
  to?: string | null;
  pipeline_id?: string | null;
  sales_id?: string | null;
  source_id?: string | null;
  doctor_id?: string | null;
  /** Branch (stage 33) */
  branch_id?: string | null;
};

const startOfLocalDay = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/** Filters of the screen turned into the bounds the report functions take */
export const toReportFilters = (
  state: ReportFilterState,
  now = new Date(),
): ReportFilters => {
  let from: string | null = null;
  let to: string | null = null;
  if (state.period === "custom") {
    if (state.from) from = startOfLocalDay(state.from).toISOString();
    if (state.to) {
      const end = startOfLocalDay(state.to);
      end.setDate(end.getDate() + 1);
      to = end.toISOString();
    }
  } else if (state.period === "year") {
    from = periodStart(365, now);
  } else if (state.period !== "all") {
    const preset = PERIODS.find((p) => p.key === state.period);
    from = periodStart(preset?.days ?? 30, now);
  }
  return {
    from,
    to,
    pipeline_id: state.pipeline_id || null,
    sales_id: state.sales_id || null,
    source_id: state.source_id || null,
    doctor_id: state.doctor_id || null,
    branch_id: state.branch_id || null,
  };
};
