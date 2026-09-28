import { describe, expect, it } from "vitest";

import {
  blockBox,
  busyIntervals,
  clinicHours,
  columnKeyOf,
  columnsFor,
  countByStatus,
  doctorHoursOn,
  findConflict,
  findFreeSlots,
  gridRange,
  hoursWarning,
  isUnconfirmedTomorrow,
  layoutVisits,
  moveVisit,
  parseHm,
  slotAt,
  slotCount,
  toHm,
  visitMinutes,
  weekDayOf,
} from "./scheduleLayout";
import type { DoctorException, Visit } from "./types";

const TZ = "Asia/Almaty"; // UTC+5
const DAY = "2026-09-28"; // a Monday

let nextId = 1;
/** A visit of DAY from hh:mm (Almaty) for minutes */
const visit = (
  time: string,
  minutes: number,
  extra: Partial<Visit> = {},
): Visit => {
  const start = new Date(`${DAY}T${time}:00+05:00`);
  return {
    id: nextId++,
    patient_id: 1,
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + minutes * 60000).toISOString(),
    status: "scheduled",
    source: "crm",
    doctor_id: 1,
    chair_id: 1,
    ...extra,
  };
};

describe("time helpers", () => {
  it("parses and prints wall clock times", () => {
    expect(parseHm("09:30")).toBe(570);
    expect(parseHm("09:30:00")).toBe(570);
    expect(parseHm("nope")).toBeNull();
    expect(toHm(570)).toBe("09:30");
  });

  it("reads a visit in the clinic time zone", () => {
    // 04:30 UTC is 09:30 in Almaty
    expect(
      visitMinutes(
        { starts_at: "2026-09-28T04:30:00Z", ends_at: "2026-09-28T05:15:00Z" },
        TZ,
      ),
    ).toEqual({ day: DAY, start: 570, end: 615 });
    // The same moment is 07:30 in Moscow
    expect(
      visitMinutes(
        { starts_at: "2026-09-28T04:30:00Z", ends_at: "2026-09-28T05:15:00Z" },
        "Europe/Moscow",
      ).start,
    ).toBe(450);
  });
});

describe("the grid", () => {
  it("15-minute rows over the clinic hours", () => {
    const range = gridRange(clinicHours({ hours_start: "09:00", hours_end: "21:00" }), [], [DAY], TZ);
    expect(range).toEqual({ start: 540, end: 1260 });
    expect(slotCount(range)).toBe(48);
    expect(slotAt(0, 20, range)).toBe(540);
    expect(slotAt(41, 20, range)).toBe(570);
    expect(slotAt(99999, 20, range)).toBe(1245);
  });

  it("widens to whole hours around a visit outside the hours", () => {
    const early = visit("07:40", 30);
    expect(gridRange(clinicHours(), [early], [DAY], TZ).start).toBe(7 * 60);
    // a visit of another day does not count
    expect(gridRange(clinicHours(), [early], ["2026-09-29"], TZ).start).toBe(9 * 60);
  });

  it("columns: active doctors in order, inactive ones with visits, «none»", () => {
    const doctors = [
      { id: 2, name: "Б", is_active: true, position: 1 },
      { id: 1, name: "А", is_active: true, position: 0 },
      { id: 3, name: "В", is_active: false, position: 2 },
      { id: 4, name: "Г", is_active: false, position: 3 },
    ];
    const visits = [
      visit("10:00", 30, { doctor_id: 3 }),
      visit("11:00", 30, { doctor_id: null }),
    ];
    expect(columnsFor(doctors, visits, "doctor", "Без врача")).toEqual([
      { key: "1", id: 1, name: "А", inactive: false },
      { key: "2", id: 2, name: "Б", inactive: false },
      { key: "3", id: 3, name: "В", inactive: true },
      { key: "none", id: null, name: "Без врача" },
    ]);
    expect(columnKeyOf(visits[1], "doctor")).toBe("none");
    expect(columnKeyOf(visits[0], "chair")).toBe("1");
  });

  it("overlapping visits share the width, the next one takes a free lane", () => {
    const a = visit("10:00", 60);
    const b = visit("10:30", 30);
    const c = visit("11:00", 30); // starts when a and b end: a new group
    const d = visit("12:00", 15);
    const blocks = layoutVisits([c, b, a, d], DAY, TZ);
    const byId = Object.fromEntries(blocks.map((x) => [x.item.id, x]));
    expect([byId[a.id].column, byId[a.id].columns]).toEqual([0, 2]);
    expect([byId[b.id].column, byId[b.id].columns]).toEqual([1, 2]);
    expect([byId[c.id].column, byId[c.id].columns]).toEqual([0, 1]);
    expect([byId[d.id].column, byId[d.id].columns]).toEqual([0, 1]);
    const range = { start: 540, end: 1260 };
    expect(blockBox(byId[a.id], range)).toEqual({
      top: 4,
      height: 4,
      left: 0,
      width: 0.5,
    });
    expect(blockBox(byId[d.id], range).height).toBe(1);
  });

  it("marks tomorrow's visits not confirmed yet", () => {
    const now = new Date("2026-09-27T12:00:00+05:00");
    expect(isUnconfirmedTomorrow(visit("10:00", 30), now, TZ)).toBe(true);
    expect(
      isUnconfirmedTomorrow(visit("10:00", 30, { status: "confirmed" }), now, TZ),
    ).toBe(false);
    expect(
      isUnconfirmedTomorrow(visit("10:00", 30), new Date("2026-09-28T08:00:00+05:00"), TZ),
    ).toBe(false);
  });

  it("counts by status", () => {
    expect(
      countByStatus([
        visit("10:00", 30),
        visit("11:00", 30, { status: "arrived" }),
        visit("12:00", 30),
      ]),
    ).toEqual({ scheduled: 2, arrived: 1 });
  });
});

