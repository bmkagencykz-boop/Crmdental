import { describe, expect, it } from "vitest";

import { zonedMoment } from "../tasks/calendarLayout";
import type { Visit } from "../schedule/types";
import type { WaitingEntry } from "./types";
import {
  countActive,
  dayPartOf,
  entriesForFreedSlot,
  entryDuration,
  entryFitsSlot,
  filterEntries,
  fillOffer,
  fitsWishes,
  freedSlotOf,
  freedSlotOfChange,
  groupEntries,
  nearestSlots,
} from "./waitingMatch";

const TZ = "Asia/Almaty";
const at = (day: string, hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return zonedMoment(day, h * 60 + m, TZ).toISOString();
};

const entry = (patch: Partial<WaitingEntry> = {}): WaitingEntry => ({
  id: 1,
  patient_id: 10,
  doctor_id: null,
  date_from: "2031-03-01",
  date_to: null,
  weekdays: [],
  day_parts: [],
  priority: "normal",
  status: "waiting",
  created_at: "2031-02-20T05:00:00.000Z",
  ...patch,
});

const doctorA = {
  id: 1,
  name: "Ахметова",
  is_active: true,
  visit_minutes: 30,
  working_hours: {
    "1": { start: "09:00", end: "13:00" },
    "2": {
      start: "09:00",
      end: "13:00",
      breaks: [{ start: "11:00", end: "12:00" }],
    },
    "3": { start: "14:00", end: "18:00" },
  },
};
const doctorB = {
  id: 2,
  name: "Бекова",
  is_active: true,
  visit_minutes: 60,
  branch_id: 7,
  working_hours: { "2": { start: "16:00", end: "20:00" } },
};
const clinic = { start: 9 * 60, end: 21 * 60, breaks: [] };

const visit = (patch: Partial<Visit>): Visit => ({
  id: 100,
  patient_id: 50,
  doctor_id: 1,
  starts_at: at("2031-03-04", "09:00"),
  ends_at: at("2031-03-04", "09:30"),
  status: "scheduled",
  source: "crm",
  ...patch,
});

describe("dayPartOf", () => {
  it("splits the day at 12:00 and 16:00", () => {
    expect(dayPartOf(9 * 60)).toBe("morning");
    expect(dayPartOf(12 * 60)).toBe("day");
    expect(dayPartOf(15 * 60 + 45)).toBe("day");
    expect(dayPartOf(16 * 60)).toBe("evening");
  });
});

describe("fitsWishes", () => {
  it("checks the period, the days, the parts and the hours", () => {
    const wishes = entry({
      date_from: "2031-03-01",
      date_to: "2031-03-31",
      weekdays: [2, 4],
      day_parts: ["morning"],
    });
    // 2031-03-04 is a Tuesday
    expect(fitsWishes(wishes, "2031-03-04", 10 * 60)).toBe(true);
    expect(fitsWishes(wishes, "2031-03-05", 10 * 60)).toBe(false);
    expect(fitsWishes(wishes, "2031-03-04", 13 * 60)).toBe(false);
    expect(fitsWishes(wishes, "2031-04-01", 10 * 60)).toBe(false);
    expect(fitsWishes(wishes, "2031-02-25", 10 * 60)).toBe(false);
    const hours = entry({ time_from: "09:00:00", time_to: "11:00:00" });
    expect(fitsWishes(hours, "2031-03-04", 10 * 60 + 45)).toBe(true);
    expect(fitsWishes(hours, "2031-03-04", 11 * 60)).toBe(false);
  });
});

describe("entryFitsSlot", () => {
  const slot = {
    doctor_id: 1,
    starts_at: at("2031-03-04", "10:00"),
    ends_at: at("2031-03-04", "10:30"),
  };
  it("matches like private.waiting_entry_fits", () => {
    expect(entryFitsSlot(entry(), slot, TZ)).toBe(true);
    expect(entryFitsSlot(entry({ doctor_id: 1 }), slot, TZ)).toBe(true);
    expect(entryFitsSlot(entry({ doctor_id: 2 }), slot, TZ)).toBe(false);
    expect(entryFitsSlot(entry({ status: "booked" }), slot, TZ)).toBe(false);
    expect(entryFitsSlot(entry({ status: "offered" }), slot, TZ)).toBe(true);
    expect(entryFitsSlot(entry({ day_parts: ["evening"] }), slot, TZ)).toBe(
      false,
    );
    expect(entryFitsSlot(entry({ duration_minutes: 60 }), slot, TZ)).toBe(
      false,
    );
    expect(entryFitsSlot(entry({ duration_minutes: 30 }), slot, TZ)).toBe(true);
  });
  it("respects the branch when both are known", () => {
    expect(
      entryFitsSlot(entry({ branch_id: 7 }), { ...slot, branch_id: 8 }, TZ),
    ).toBe(false);
    expect(
      entryFitsSlot(entry({ branch_id: 7 }), { ...slot, branch_id: null }, TZ),
    ).toBe(true);
    expect(entryFitsSlot(entry(), { ...slot, branch_id: 8 }, TZ)).toBe(true);
  });
});

