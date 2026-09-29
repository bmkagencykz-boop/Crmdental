import { toHm } from "../schedule/scheduleLayout";
import { keyToDate, minuteOfDay } from "../tasks/calendarLayout";

const intlLocale = (locale?: string) => (locale === "en" ? "en-GB" : "ru-RU");

/** «вт, 4 марта» — the day of a moment in the clinic's time zone */
export const slotDate = (
  value: string,
  timeZone?: string | null,
  locale?: string,
) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: timeZone || "Asia/Almaty",
  }).format(new Date(value));

/** «10:00» in the clinic's time zone */
export const slotTime = (value: string, timeZone?: string | null) =>
  toHm(minuteOfDay(value, timeZone));

/** «вт, 4 марта · 10:00» */
export const slotLabel = (
  value: string,
  timeZone?: string | null,
  locale?: string,
) => `${slotDate(value, timeZone, locale)} · ${slotTime(value, timeZone)}`;

/** «04.03» for a YYYY-MM-DD day */
export const shortDay = (day: string, locale?: string) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(keyToDate(day.slice(0, 10)));
