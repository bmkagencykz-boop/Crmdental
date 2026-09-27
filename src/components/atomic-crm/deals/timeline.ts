import type { StageTriggerRun } from "../pipeline-automation/types";
import type {
  Call,
  DealEvent,
  DealFile,
  DealNote,
  Message,
  Task,
} from "../types";

export type TimelineItem =
  | { kind: "note"; date: string; key: string; note: DealNote }
  | { kind: "task"; date: string; key: string; task: Task }
  | { kind: "call"; date: string; key: string; call: Call }
  | { kind: "event"; date: string; key: string; event: DealEvent }
  | { kind: "message"; date: string; key: string; message: Message }
  | { kind: "file"; date: string; key: string; file: DealFile }
  | { kind: "automation"; date: string; key: string; run: StageTriggerRun };

/**
 * One feed for the deal card (spec §4.2): messages, notes, completed tasks,
 * calls, the deal log, the files uploaded on the «Файлы» tab (files of the
 * chat are in their message) and what the digital pipeline did to the deal,
 * newest first. Open tasks are shown apart, above the feed.
 */
export const buildTimeline = ({
  notes = [],
  tasks = [],
  calls = [],
  events = [],
  messages = [],
  files = [],
  automations = [],
}: {
  notes?: DealNote[];
  tasks?: Task[];
  calls?: Call[];
  events?: DealEvent[];
  messages?: Message[];
  files?: DealFile[];
  automations?: StageTriggerRun[];
}): TimelineItem[] =>
  [
    ...messages.map(
      (message): TimelineItem => ({
        kind: "message",
        date: message.sent_at,
        key: `message-${message.id}`,
        message,
      }),
    ),
    ...notes.map(
      (note): TimelineItem => ({
        kind: "note",
        date: note.date,
        key: `note-${note.id}`,
        note,
      }),
    ),
    ...tasks
      .filter((task) => task.done_date)
      .map(
        (task): TimelineItem => ({
          kind: "task",
          date: task.done_date as string,
          key: `task-${task.id}`,
          task,
        }),
      ),
    ...calls.map(
      (call): TimelineItem => ({
        kind: "call",
        date: call.called_at,
        key: `call-${call.id}`,
        call,
      }),
    ),
    ...events.map(
      (event): TimelineItem => ({
        kind: "event",
        date: event.created_at,
        key: `event-${event.id}`,
        event,
      }),
    ),
    ...files
      .filter((file) => file.message_id == null)
      .map(
        (file): TimelineItem => ({
          kind: "file",
          date: file.created_at,
          key: `file-${file.id}`,
          file,
        }),
      ),
    ...automations.map(
      (run): TimelineItem => ({
        kind: "automation",
        date: run.created_at,
        key: `automation-${run.id}`,
        run,
      }),
    ),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
