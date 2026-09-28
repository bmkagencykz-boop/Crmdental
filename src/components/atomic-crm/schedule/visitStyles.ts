import type { VisitStatus } from "./types";

/** Small swatch of the legend and of the badges */
export const STATUS_DOT: Record<VisitStatus, string> = {
  scheduled: "bg-brand-blue",
  confirmed: "bg-brand-green",
  arrived: "bg-brand-yellow",
  completed: "bg-muted-foreground/60",
  no_show: "bg-destructive",
  cancelled: "bg-border",
};

/** Status buttons of the popover, in the order of a visit */
export const STATUS_ACTIONS: VisitStatus[] = [
  "confirmed",
  "arrived",
  "no_show",
  "cancelled",
  "completed",
];

/** «14:30» in the clinic time zone */
export const formatTime = (value: string, timeZone: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

/** «пн, 28 сент., 14:30» in the clinic time zone */
export const formatDateTime = (
  value: string,
  timeZone: string,
  locale?: string,
) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));

/** Color of a status sign: the same in the light and the dark theme */
export const STATUS_COLOR: Record<VisitStatus, string> = {
  scheduled: "#2F80ED",
  confirmed: "#27AE60",
  arrived: "#F2994A",
  completed: "#7D8590",
  no_show: "#E5484D",
  cancelled: "#A1A1AA",
};
