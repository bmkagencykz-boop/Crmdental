import { describe, expect, it } from "vitest";

import {
  addDays,
  blockBox,
  calendarRange,
  dayKeyOf,
  layoutDay,
  minuteOfDay,
  moveToDay,
  moveToSlot,
  quickReschedule,
  shiftAnchor,
  slotAt,
  startOfWeek,
  taskDuration,
  tasksByDay,
  taskStatus,
  zonedMoment,
} from "./calendarLayout";

const TZ = "Asia/Almaty"; // UTC+5
const task = (
  id: number,
  due_date: string,
  extra: { type?: any; duration_minutes?: number | null } = {},
) => ({ id, type: "call" as const, due_date, ...extra });

describe("days of the clinic", () => {
  it("reads the day and time in the clinic time zone", () => {
    // 20:30 UTC on the 27th is 01:30 on the 28th in Almaty
    expect(dayKeyOf("2026-09-27T20:30:00Z", TZ)).toBe("2026-09-28");
    expect(minuteOfDay("2026-09-27T20:30:00Z", TZ)).toBe(90);
    expect(dayKeyOf("2026-09-27T20:30:00Z", "Europe/Moscow")).toBe(
      "2026-09-27",
    );
  });

  it("finds the moment of a wall clock time", () => {
    expect(zonedMoment("2026-09-28", 10 * 60, TZ).toISOString()).toBe(
      "2026-09-28T05:00:00.000Z",
    );
    expect(zonedMoment("2026-09-28", 0, "Europe/Moscow").toISOString()).toBe(
      "2026-09-27T21:00:00.000Z",
    );
  });

  it("walks days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sunday → Monday
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });
});

describe("calendarRange", () => {
  it("a day", () => {
    const range = calendarRange("day", "2026-09-28", TZ);
    expect(range.days).toEqual(["2026-09-28"]);
    expect(range.start.toISOString()).toBe("2026-09-27T19:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-28T19:00:00.000Z");
  });

  it("a week runs Monday to Sunday of the clinic", () => {
    const range = calendarRange("week", "2026-10-01", TZ);
    expect(range.days[0]).toBe("2026-09-28");
    expect(range.days[6]).toBe("2026-10-04");
    expect(range.days).toHaveLength(7);
    expect(range.start.toISOString()).toBe("2026-09-27T19:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-10-04T19:00:00.000Z");
  });

  it("a month covers whole weeks around it", () => {
    const range = calendarRange("month", "2026-09-17", TZ);
    // September 2026 starts on a Tuesday and ends on a Wednesday
    expect(range.days[0]).toBe("2026-08-31");
    expect(range.days[range.days.length - 1]).toBe("2026-10-04");
    expect(range.days.length % 7).toBe(0);
    expect(range.start.toISOString()).toBe("2026-08-30T19:00:00.000Z");
  });

  it("moves by a day, a week or a month", () => {
    expect(shiftAnchor("day", "2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftAnchor("week", "2026-09-30", -1)).toBe("2026-09-23");
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});

describe("layoutDay", () => {
  const day = "2026-09-28";
  // Almaty wall clock 10:00 = 05:00 UTC
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return zonedMoment(day, h * 60 + m, TZ).toISOString();
  };

  it("places a task at its time for its duration", () => {
    const { blocks, outside } = layoutDay([task(1, at("10:00"))], day, TZ);
    expect(outside).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      start: 600,
      end: 630,
      column: 0,
      columns: 1,
    });
    expect(blockBox(blocks[0])).toEqual({
      top: 4,
      height: 1,
      left: 0,
      width: 1,
    });
  });

  it("meetings last an hour by default, a set duration wins", () => {
    expect(taskDuration({ type: "meeting" })).toBe(60);
    expect(taskDuration({ type: "call" })).toBe(30);
    expect(taskDuration({ type: "meeting", duration_minutes: 90 })).toBe(90);
    const { blocks } = layoutDay(
      [task(1, at("11:00"), { type: "meeting" })],
      day,
      TZ,
    );
    expect(blocks[0].end - blocks[0].start).toBe(60);
  });

  it("puts overlapping tasks side by side", () => {
    const { blocks } = layoutDay(
      [
        task(1, at("10:00"), { duration_minutes: 90 }),
        task(2, at("10:30")),
        task(3, at("11:00")), // free again in column 1 after task 2
        task(4, at("12:00")), // alone
      ],
      day,
      TZ,
    );
    const byId = Object.fromEntries(blocks.map((b) => [b.task.id, b]));
    expect(byId[1]).toMatchObject({ column: 0, columns: 2 });
    expect(byId[2]).toMatchObject({ column: 1, columns: 2 });
    expect(byId[3]).toMatchObject({ column: 1, columns: 2 });
    expect(byId[4]).toMatchObject({ column: 0, columns: 1 });
    expect(blockBox(byId[2])).toMatchObject({ left: 0.5, width: 0.5 });
  });

  it("three tasks at the same time take three columns, longest first", () => {
    const { blocks } = layoutDay(
      [
        task(1, at("09:00")),
        task(2, at("09:00"), { duration_minutes: 90 }),
        task(3, at("09:00")),
      ],
      day,
      TZ,
    );
    expect(blocks.map((b) => [b.task.id, b.column, b.columns])).toEqual([
      [2, 0, 3],
      [1, 1, 3],
      [3, 2, 3],
    ]);
  });

  it("lists tasks outside 8:00-21:00 apart and cuts blocks at 21:00", () => {
    const { blocks, outside } = layoutDay(
      [
        task(1, at("07:30")),
        task(2, at("21:00")),
        task(3, at("20:30"), { duration_minutes: 120 }),
        task(4, zonedMoment("2026-09-29", 600, TZ).toISOString()),
      ],
      day,
      TZ,
    );
    expect(outside.map((t) => t.id)).toEqual([1, 2]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start: 1230, end: 1260 });
  });

  it("groups tasks by day for the month", () => {
    const days = tasksByDay(
      [
        task(1, "2026-09-28T10:00:00Z"),
        task(2, "2026-09-28T04:00:00Z"),
        task(3, "2026-09-28T20:00:00Z"), // 01:00 on the 29th in Almaty
      ],
      TZ,
    );
    expect(days.get("2026-09-28")!.map((t) => t.id)).toEqual([2, 1]);
    expect(days.get("2026-09-29")!.map((t) => t.id)).toEqual([3]);
  });
});

