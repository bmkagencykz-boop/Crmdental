import { describe, expect, it } from "vitest";
import { periodChoices, periodStart } from "./periods";

describe("periodStart", () => {
  it("starts at midnight N days ago", () => {
    const now = new Date(2026, 8, 27, 15, 30);
    expect(new Date(periodStart(7, now))).toEqual(new Date(2026, 8, 20, 0, 0));
    expect(new Date(periodStart(0, now))).toEqual(new Date(2026, 8, 27, 0, 0));
  });

  it("gives stable ids during the day", () => {
    const t = (key: string) => key;
    expect(periodChoices(t, new Date(2026, 8, 27, 9))).toEqual(
      periodChoices(t, new Date(2026, 8, 27, 23)),
    );
  });
});
