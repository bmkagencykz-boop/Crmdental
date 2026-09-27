import {
  CheckCircle2,
  History,
  MessageCircle,
  PhoneCall,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { ListBase, useGetList, useListContext, useTranslate } from "ra-core";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

import { Note } from "../notes/Note";
import { NoteCreate } from "../notes/NoteCreate";
import { MessageBubble } from "../messages/MessageBubble";
import { MessageComposer } from "../messages/MessageComposer";
import { useDealMessages, useMarkDealRead } from "../messages/useMessages";
import { CallForm, CallRow } from "../patients/PatientCalls";
import { useGetSalesName } from "../sales/useGetSalesName";
import { AddTask } from "../tasks/AddTask";
import { Task } from "../tasks/Task";
import type {
  Call,
  Deal,
  DealEvent,
  DealNote,
  Task as TaskRecord,
} from "../types";
import { DealEventContent } from "./DealEvents";
import { buildTimeline, type TimelineItem } from "./timeline";

/**
 * Right side of the deal card (spec §4.2): open tasks on top (a deal must
 * always have a next step), a composer, then one feed with notes, completed
 * tasks, calls, messages and the stage history.
 */
export const DealTimeline = ({ deal }: { deal: Deal }) => (
  <ListBase
    resource="deal_notes"
    filter={{ deal_id: deal.id }}
    sort={{ field: "date", order: "DESC" }}
    perPage={200}
    disableSyncWithLocation
    storeKey={false}
  >
    <DealTimelineContent deal={deal} />
  </ListBase>
);

const DealTimelineContent = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: notes = [] } = useListContext<DealNote>();
  const { data: tasks = [] } = useGetList<TaskRecord>("tasks", {
    filter: { deal_id: deal.id },
    sort: { field: "due_date", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });
  const { data: calls = [], refetch: refetchCalls } = useGetList<Call>(
    "calls",
    {
      filter: { deal_id: deal.id },
      sort: { field: "called_at", order: "DESC" },
      pagination: { page: 1, perPage: 200 },
    },
  );
  const { data: events = [] } = useGetList<DealEvent>("deal_events", {
    filter: { deal_id: deal.id },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 200 },
  });
  const { data: messages = [] } = useDealMessages(deal.id);
  useMarkDealRead(deal);
  const openTasks = tasks.filter((task) => !task.done_date);
  const items = buildTimeline({ notes, tasks, calls, events, messages });

  return (
    <div className="flex flex-col gap-5">
      <section
        className={cn(
          "rounded-2xl p-4",
          openTasks.length ? "bg-card" : "bg-brand-red/10",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {translate("crm.deals.timeline.next_steps")}
          </h3>
          <AddTask display="icon" />
        </div>
        {openTasks.length ? (
          <div className="flex flex-col gap-3">
            {openTasks.map((task) => (
              <Task key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium text-destructive">
            {translate("crm.deals.no_task_hint")}
          </p>
        )}
      </section>

      <Composer deal={deal} onCallAdded={refetchCalls} />

      <ol
        className="flex flex-col gap-4"
        aria-label={translate("crm.deals.timeline.title")}
      >
        {items.map((item) => (
          <TimelineRow key={item.key} item={item} />
        ))}
      </ol>
    </div>
  );
};

type ComposerMode = "message" | "note" | "call";

const Composer = ({
  deal,
  onCallAdded,
}: {
  deal: Deal;
  onCallAdded: () => void;
}) => {
  const translate = useTranslate();
  const [mode, setMode] = useState<ComposerMode>("message");
  return (
    <section className="rounded-2xl bg-card p-4">
      <div className="mb-3 flex gap-1" role="tablist">
        {(["message", "note", "call"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              mode === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {translate(`crm.deals.timeline.compose.${value}`)}
          </button>
        ))}
      </div>
      {mode === "message" ? <MessageComposer dealId={deal.id} /> : null}
      {mode === "note" ? <NoteCreate reference="deals" /> : null}
      {mode === "call" ? (
        <CallForm
          patientId={deal.patient_id}
          dealId={deal.id}
          onAdded={onCallAdded}
        />
      ) : null}
    </section>
  );
};

const ICONS: Record<TimelineItem["kind"], LucideIcon> = {
  note: StickyNote,
  task: CheckCircle2,
  call: PhoneCall,
  event: History,
  message: MessageCircle,
};

const TimelineRow = ({ item }: { item: TimelineItem }) => {
  const Icon = ICONS[item.kind];
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {item.kind === "note" ? <Note note={item.note} isLast /> : null}
        {item.kind === "task" ? <DoneTask task={item.task} /> : null}
        {item.kind === "call" ? <CallRow call={item.call} /> : null}
        {item.kind === "event" ? <DealEventContent event={item.event} /> : null}
        {item.kind === "message" ? (
          <MessageBubble message={item.message} />
        ) : null}
      </div>
    </li>
  );
};

const DoneTask = ({ task }: { task: TaskRecord }) => {
  const translate = useTranslate();
  const author = useGetSalesName(task.sales_id, {
    enabled: task.sales_id != null,
  });
  return (
    <Line
      meta={`${formatDateTime(task.done_date)}${author ? ` · ${author}` : ""}`}
    >
      {translate("crm.deals.timeline.task_done")}:{" "}
      <span className="font-medium">
        {translate(`crm.tasks.types.${task.type}`)}
      </span>{" "}
      {task.text}
    </Line>
  );
};

const Line = ({ meta, children }: { meta: string; children: ReactNode }) => (
  <div className="text-sm">
    <p className="text-xs text-muted-foreground">{meta}</p>
    <p>{children}</p>
  </div>
);

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
