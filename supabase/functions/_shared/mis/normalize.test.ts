// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  amountOf,
  booleanOf,
  dateOf,
  dateTimeOf,
  idOf,
  phonesOf,
  pick,
  statusOf,
} from "./normalize";

describe("pick", () => {
  it("ignores case, underscores and dashes, reads nested names", () => {
    const record = {
      PatientId: 7,
      "first-name": "Асель",
      patient: { phone: "8701" },
    };
    expect(pick(record, ["patient_id"])).toBe(7);
    expect(pick(record, ["first_name"])).toBe("Асель");
    expect(pick(record, ["patient.phone"])).toBe("8701");
    expect(pick(record, ["missing", "firstName"])).toBe("Асель");
    expect(pick(record, ["missing"])).toBeUndefined();
  });

  it("skips empty values", () => {
    expect(pick({ phone: "", mobile: "+7701" }, ["phone", "mobile"])).toBe(
      "+7701",
    );
  });
});

describe("idOf", () => {
  it("reads numbers, strings and objects", () => {
    expect(idOf(15)).toBe("15");
    expect(idOf(" a-1 ")).toBe("a-1");
    expect(idOf({ id: 3 })).toBe("3");
    expect(idOf(null)).toBeNull();
  });
});

describe("phonesOf", () => {
  it("reads strings, lists and objects, drops short numbers", () => {
    expect(phonesOf("8 (701) 111-22-33, +7 702 000 11 22")).toEqual([
      "8 (701) 111-22-33",
      "+7 702 000 11 22",
    ]);
    expect(
      phonesOf([{ number: "+77011112233" }, "123", { phone: "87011112233" }]),
    ).toEqual(["+77011112233", "87011112233"]);
    expect(phonesOf(null)).toEqual([]);
  });
});

describe("dateTimeOf", () => {
  it("reads a local time as the clinic's time", () => {
    expect(dateTimeOf("2026-10-15 10:30")).toBe("2026-10-15T05:30:00.000Z");
    expect(dateTimeOf("15.10.2026 10:30")).toBe("2026-10-15T05:30:00.000Z");
    expect(dateTimeOf("2026-10-15", "+05:00", "09:15")).toBe(
      "2026-10-15T04:15:00.000Z",
    );
  });

  it("keeps an explicit zone and reads Unix time", () => {
    expect(dateTimeOf("2026-10-15T10:30:00+06:00")).toBe(
      "2026-10-15T04:30:00.000Z",
    );
    expect(dateTimeOf("2026-10-15T10:30:00Z")).toBe("2026-10-15T10:30:00.000Z");
    expect(dateTimeOf("2026-10-15 10:30:00+05")).toBe(
      "2026-10-15T05:30:00.000Z",
    );
    expect(dateTimeOf(1760520600)).toBe("2025-10-15T09:30:00.000Z");
    expect(dateTimeOf("nonsense")).toBeNull();
    expect(dateTimeOf("")).toBeNull();
  });
});

describe("dateOf, amountOf, booleanOf", () => {
  it("reads dates, amounts and flags", () => {
    expect(dateOf("04.05.1990")).toBe("1990-05-04");
    expect(dateOf("1990-05-04T00:00:00")).toBe("1990-05-04");
    expect(amountOf("12 500,50 ₸")).toBe(12500.5);
    expect(amountOf(3000)).toBe(3000);
    expect(amountOf("много")).toBeNull();
    expect(booleanOf("да")).toBe(true);
    expect(booleanOf(0)).toBe(false);
    expect(booleanOf("?")).toBeNull();
  });
});

describe("statusOf", () => {
  it.each([
    ["Записан", "scheduled"],
    ["Подтверждён", "confirmed"],
    ["Пришёл", "arrived"],
    ["Пациент на приёме", "arrived"],
    ["Визит состоялся", "completed"],
    ["Завершён", "completed"],
    ["Лечение начато", "in_treatment"],
    ["Отменён", "cancelled"],
    ["Не пришёл", "no_show"],
    ["Неявка", "no_show"],
    ["cancelled", "cancelled"],
    ["no_show", "no_show"],
    ["completed", "completed"],
    ["booked", "scheduled"],
    ["", "scheduled"],
    ["что-то новое", "scheduled"],
  ])("%s → %s", (label, status) => {
    expect(statusOf(label)).toBe(status);
  });

  it("uses the vendor codes first", () => {
    expect(statusOf(3, { "3": "completed" })).toBe("completed");
  });
});
