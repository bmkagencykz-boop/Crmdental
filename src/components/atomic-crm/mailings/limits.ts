import { DEFAULT_TIME_ZONE } from "../providers/commons/automessages";
import type { MailingSettings } from "./types";

/**
 * Anti-ban limits of the mailings (WhatsApp) and the opt-out keywords: the
 * same rules as private.mailing_allowance and private.is_opt_out_text
 * (supabase/schemas/17_repeat_mailings.sql), for the settings form and the
 * demo data provider.
 */

export const DEFAULT_MAILING_SETTINGS: MailingSettings = {
  per_minute: 10,
  per_day: 300,
  work_start: "09:00",
  work_end: "21:00",
};

/** Safe bounds (checked by the database as well) */
export const MAILING_LIMIT_BOUNDS = {
  per_minute: { min: 1, max: 20 },
  per_day: { min: 1, max: 1000 },
  earliest: "08:00",
  latest: "22:00",
} as const;

/** "09:00:00" -> "09:00" */
export const shortTime = (value: string | null | undefined) =>
  (value ?? "").slice(0, 5);

/** Error key of invalid settings, null when they are within the bounds */
export const validateMailingSettings = (settings: MailingSettings) => {
  const { per_minute, per_day } = MAILING_LIMIT_BOUNDS;
  if (
    !Number.isInteger(settings.per_minute) ||
    settings.per_minute < per_minute.min ||
    settings.per_minute > per_minute.max
  ) {
    return "mailings.settings.errors.per_minute";
  }
  if (
    !Number.isInteger(settings.per_day) ||
    settings.per_day < per_day.min ||
    settings.per_day > per_day.max
  ) {
    return "mailings.settings.errors.per_day";
  }
  const start = shortTime(settings.work_start);
  const end = shortTime(settings.work_end);
  if (
    !/^\d\d:\d\d$/.test(start) ||
    !/^\d\d:\d\d$/.test(end) ||
    start < MAILING_LIMIT_BOUNDS.earliest ||
    end > MAILING_LIMIT_BOUNDS.latest ||
    start >= end
  ) {
    return "mailings.settings.errors.hours";
  }
  return null;
};

/** Local date ("2026-03-12") and time ("14:30") of a moment in a time zone */
export const localDateTime = (at: Date, timeZone = DEFAULT_TIME_ZONE) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || DEFAULT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
  };
};

export const isWithinWorkingHours = (
  at: Date,
  settings: Pick<MailingSettings, "work_start" | "work_end">,
  timeZone = DEFAULT_TIME_ZONE,
) => {
  const { time } = localDateTime(at, timeZone);
  return (
    time >= shortTime(settings.work_start) &&
    time < shortTime(settings.work_end)
  );
};

/**
 * How many mailing messages a clinic may still send at `at`: nothing outside
 * the working hours, else the rest of the per-minute and per-day limits.
 * claimedAt: when the messages already taken by the dispatcher were taken.
 */
export const mailingAllowance = ({
  at,
  settings = DEFAULT_MAILING_SETTINGS,
  timeZone = DEFAULT_TIME_ZONE,
  claimedAt,
}: {
  at: Date;
  settings?: MailingSettings;
  timeZone?: string;
  claimedAt: (string | null | undefined)[];
}) => {
  if (!isWithinWorkingHours(at, settings, timeZone)) return 0;
  const now = at.getTime();
  const today = localDateTime(at, timeZone).date;
  let lastMinute = 0;
  let sameDay = 0;
  for (const value of claimedAt) {
    if (!value) continue;
    const claimed = new Date(value);
    const time = claimed.getTime();
    if (time > now) continue;
    if (time > now - 60_000) lastMinute++;
    if (localDateTime(claimed, timeZone).date === today) sameDay++;
  }
  return Math.max(
    0,
    Math.min(settings.per_minute - lastMinute, settings.per_day - sameDay),
  );
};

const OPT_OUT_WORDS = ["стоп", "stop", "отписаться"];

/**
 * «Стоп», «STOP!», « отписаться »: the whole message is the keyword (any
 * case, surrounding spaces and punctuation ignored).
 */
export const isOptOutText = (text: string | null | undefined) =>
  OPT_OUT_WORDS.includes(
    (text ?? "").replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "").toLowerCase(),
  );
