import { describe, expect, it } from "vitest";

import { formatDuration, formatPercent, toReportFilters } from "./format";

describe("formatDuration", () => {
  it("speaks human Russian", () => {
    expect(formatDuration(2 * 3600 + 15 * 60)).toBe("2 ч 15 мин");
    expect(formatDuration(3 * 86400 + 4 * 3600 + 59)).toBe("3 дн 4 ч");
    expect(formatDuration(2 * 86400)).toBe("2 дн");
    expect(formatDuration(3600)).toBe("1 ч");
    expect(formatDuration(45 * 60)).toBe("45 мин");
    expect(formatDuration(20)).toBe("< 1 мин");
    expect(formatDuration(null)).toBe("—");
  });

  it("takes other units", () => {
    expect(formatDuration(5400, { day: "d", hour: "h", minute: "min" })).toBe(
      "1 h 30 min",
    );
  });
});

describe("formatPercent", () => {
  it("rounds to whole percents", () => {
    expect(formatPercent(2, 3)).toBe("67 %");
    expect(formatPercent(0, 5)).toBe("0 %");
    expect(formatPercent(1, 0)).toBe("—");
  });
});

describe("toReportFilters", () => {
  const now = new Date(2026, 8, 27, 15, 30);

  it("turns a preset into a start of day", () => {
    expect(toReportFilters({ period: "week" }, now)).toEqual({
      from: new Date(2026, 8, 20).toISOString(),
      to: null,
      pipeline_id: null,
      sales_id: null,
      source_id: null,
    });
    expect(toReportFilters({ period: "all" }, now).from).toBeNull();
  });

  it("includes both days of a custom period", () => {
    const filters = toReportFilters(
      {
        period: "custom",
        from: "2026-09-01",
        to: "2026-09-30",
        pipeline_id: "1",
        sales_id: "",
      },
      now,
    );
    expect(filters).toEqual({
      from: new Date(2026, 8, 1).toISOString(),
      to: new Date(2026, 9, 1).toISOString(),
      pipeline_id: "1",
      sales_id: null,
      source_id: null,
    });
  });
});
