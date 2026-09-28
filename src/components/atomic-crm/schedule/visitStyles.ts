import type { VisitStatus } from "./types";

/** Block of a visit by status: theme tokens only (light and dark themes) */
export const STATUS_BLOCK: Record<VisitStatus, string> = {
  scheduled: "border-brand-blue bg-brand-blue/15",
  confirmed: "border-brand-green bg-brand-green/20",
  arrived: "border-brand-yellow bg-brand-yellow/30",
  completed: "border-muted-foreground/50 bg-muted text-muted-foreground",
  no_show: "border-destructive bg-destructive/15",
  cancelled: "border-border bg-card text-muted-foreground line-through",
};

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
