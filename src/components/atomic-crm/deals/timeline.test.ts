import { describe, expect, it } from "vitest";
import type { Call, DealEvent, DealNote, Task } from "../types";
import { buildTimeline } from "./timeline";

describe("buildTimeline", () => {
  it("merges notes, done tasks, calls and events, newest first", () => {
    const items = buildTimeline({
      notes: [{ id: 1, date: "2026-09-02T10:00:00Z" } as DealNote],
      tasks: [
        { id: 1, done_date: "2026-09-04T10:00:00Z" } as Task,
        { id: 2, done_date: null, due_date: "2026-09-10T10:00:00Z" } as Task,
      ],
      calls: [{ id: 1, called_at: "2026-09-03T10:00:00Z" } as Call],
      events: [{ id: 1, created_at: "2026-09-01T10:00:00Z" } as DealEvent],
    });
    expect(items.map((item) => item.key)).toEqual([
      "task-1",
      "call-1",
      "note-1",
      "event-1",
    ]);
  });
});
