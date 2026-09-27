import { describe, expect, it } from "vitest";

import type { Deal, Message, Patient } from "../../types";
import {
  applyWaitingFilter,
  dealsWaiting,
  splitMinutes,
  waitingSince,
  workingMinutes,
} from "./responseTime";

// Same cases as supabase/tests/016_notifications.test.sql (Asia/Tashkent = UTC+5)
const TZ = "Asia/Tashkent";
const at = (iso: string) => new Date(iso);

describe("workingMinutes", () => {
  it("counts the minutes within the working hours", () => {
    expect(
      workingMinutes(at("2026-03-12T04:00Z"), at("2026-03-12T04:23Z"), TZ),
    ).toBe(23);
  });
  it("does not count the night", () => {
    expect(
      workingMinutes(at("2026-03-12T15:50Z"), at("2026-03-13T04:10Z"), TZ),
    ).toBe(20);
    expect(
      workingMinutes(at("2026-03-12T02:00Z"), at("2026-03-12T03:00Z"), TZ),
    ).toBe(0);
  });
  it("adds up several days", () => {
    expect(
      workingMinutes(at("2026-03-12T04:00Z"), at("2026-03-14T04:00Z"), TZ),
    ).toBe(1440);
  });
  it("round the clock counts every minute, across midnight", () => {
    expect(
      workingMinutes(
        at("2026-03-12T22:00Z"),
        at("2026-03-13T00:30Z"),
        TZ,
        0,
        24,
      ),
    ).toBe(150);
  });
  it("is zero when no time went by", () => {
    expect(
      workingMinutes(at("2026-03-12T05:00Z"), at("2026-03-12T04:00Z"), TZ),
    ).toBe(0);
  });
});

const message = (
  direction: "in" | "out",
  sent_at: string,
  extra: Partial<Message> = {},
) => ({ direction, sent_at, sales_id: null, automessage_id: null, ...extra });

describe("waitingSince", () => {
  it("is null without messages or after an answer", () => {
    expect(waitingSince([])).toBeNull();
    expect(
      waitingSince([
        message("in", "2026-03-12T05:00:00Z"),
        message("out", "2026-03-12T05:20:00Z"),
      ]),
    ).toBeNull();
  });
  it("starts at the first unanswered message", () => {
    expect(
      waitingSince([
        message("in", "2026-03-12T05:10:00Z"),
        message("in", "2026-03-12T05:00:00Z"),
      ]),
    ).toBe("2026-03-12T05:00:00Z");
    expect(
      waitingSince([
        message("in", "2026-03-12T05:00:00Z"),
        message("out", "2026-03-12T05:20:00Z", { sales_id: 1 }),
        message("in", "2026-03-12T06:00:00Z"),
      ]),
    ).toBe("2026-03-12T06:00:00Z");
  });
  it("does not take an automatic message for an answer", () => {
    expect(
      waitingSince([
        message("in", "2026-03-12T06:00:00Z"),
        message("out", "2026-03-12T06:05:00Z", { automessage_id: 3 }),
      ]),
    ).toBe("2026-03-12T06:00:00Z");
  });
});

describe("dealsWaiting", () => {
  const now = at("2026-03-12T06:00:00Z");
  const deal = (id: number, stage_id = 1, extra: Partial<Deal> = {}) =>
    ({ id, stage_id, patient_id: 1, pipeline_id: 1, ...extra }) as Deal;
  const stages = [
    { id: 1, kind: "open" as const },
    { id: 2, kind: "won" as const },
  ];
  const patients = [
    { id: 1, first_name: "Асель", last_name: "Иванова", phones: ["+7701"] },
  ] as Patient[];
  const inbound = (deal_id: number, minutesAgo: number) =>
    ({
      id: deal_id * 100 + minutesAgo,
      deal_id,
      ...message(
        "in",
        new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
      ),
    }) as Message;

  it("lists the open deals whose patient waits, overdue past the limit", () => {
    const rows = dealsWaiting({
      deals: [deal(1), deal(2), deal(3, 2), deal(4, 1, { archived_at: "x" })],
      stages,
      patients,
      messages: [inbound(1, 20), inbound(2, 5), inbound(3, 60), inbound(4, 60)],
      settings: { response_hours_start: 0, response_hours_end: 24 },
      timeZone: TZ,
      now,
    });
    expect(
      rows.map((r) => [r.id, r.waiting_minutes, r.overdue, r.limit_minutes]),
    ).toEqual([
      [1, 20, true, 15],
      [2, 5, false, 15],
    ]);
    expect(rows[0]).toMatchObject({
      patient_first_name: "Асель",
      patient_last_name: "Иванова",
      patient_phone: "+7701",
    });
  });

  it("counts working minutes only, and nothing when the control is off", () => {
    // 06:00Z = 11:00 in Tashkent; the wait started at 08:40 local
    const rows = dealsWaiting({
      deals: [deal(1)],
      stages,
      patients,
      messages: [inbound(1, 140)],
      timeZone: TZ,
      now,
    });
    expect(rows[0].waiting_minutes).toBe(120);
    expect(
      dealsWaiting({
        deals: [deal(1)],
        stages,
        patients,
        messages: [inbound(1, 140)],
        settings: { response_control_enabled: false },
        now,
      }),
    ).toEqual([]);
  });
});

describe("applyWaitingFilter", () => {
  it("turns the quick filter into a filter on the ids", () => {
    expect(
      applyWaitingFilter(
        { filter: { waiting_response: true, pipeline_id: 1 } },
        [3, 5],
      ),
    ).toEqual({ filter: { pipeline_id: 1, "id@in": "(3,5)" } });
    expect(
      applyWaitingFilter({ filter: { waiting_response: true } }, []),
    ).toEqual({ filter: { "id@in": "()" } });
    const params = { filter: { pipeline_id: 1 } };
    expect(applyWaitingFilter(params, [1])).toBe(params);
  });
});

describe("splitMinutes", () => {
  it("splits hours and minutes", () => {
    expect(splitMinutes(23)).toEqual({ hours: 0, minutes: 23 });
    expect(splitMinutes(125)).toEqual({ hours: 2, minutes: 5 });
  });
});
