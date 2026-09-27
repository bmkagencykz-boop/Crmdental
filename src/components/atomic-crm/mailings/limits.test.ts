import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAILING_SETTINGS,
  isOptOutText,
  isWithinWorkingHours,
  mailingAllowance,
  validateMailingSettings,
} from "./limits";

// Same moments as supabase/tests/017_repeat_mailings.test.sql (Asia/Almaty)
const at = (value: string) => new Date(value);
const TZ = "Asia/Almaty";

describe("mailingAllowance", () => {
  const claimed = ["2026-03-12T09:59:30+05:00", "2026-03-12T09:59:30+05:00"];

  it("10 per minute when nothing was sent", () => {
    expect(
      mailingAllowance({
        at: at("2026-03-12T10:00:00+05:00"),
        timeZone: TZ,
        claimedAt: [],
      }),
    ).toBe(10);
  });

  it("counts the messages of the last minute", () => {
    expect(
      mailingAllowance({
        at: at("2026-03-12T10:00:00+05:00"),
        timeZone: TZ,
        claimedAt: claimed,
      }),
    ).toBe(8);
    expect(
      mailingAllowance({
        at: at("2026-03-12T10:01:00+05:00"),
        timeZone: TZ,
        claimedAt: claimed,
      }),
    ).toBe(10);
  });

  it("counts the messages of the day, in the clinic time zone", () => {
    const settings = { ...DEFAULT_MAILING_SETTINGS, per_day: 3 };
    expect(
      mailingAllowance({
        at: at("2026-03-12T15:00:00+05:00"),
        settings,
        timeZone: TZ,
        claimedAt: claimed,
      }),
    ).toBe(1);
    expect(
      mailingAllowance({
        at: at("2026-03-13T10:00:00+05:00"),
        settings,
        timeZone: TZ,
        claimedAt: claimed,
      }),
    ).toBe(3);
  });

  it("sends nothing outside the working hours", () => {
    for (const time of [
      "2026-03-12T21:00:00+05:00",
      "2026-03-12T08:59:00+05:00",
    ]) {
      expect(
        mailingAllowance({ at: at(time), timeZone: TZ, claimedAt: [] }),
      ).toBe(0);
    }
    expect(
      isWithinWorkingHours(
        at("2026-03-12T09:00:00+05:00"),
        DEFAULT_MAILING_SETTINGS,
        TZ,
      ),
    ).toBe(true);
  });
});

describe("validateMailingSettings", () => {
  it("accepts the defaults and refuses unsafe limits", () => {
    expect(validateMailingSettings(DEFAULT_MAILING_SETTINGS)).toBeNull();
    expect(
      validateMailingSettings({ ...DEFAULT_MAILING_SETTINGS, per_minute: 50 }),
    ).toBe("mailings.settings.errors.per_minute");
    expect(
      validateMailingSettings({ ...DEFAULT_MAILING_SETTINGS, per_day: 5000 }),
    ).toBe("mailings.settings.errors.per_day");
    expect(
      validateMailingSettings({
        ...DEFAULT_MAILING_SETTINGS,
        work_end: "23:00",
      }),
    ).toBe("mailings.settings.errors.hours");
    expect(
      validateMailingSettings({
        ...DEFAULT_MAILING_SETTINGS,
        work_start: "12:00:00",
        work_end: "11:00:00",
      }),
    ).toBe("mailings.settings.errors.hours");
  });
});

describe("isOptOutText", () => {
  it("is the whole message, in any case", () => {
    expect(isOptOutText(" СТОП! ")).toBe(true);
    expect(isOptOutText("Stop")).toBe(true);
    expect(isOptOutText("Отписаться.")).toBe(true);
    expect(isOptOutText("стоп, я передумал")).toBe(false);
    expect(isOptOutText(null)).toBe(false);
  });
});
