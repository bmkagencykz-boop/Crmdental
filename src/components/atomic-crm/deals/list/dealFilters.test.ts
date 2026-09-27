import { describe, expect, it } from "vitest";

import { periodStart } from "../periods";
import { WAITING_FILTER } from "../../providers/commons/responseTime";
import {
  applyTaskStateFilter,
  deserializeFilter,
  FILTER_PRESETS,
  isSameFilter,
  ME,
  MONTH_START,
  monthStart,
  serializeFilter,
  TASK_STATE_FILTER,
} from "./dealFilters";

const now = new Date(2026, 8, 27, 15, 30);

describe("applyTaskStateFilter", () => {
  const params = (value?: string) => ({
    filter: { sales_id: 3, ...(value ? { [TASK_STATE_FILTER]: value } : {}) },
  });

  it("keeps the params without the filter", () => {
    const p = params();
    expect(applyTaskStateFilter(p, now)).toBe(p);
  });

  it("open deals without an open task", () => {
    expect(applyTaskStateFilter(params("no_task"), now).filter).toEqual({
      sales_id: 3,
      stage_kind: "open",
      nb_open_tasks: 0,
    });
  });

  it("open deals whose nearest task is past due", () => {
    expect(applyTaskStateFilter(params("overdue"), now).filter).toEqual({
      sales_id: 3,
      stage_kind: "open",
      "next_task_due_at@lt": now.toISOString(),
    });
  });

  it("drops an unknown value", () => {
    expect(applyTaskStateFilter(params("other"), now).filter).toEqual({
      sales_id: 3,
    });
  });
});

describe("saved filter serialization", () => {
  it("keeps the employee, the periods and the month relative", () => {
    const saved = serializeFilter(
      {
        sales_id: 7,
        "created_at@gte": periodStart(7, now),
        "closed_at@gte": monthStart(now),
        source_id: 2,
        "tags@cs": "{1}",
        q: "",
        service_id: null,
      },
      { me: 7, now },
    );
    expect(saved).toEqual({
      sales_id: ME,
      "created_at@gte": "$period:week",
      "closed_at@gte": MONTH_START,
      source_id: 2,
      "tags@cs": "{1}",
    });
  });

  it("keeps another employee and a custom date as they are", () => {
    expect(
      serializeFilter(
        { sales_id: 4, "created_at@gte": "2026-01-01T00:00:00.000Z" },
        { me: 7, now },
      ),
    ).toEqual({ sales_id: 4, "created_at@gte": "2026-01-01T00:00:00.000Z" });
  });

  it("gives today's values back for anybody", () => {
    const later = new Date(2026, 9, 3, 10);
    expect(
      deserializeFilter(
        {
          sales_id: ME,
          "created_at@gte": "$period:week",
          "closed_at@gte": MONTH_START,
          stage_id: 5,
        },
        { me: 12, now: later },
      ),
    ).toEqual({
      sales_id: 12,
      "created_at@gte": periodStart(7, later),
      "closed_at@gte": monthStart(later),
      stage_id: 5,
    });
  });

  it("round-trips", () => {
    const values = {
      sales_id: 7,
      "created_at@gte": periodStart(0, now),
      [WAITING_FILTER]: true,
    };
    const context = { me: 7, now };
    expect(
      deserializeFilter(serializeFilter(values, context), context),
    ).toEqual(values);
    expect(isSameFilter(serializeFilter(values, context), values, context)).toBe(
      true,
    );
    expect(isSameFilter({ sales_id: ME }, values, context)).toBe(false);
  });

  it("compares ignoring empty values and types of ids", () => {
    expect(
      isSameFilter({ stage_id: 5 }, { stage_id: "5", q: "" }, { now }),
    ).toBe(true);
  });
});

describe("presets", () => {
  it("has the six amoCRM presets", () => {
    expect(FILTER_PRESETS.map((preset) => preset.id)).toEqual([
      "mine",
      "no_task",
      "overdue",
      "waiting",
      "closed_month",
      "new_today",
    ]);
  });

  it("«Новые сегодня» starts at midnight", () => {
    const today = FILTER_PRESETS.find((preset) => preset.id === "new_today")!;
    expect(deserializeFilter(today.filter, { now })).toEqual({
      "created_at@gte": periodStart(0, now),
    });
  });

  it("«Мои сделки» without an identity filters nothing", () => {
    const mine = FILTER_PRESETS.find((preset) => preset.id === "mine")!;
    expect(deserializeFilter(mine.filter, { now })).toEqual({});
  });
});
