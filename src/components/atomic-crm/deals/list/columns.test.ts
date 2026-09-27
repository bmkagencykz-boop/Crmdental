import { describe, expect, it } from "vitest";

import {
  DEAL_COLUMNS,
  DEFAULT_COLUMN_SETTINGS,
  moveColumn,
  normalizeColumns,
  toggleColumn,
  visibleColumns,
  type ColumnSettings,
} from "./columns";

describe("normalizeColumns", () => {
  it("gives the defaults without a stored setting", () => {
    expect(normalizeColumns(undefined)).toEqual(DEFAULT_COLUMN_SETTINGS);
    expect(normalizeColumns({ hidden: ["tags"] })).toEqual(
      DEFAULT_COLUMN_SETTINGS,
    );
  });

  it("drops unknown and duplicate columns, adds the missing ones", () => {
    const settings = normalizeColumns({
      order: ["tags", "name", "gone" as never, "tags", "patient"],
      hidden: ["tags", "gone" as never],
    });
    expect(settings.order.slice(0, 3)).toEqual(["tags", "name", "patient"]);
    expect([...settings.order].sort()).toEqual([...DEAL_COLUMNS].sort());
    // Missing columns hidden by default stay hidden
    expect(settings.hidden).toEqual(["tags", "pipeline", "doctor", "last_activity_at"]);
  });

  it("never hides the deal name and the patient", () => {
    const settings = normalizeColumns({
      order: [...DEAL_COLUMNS],
      hidden: ["name", "patient", "phone"],
    });
    expect(settings.hidden).toEqual(["phone"]);
  });
});

describe("column settings", () => {
  const settings: ColumnSettings = {
    order: [...DEAL_COLUMNS],
    hidden: ["pipeline"],
  };

  it("lists the visible columns in order", () => {
    expect(visibleColumns(settings)).not.toContain("pipeline");
    expect(visibleColumns(settings)[0]).toBe("name");
  });

  it("toggles a column, but not a locked one", () => {
    expect(toggleColumn(settings, "pipeline").hidden).toEqual([]);
    expect(toggleColumn(settings, "tags").hidden).toEqual(["pipeline", "tags"]);
    expect(toggleColumn(settings, "name")).toBe(settings);
  });

  it("moves a column up and down within bounds", () => {
    expect(moveColumn(settings, "phone", -1).order.slice(0, 3)).toEqual([
      "name",
      "phone",
      "patient",
    ]);
    expect(moveColumn(settings, "name", -1)).toBe(settings);
    expect(moveColumn(settings, "tags", 1)).toBe(settings);
    expect(moveColumn(settings, "tags", -1).order.slice(-2)).toEqual([
      "tags",
      "next_task",
    ]);
  });
});