describe("status", () => {
  const now = new Date("2026-09-28T06:00:00Z");
  it("is overdue once the time has passed, done wins", () => {
    expect(taskStatus({ due_date: "2026-09-28T05:00:00Z" }, now)).toBe(
      "overdue",
    );
    expect(taskStatus({ due_date: "2026-09-28T07:00:00Z" }, now)).toBe("open");
    expect(
      taskStatus(
        { due_date: "2026-09-28T05:00:00Z", done_date: "2026-09-28T05:10:00Z" },
        now,
      ),
    ).toBe("done");
  });
});

describe("rescheduling", () => {
  it("finds the slot under the pointer", () => {
    expect(slotAt(0, 28)).toBe(480);
    expect(slotAt(28 * 4 + 5, 28)).toBe(600);
    expect(slotAt(-10, 28)).toBe(480);
    expect(slotAt(28 * 100, 28)).toBe(20 * 60 + 30);
  });

  it("drops on a slot or on a day of the month", () => {
    expect(moveToSlot("2026-09-30", 14 * 60 + 30, TZ)).toBe(
      "2026-09-30T09:30:00.000Z",
    );
    // 10:15 in Almaty keeps its time on another day
    expect(moveToDay("2026-09-28T05:15:00.000Z", "2026-10-02", TZ)).toBe(
      "2026-10-02T05:15:00.000Z",
    );
  });

  it("+1 hour from the due time, or from now when late", () => {
    const now = new Date("2026-09-28T06:00:30Z");
    expect(quickReschedule("hour", "2026-09-28T08:00:00.000Z", TZ, now)).toBe(
      "2026-09-28T09:00:00.000Z",
    );
    expect(quickReschedule("hour", "2026-09-27T08:00:00.000Z", TZ, now)).toBe(
      "2026-09-28T07:01:00.000Z",
    );
  });

  it("tomorrow and in a week keep the time of day, from today of the clinic", () => {
    // 0:30 on the 29th in Almaty while still the 28th in UTC
    const now = new Date("2026-09-28T19:30:00Z");
    const due = "2026-09-25T04:00:00.000Z"; // 9:00 in Almaty, late
    expect(quickReschedule("tomorrow", due, TZ, now)).toBe(
      "2026-09-30T04:00:00.000Z",
    );
    expect(quickReschedule("week", due, TZ, now)).toBe(
      "2026-10-06T04:00:00.000Z",
    );
  });
});
