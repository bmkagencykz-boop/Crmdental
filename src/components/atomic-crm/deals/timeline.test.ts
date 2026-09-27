import { describe, expect, it } from "vitest";
import type { Call, DealEvent, DealNote, Message, Task } from "../types";
import type { StageTriggerRun } from "../pipeline-automation/types";
import { buildTimeline } from "./timeline";

describe("buildTimeline", () => {
  it("merges messages, notes, done tasks, calls and events, newest first", () => {
    const items = buildTimeline({
      notes: [{ id: 1, date: "2026-09-02T10:00:00Z" } as DealNote],
      tasks: [
        { id: 1, done_date: "2026-09-04T10:00:00Z" } as Task,
        { id: 2, done_date: null, due_date: "2026-09-10T10:00:00Z" } as Task,
      ],
      calls: [{ id: 1, called_at: "2026-09-03T10:00:00Z" } as Call],
      events: [{ id: 1, created_at: "2026-09-01T10:00:00Z" } as DealEvent],
      messages: [{ id: 1, sent_at: "2026-09-05T10:00:00Z" } as Message],
    });
    expect(items.map((item) => item.key)).toEqual([
      "message-1",
      "task-1",
      "call-1",
      "note-1",
      "event-1",
    ]);
  });

  it("adds the runs of the digital pipeline", () => {
    const items = buildTimeline({
      events: [{ id: 1, created_at: "2026-09-01T10:00:00Z" } as DealEvent],
      automations: [
        {
          id: 7,
          created_at: "2026-09-02T10:00:00Z",
        } as StageTriggerRun,
      ],
    });
    expect(items.map((item) => item.key)).toEqual(["automation-7", "event-1"]);
  });
});