describe("hours of a doctor", () => {
  const clinic = clinicHours({ hours_start: "09:00", hours_end: "21:00" });
  const doctor = {
    id: 1,
    working_hours: {
      "1": { start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "14:00" }] },
      "3": { start: "12:00", end: "20:00" },
    },
  };

  it("reads the weekly template, a missing weekday is off", () => {
    expect(weekDayOf(DAY)).toBe("1");
    expect(doctorHoursOn(doctor, DAY, [], clinic)).toMatchObject({ start: 540, end: 1080 });
    expect(doctorHoursOn(doctor, "2026-09-29", [], clinic)).toBeNull();
    expect(doctorHoursOn(doctor, "2026-09-30", [], clinic)).toMatchObject({ start: 720 });
  });

  it("an exception wins: a day off or custom hours", () => {
    const exceptions: DoctorException[] = [
      { id: 1, doctor_id: 1, day: DAY, start_time: null, end_time: null },
      { id: 2, doctor_id: 1, day: "2026-09-29", start_time: "10:00:00", end_time: "14:00:00" },
    ];
    expect(doctorHoursOn(doctor, DAY, exceptions, clinic)).toBeNull();
    expect(doctorHoursOn(doctor, "2026-09-29", exceptions, clinic)).toMatchObject({ start: 600, end: 840 });
  });

  it("without template the clinic hours apply", () => {
    expect(doctorHoursOn({ id: 2, working_hours: {} }, DAY, [], clinic)).toEqual(clinic);
  });

  it("warns outside the hours, in a break, on a day off", () => {
    const hours = doctorHoursOn(doctor, DAY, [], clinic);
    expect(hoursWarning(hours, 600, 630)).toBeNull();
    expect(hoursWarning(hours, 1050, 1110)).toBe("outside_hours");
    expect(hoursWarning(hours, 510, 540)).toBe("outside_hours");
    expect(hoursWarning(hours, 780, 810)).toBe("break");
    expect(hoursWarning(null, 600, 630)).toBe("day_off");
  });
});

describe("moves and free slots", () => {
  it("finds the doctor or chair conflict of a move", () => {
    const a = visit("10:00", 30, { doctor_id: 1, chair_id: 1 });
    const b = visit("11:00", 30, { doctor_id: 2, chair_id: 2 });
    const cancelled = visit("12:00", 30, { status: "cancelled" });
    const all = [a, b, cancelled];
    const moved = { ...b, ...moveVisit(b, DAY, 600, TZ) };
    expect(findConflict({ ...moved, doctor_id: 1, chair_id: 2 }, all)).toMatchObject({
      resource: "doctor",
    });
    expect(findConflict({ ...moved, doctor_id: 2, chair_id: 1 }, all)).toMatchObject({
      resource: "chair",
    });
    // back to back, itself, a cancelled visit: free
    expect(findConflict({ ...b, ...moveVisit(b, DAY, 630, TZ), chair_id: 1, doctor_id: 1 }, all)).toBeNull();
    expect(findConflict(b, all)).toBeNull();
    expect(findConflict({ ...b, ...moveVisit(b, DAY, 720, TZ), doctor_id: 1 }, all)).toBeNull();
  });

  it("moves a visit keeping its duration, in the clinic time zone", () => {
    expect(moveVisit(visit("10:00", 45), "2026-09-29", 14 * 60, TZ)).toEqual({
      starts_at: "2026-09-29T09:00:00.000Z",
      ends_at: "2026-09-29T09:45:00.000Z",
    });
  });

  it("lists the free starts inside the hours, outside breaks and visits", () => {
    const hours = { start: 540, end: 720, breaks: [{ start: "10:00", end: "10:30" }] };
    const busy = busyIntervals(
      [visit("09:00", 30), visit("11:00", 30, { status: "cancelled" }), visit("11:15", 30, { doctor_id: 9 })],
      DAY,
      (v) => v.doctor_id === 1,
      TZ,
    );
    expect(busy).toEqual([{ start: 540, end: 570 }]);
    expect(findFreeSlots({ hours, busy, duration: 30 })).toEqual([
      570, 630, 645, 660, 675, 690,
    ]);
    expect(findFreeSlots({ hours, busy, duration: 60, nowMinute: 640 })).toEqual([645, 660]);
    expect(findFreeSlots({ hours, busy, duration: 30, limit: 2 })).toEqual([570, 630]);
    expect(findFreeSlots({ hours: null, busy, duration: 30 })).toEqual([]);
  });
});
