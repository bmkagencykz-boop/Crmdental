import { describe, expect, it } from "vitest";
import { formatDuration, parseDuration } from "./PatientCalls";

describe("call durations", () => {
  it("reads minutes:seconds, decimal minutes or nothing", () => {
    expect(parseDuration("3:04")).toBe(184);
    expect(parseDuration("2,5")).toBe(150);
    expect(parseDuration("")).toBe(0);
    expect(parseDuration("abc")).toBeNull();
  });

  it("formats seconds as m:ss", () => {
    expect(formatDuration(184)).toBe("3:04");
    expect(formatDuration(59)).toBe("0:59");
  });
});
