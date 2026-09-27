import { describe, expect, it } from "vitest";
import { dayLabel } from "./DealFeed";
import { formatDelay } from "./DealFields";
import { daysInStage } from "./DealHeader";

describe("deal page helpers", () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const t = (key: string) => key;

  it("counts whole days in the stage", () => {
    expect(daysInStage(new Date(2026, 8, 28, 13, 0).toISOString(), now)).toBe(
      2,
    );
    expect(daysInStage(null, now)).toBe(0);
  });

  it("labels feed days like a chat", () => {
    expect(dayLabel(new Date(2026, 9, 1, 9).toISOString(), t, now)).toBe(
      "crm.common.today",
    );
    expect(dayLabel(new Date(2026, 8, 30, 9).toISOString(), t, now)).toBe(
      "crm.common.yesterday",
    );
    expect(dayLabel(new Date(2026, 8, 20, 9).toISOString(), t, now)).toBe(
      "20 сентября",
    );
  });

  it("shows the response time", () => {
    expect(formatDelay("2026-10-01T10:00:00Z", "2026-10-01T10:12:00Z")).toBe(
      "12 мин",
    );
    expect(formatDelay("2026-10-01T10:00:00Z", "2026-10-01T13:05:00Z")).toBe(
      "3 ч 5 мин",
    );
    expect(formatDelay("2026-10-01T10:00:00Z", null)).toBe(null);
  });
});
