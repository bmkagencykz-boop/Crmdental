import { describe, expect, it } from "vitest";

import type { AutomessageRule } from "../../types";
import {
  automessageSendTime,
  automessageValues,
  formatVisitDate,
  renderTemplate,
  scheduleAutomessages,
} from "./automessages";

// Asia/Tashkent is UTC+5 all year round
const TZ = "Asia/Tashkent";

describe("renderTemplate", () => {
  it("replaces the variables", () => {
    expect(
      renderTemplate(
        "Здравствуйте, {имя}! Ждём вас {дата_визита} в {клиника}.",
        {
          имя: "Асель",
          дата_визита: "12 марта в 14:30",
          клиника: "Жемчуг",
        },
      ),
    ).toBe("Здравствуйте, Асель! Ждём вас 12 марта в 14:30 в Жемчуг.");
  });

  it("renders missing values as empty and collapses the spaces", () => {
    expect(
      renderTemplate("Здравствуйте, {имя} {услуга} !\n  До встречи  ", {
        имя: null,
        услуга: undefined,
      }),
    ).toBe("Здравствуйте, !\nДо встречи");
  });

  it("replaces every occurrence and keeps unknown braces", () => {
    expect(renderTemplate("{имя}, {имя}! {врач}", { имя: "Анна" })).toBe(
      "Анна, Анна! {врач}",
    );
  });
});

describe("formatVisitDate", () => {
  it("writes the date in Russian in the clinic time zone", () => {
    expect(formatVisitDate("2026-03-12T09:30:00Z", TZ)).toBe(
      "12 марта в 14:30",
    );
    expect(formatVisitDate("2026-12-31T19:05:00Z", TZ)).toBe(
      "1 января в 00:05",
    );
  });

  it("gives nothing without a date", () => {
    expect(formatVisitDate(null, TZ)).toBeNull();
    expect(formatVisitDate("", TZ)).toBeNull();
  });
});

describe("automessageSendTime", () => {
  const at = (iso: string) =>
    automessageSendTime(new Date(iso), TZ).toISOString();

  it("keeps a time within 9:00-21:00", () => {
    expect(at("2026-03-12T10:00:00Z")).toBe("2026-03-12T10:00:00.000Z");
  });
  it("moves the evening to 9:00 the next morning", () => {
    expect(at("2026-03-12T17:00:00Z")).toBe("2026-03-13T04:00:00.000Z");
    expect(at("2026-03-12T16:00:00Z")).toBe("2026-03-13T04:00:00.000Z");
  });
  it("moves the night to 9:00 the same day", () => {
    expect(at("2026-03-12T01:00:00Z")).toBe("2026-03-12T04:00:00.000Z");
  });
  it("crosses the end of the month", () => {
    expect(at("2026-03-31T18:00:00Z")).toBe("2026-04-01T04:00:00.000Z");
  });
});

describe("scheduleAutomessages", () => {
  const rule = (overrides: Partial<AutomessageRule>): AutomessageRule => ({
    id: 1,
    stage_id: 3,
    template_id: 1,
    timing: "after_stage",
    offset_minutes: 60,
    mode: "auto",
    is_active: true,
    position: 0,
    ...overrides,
  });
  // 12:00 in Tashkent
  const now = new Date("2026-03-12T07:00:00Z");

  it("queues the active rules of the current stage", () => {
    const jobs = scheduleAutomessages({
      deal: { id: 7, stage_id: 3 },
      rules: [
        rule({}),
        rule({ id: 2, stage_id: 4 }),
        rule({ id: 3, is_active: false }),
      ],
      timeZone: TZ,
      now,
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      deal_id: 7,
      rule_id: 1,
      status: "pending",
      send_at: "2026-03-12T08:00:00.000Z",
    });
  });

  it("applies the quiet hours", () => {
    const [job] = scheduleAutomessages({
      deal: { id: 7, stage_id: 3 },
      rules: [rule({ offset_minutes: 10 * 60 })],
      timeZone: TZ,
      now,
    });
    expect(job.send_at).toBe("2026-03-13T04:00:00.000Z");
  });

  it("counts back from the visit, and does nothing without one", () => {
    const before = rule({ timing: "before_visit", offset_minutes: 24 * 60 });
    expect(
      scheduleAutomessages({
        deal: { id: 7, stage_id: 3, appointment_at: null },
        rules: [before],
        timeZone: TZ,
        now,
      }),
    ).toEqual([]);
    const [job] = scheduleAutomessages({
      deal: { id: 7, stage_id: 3, appointment_at: "2026-03-15T06:00:00Z" },
      rules: [before],
      timeZone: TZ,
      now,
    });
    expect(job.send_at).toBe("2026-03-14T06:00:00.000Z");
  });

  it("skips a visit already past, or one the quiet hours would miss", () => {
    const before = rule({ timing: "before_visit", offset_minutes: 60 });
    expect(
      scheduleAutomessages({
        deal: { id: 7, stage_id: 3, appointment_at: "2026-03-11T06:00:00Z" },
        rules: [before],
        timeZone: TZ,
        now,
      }),
    ).toEqual([]);
    // Visit at 8:30 local: an hour before is 7:30, moved to 9:00 — too late
    expect(
      scheduleAutomessages({
        deal: { id: 7, stage_id: 3, appointment_at: "2026-03-13T03:30:00Z" },
        rules: [before],
        timeZone: TZ,
        now,
      }),
    ).toEqual([]);
  });

  it("filters by timing when the visit moves", () => {
    expect(
      scheduleAutomessages({
        deal: { id: 7, stage_id: 3, appointment_at: "2026-03-15T06:00:00Z" },
        rules: [rule({}), rule({ id: 2, timing: "before_visit" })],
        onlyTiming: "before_visit",
        timeZone: TZ,
        now,
      }).map((job) => job.rule_id),
    ).toEqual([2]);
  });
});

describe("automessageValues", () => {
  it("uses the appointment, else the visit", () => {
    expect(
      automessageValues({
        deal: { appointment_at: null, visit_at: "2026-03-12T09:30:00Z" },
        patientFirstName: " Асель ",
        serviceName: "Гигиена",
        clinicName: "Жемчуг",
        timeZone: TZ,
      }),
    ).toEqual({
      имя: "Асель",
      услуга: "Гигиена",
      дата_визита: "12 марта в 14:30",
      клиника: "Жемчуг",
      врач: null,
    });
  });

  it("gives the doctor's name for {врач}", () => {
    const values = automessageValues({
      deal: { appointment_at: null, visit_at: null },
      patientFirstName: "Асель",
      doctorName: " Ахметова Айгуль ",
    });
    expect(values.врач).toBe("Ахметова Айгуль");
    expect(renderTemplate("{имя}, ваш врач — {врач}.", values)).toBe(
      "Асель, ваш врач — Ахметова Айгуль.",
    );
  });
});