describe("entryDuration", () => {
  it("takes the entry's, the service's, the doctor's length", () => {
    expect(entryDuration(entry({ duration_minutes: 45 }), doctorB, 90)).toBe(
      45,
    );
    expect(entryDuration(entry(), doctorB, 90)).toBe(90);
    expect(entryDuration(entry(), doctorB)).toBe(60);
    expect(entryDuration(entry())).toBe(30);
  });
});

describe("nearestSlots", () => {
  // Monday 2031-03-03, 08:00 in the clinic
  const now = new Date(at("2031-03-03", "08:00"));
  const base = {
    doctors: [doctorA, doctorB],
    visits: [] as Visit[],
    exceptions: [],
    clinic,
    timeZone: TZ,
    now,
  };

  it("finds the first free times of the entry's doctor", () => {
    const slots = nearestSlots({ ...base, entry: entry({ doctor_id: 1 }) });
    expect(slots.map((slot) => [slot.day, slot.start])).toEqual([
      ["2031-03-03", 9 * 60],
      ["2031-03-03", 9 * 60 + 30],
      ["2031-03-03", 10 * 60],
    ]);
    expect(slots[0].starts_at).toBe(at("2031-03-03", "09:00"));
    expect(slots[0].ends_at).toBe(at("2031-03-03", "09:30"));
  });

  it("skips busy time, the break, the past and the days off", () => {
    const visits = [
      visit({
        starts_at: at("2031-03-04", "09:00"),
        ends_at: at("2031-03-04", "10:30"),
      }),
      // A cancelled visit does not hold its time
      visit({
        id: 101,
        starts_at: at("2031-03-04", "12:00"),
        ends_at: at("2031-03-04", "12:30"),
        status: "cancelled",
      }),
    ];
    const slots = nearestSlots({
      ...base,
      visits,
      now: new Date(at("2031-03-04", "08:30")),
      entry: entry({ doctor_id: 1 }),
      limit: 5,
    });
    expect(slots.map((slot) => slot.start)).toEqual(
      [10 * 60 + 30, 12 * 60, 12 * 60 + 30].concat([14 * 60, 14 * 60 + 30]),
    );
    expect(slots.at(-1)?.day).toBe("2031-03-05");
  });

  it("counts the busy time of the visits the employee does not see", () => {
    const slots = nearestSlots({
      ...base,
      busy: [
        {
          doctor_id: 1,
          chair_id: null,
          starts_at: at("2031-03-03", "09:00"),
          ends_at: at("2031-03-03", "12:30"),
        },
      ],
      entry: entry({ doctor_id: 1 }),
      limit: 1,
    });
    expect(slots[0].start).toBe(12 * 60 + 30);
  });

  it("follows the days of the week and the parts of the day", () => {
    const slots = nearestSlots({
      ...base,
      entry: entry({ weekdays: [2], day_parts: ["evening"] }),
      limit: 2,
    });
    // Tuesday: doctor B from 16:00, one-hour visits that do not overlap
    expect(slots.map((slot) => [slot.day, slot.doctor_id, slot.start])).toEqual(
      [
        ["2031-03-04", 2, 16 * 60],
        ["2031-03-04", 2, 17 * 60],
      ],
    );
  });

  it("any doctor of the entry's branch; nothing after the period", () => {
    const slots = nearestSlots({
      ...base,
      entry: entry({ branch_id: 8 }),
      limit: 3,
    });
    expect(slots.every((slot) => slot.doctor_id === 1)).toBe(true);
    expect(
      nearestSlots({
        ...base,
        entry: entry({ doctor_id: 2, date_to: "2031-03-03" }),
      }),
    ).toEqual([]);
    expect(
      nearestSlots({ ...base, entry: entry({ status: "booked" }) }),
    ).toEqual([]);
  });

  it("starts at the period of the entry", () => {
    const slots = nearestSlots({
      ...base,
      entry: entry({ doctor_id: 1, date_from: "2031-03-05" }),
      limit: 1,
    });
    expect(slots[0]).toMatchObject({ day: "2031-03-05", start: 14 * 60 });
  });
});

