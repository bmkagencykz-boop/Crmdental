import { describe, expect, it } from "vitest";

import {
  ageOn,
  ageText,
  formatIin,
  iinCheckDigit,
  isValidIin,
  normalizeIin,
  parseIin,
} from "./iin";

// The same numbers as supabase/tests/037_patient_card.test.sql
describe("parseIin", () => {
  it("reads the birth date and the sex of a valid IIN", () => {
    expect(parseIin("900515400123")).toEqual({
      valid: true,
      iin: "900515400123",
      birthDate: "1990-05-15",
      gender: "female",
    });
    expect(parseIin("851203300459")).toMatchObject({
      valid: true,
      birthDate: "1985-12-03",
      gender: "male",
    });
    expect(parseIin("120305650781")).toMatchObject({
      valid: true,
      birthDate: "2012-03-05",
      gender: "female",
    });
  });

  it("accepts spaces and dashes", () => {
    expect(normalizeIin(" 9005 1540-0123 ")).toBe("900515400123");
    expect(isValidIin("9005 1540 0123")).toBe(true);
  });

  it("uses the second weights when the first sum gives 10", () => {
    expect(iinCheckDigit("90051540050")).toBe(2);
    expect(isValidIin("900515400502")).toBe(true);
  });

  it("names what is wrong", () => {
    expect(parseIin("90051540012")).toMatchObject({
      valid: false,
      problem: "length",
    });
    expect(parseIin("9005154001a3")).toMatchObject({ problem: "length" });
    expect(parseIin("901315400123")).toMatchObject({ problem: "date" });
    expect(parseIin("900230400123")).toMatchObject({ problem: "date" });
    expect(parseIin("900515700123")).toMatchObject({ problem: "date" });
    expect(parseIin("900515400124")).toMatchObject({ problem: "checksum" });
  });

  it("formats the IIN in two groups", () => {
    expect(formatIin("900515400123")).toBe("900515 400123");
    expect(formatIin("123")).toBe("123");
  });
});

describe("age", () => {
  const now = new Date(2026, 8, 28);
  it("counts full years", () => {
    expect(ageOn("1990-05-15", now)).toBe(36);
    expect(ageOn("1990-09-28", now)).toBe(36);
    expect(ageOn("1990-09-29", now)).toBe(35);
    expect(ageOn(null, now)).toBeNull();
  });
  it("says it in Russian", () => {
    expect(ageText(1)).toBe("1 год");
    expect(ageText(34)).toBe("34 года");
    expect(ageText(12)).toBe("12 лет");
    expect(ageText(21)).toBe("21 год");
    expect(ageText(111)).toBe("111 лет");
  });
});
