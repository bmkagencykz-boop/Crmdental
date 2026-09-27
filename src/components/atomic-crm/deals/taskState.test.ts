import { describe, expect, it } from "vitest";
import type { Deal } from "../types";
import { getDealTaskState } from "./taskState";

const now = new Date("2026-09-28T12:00:00Z");
const deal = (fields: Partial<Deal>) =>
  ({ stage_kind: "open", nb_open_tasks: 1, ...fields }) as Deal;

describe("getDealTaskState", () => {
  it("flags open deals without tasks", () => {
    expect(getDealTaskState(deal({ nb_open_tasks: 0 }), now)).toBe("no_task");
  });

  it("flags overdue tasks", () => {
    expect(
      getDealTaskState(deal({ next_task_due_at: "2026-09-28T11:00:00Z" }), now),
    ).toBe("overdue");
  });

  it("accepts deals with a future task", () => {
    expect(
      getDealTaskState(deal({ next_task_due_at: "2026-09-29T09:00:00Z" }), now),
    ).toBe("ok");
  });

  it("does not control closed deals", () => {
    expect(
      getDealTaskState(deal({ stage_kind: "won", nb_open_tasks: 0 }), now),
    ).toBe("closed");
    expect(
      getDealTaskState(deal({ stage_kind: "lost", nb_open_tasks: 0 }), now),
    ).toBe("closed");
  });
});