describe("groups and filters", () => {
  const now = new Date("2031-03-20T05:00:00.000Z");
  const entries = [
    entry({
      id: 1,
      priority: "urgent",
      created_at: "2031-03-19T05:00:00.000Z",
    }),
    entry({ id: 2, created_at: "2031-03-01T05:00:00.000Z", doctor_id: 1 }),
    entry({ id: 3, created_at: "2031-03-18T05:00:00.000Z", service_id: 5 }),
    entry({
      id: 4,
      created_at: "2031-03-19T05:00:00.000Z",
      slot_starts_at: "2031-03-25T05:00:00.000Z",
      slot_doctor_id: 1,
    }),
    entry({
      id: 5,
      status: "booked",
      status_changed_at: "2031-03-19T05:00:00.000Z",
    }),
    entry({
      id: 6,
      status: "cancelled",
      status_changed_at: "2031-03-10T05:00:00.000Z",
    }),
  ];

  it("groups by urgency and age, a freed slot first", () => {
    const groups = groupEntries(entries, now);
    expect(groups.urgent.map((e) => e.id)).toEqual([1]);
    expect(groups.long.map((e) => e.id)).toEqual([2]);
    expect(groups.recent.map((e) => e.id)).toEqual([4, 3]);
    expect(groups.closed.map((e) => e.id)).toEqual([5, 6]);
    expect(countActive(entries)).toBe(4);
  });

  it("a freed slot counts while it is ahead", () => {
    expect(freedSlotOf(entries[3], now)?.doctor_id).toBe(1);
    expect(
      freedSlotOf(entries[3], new Date("2031-03-26T00:00:00Z")),
    ).toBeNull();
    expect(freedSlotOf({ ...entries[3], status: "booked" }, now)).toBeNull();
  });

  it("filters: an entry for any doctor matches every doctor", () => {
    expect(filterEntries(entries, { doctorId: 2 }).map((e) => e.id)).toEqual([
      1, 3, 4, 5, 6,
    ]);
    expect(filterEntries(entries, { serviceId: 5 }).map((e) => e.id)).toEqual([
      3,
    ]);
  });
});

describe("fillOffer", () => {
  it("fills the template of the offer", () => {
    expect(
      fillOffer(
        "Здравствуйте, %{name}! Освободилось время у врача %{doctor}: %{date} в %{time}.",
        {
          name: "Асель",
          doctor: "Ахметова Айгуль",
          date: "04.03",
          time: "10:00",
        },
      ),
    ).toBe(
      "Здравствуйте, Асель! Освободилось время у врача Ахметова Айгуль: 04.03 в 10:00.",
    );
    expect(fillOffer("Здравствуйте, %{name}!", { date: "", time: "" })).toBe(
      "Здравствуйте!",
    );
  });
});

describe("freed slots", () => {
  const now = new Date(at("2031-03-03", "08:00"));
  const before = visit({
    id: 7,
    patient_id: 50,
    starts_at: at("2031-03-04", "10:00"),
    ends_at: at("2031-03-04", "10:30"),
  });

  it("a cancelled, missed, deleted or moved visit frees its time", () => {
    expect(
      freedSlotOfChange(before, { ...before, status: "cancelled" }, now),
    ).toMatchObject({
      doctor_id: 1,
      starts_at: before.starts_at,
      patient_id: 50,
    });
    expect(
      freedSlotOfChange(before, { ...before, status: "no_show" }, now),
    ).not.toBeNull();
    expect(freedSlotOfChange(before, null, now)).not.toBeNull();
    expect(
      freedSlotOfChange(
        before,
        {
          ...before,
          starts_at: at("2031-03-04", "15:00"),
          ends_at: at("2031-03-04", "15:30"),
        },
        now,
      ),
    ).not.toBeNull();
  });

  it("nothing for an overlapping move, a past or an inactive visit", () => {
    expect(
      freedSlotOfChange(
        before,
        {
          ...before,
          starts_at: at("2031-03-04", "10:15"),
          ends_at: at("2031-03-04", "10:45"),
        },
        now,
      ),
    ).toBeNull();
    expect(
      freedSlotOfChange(before, null, new Date(at("2031-03-05", "08:00"))),
    ).toBeNull();
    expect(
      freedSlotOfChange({ ...before, status: "cancelled" }, null, now),
    ).toBeNull();
    expect(
      freedSlotOfChange(before, { ...before, status: "confirmed" }, now),
    ).toBeNull();
  });

  it("highlights the fitting entries, urgent and oldest first, not the same patient", () => {
    const slot = freedSlotOfChange(before, null, now)!;
    const entries = [
      entry({ id: 1, created_at: "2031-02-01T00:00:00.000Z" }),
      entry({
        id: 2,
        priority: "urgent",
        created_at: "2031-02-10T00:00:00.000Z",
      }),
      entry({ id: 3, patient_id: 50 }),
      entry({ id: 4, doctor_id: 2 }),
      entry({ id: 5, day_parts: ["evening"] }),
      entry({
        id: 6,
        slot_starts_at: before.starts_at,
        slot_doctor_id: 1,
      }),
      ...[7, 8, 9, 10, 11].map((id) =>
        entry({ id, created_at: `2031-02-${10 + id}T00:00:00.000Z` }),
      ),
    ];
    expect(entriesForFreedSlot(entries, slot, TZ).map((e) => e.id)).toEqual([
      2, 1, 7, 8, 9,
    ]);
  });
});
