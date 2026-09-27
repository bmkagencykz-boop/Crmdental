import {
  CheckCircle2,
  PhoneIncoming,
  PhoneOutgoing,
  StickyNote,
} from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { Fragment, useEffect, useRef } from "react";

import { MessageBubble } from "../../messages/MessageBubble";
import { useDealMessages } from "../../messages/useMessages";
import { formatDuration } from "../../patients/PatientCalls";
import { useGetSalesName } from "../../sales/useGetSalesName";
import type { Call, Deal, DealEvent, DealNote, Task } from "../../types";
import { DealEventContent } from "../DealEvents";
import { buildTimeline, type TimelineItem } from "../timeline";

const dayKey = (value: string) => new Date(value).toDateString();

export const dayLabel = (
  value: string,
  translate: (key: string) => string,
  now = new Date(),
) => {
  const date = new Date(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString())
    return translate("crm.common.today");
  if (date.toDateString() === yesterday.toDateString())
    return translate("crm.common.yesterday");
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
};

const time = (value: string) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The conversation with the patient and everything that happened to the
 * deal, oldest first like a chat (amoCRM): messages, notes, calls, finished
 * tasks, stage changes. Scrolls to the latest entry.
 */
export const DealFeed = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: notes = [] } = useGetList<DealNote>("deal_notes", {
    filter: { deal_id: deal.id },
    sort: { field: "date", order: "DESC" },
    pagination: { page: 1, perPage: 500 },
  });
  const { data: tasks = [] } = useGetList<Task>("tasks", {
    filter: { deal_id: deal.id },
    sort: { field: "due_date", order: "ASC" },
    pagination: { page: 1, perPage: 500 },
  });
  const { data: calls = [] } = useGetList<Call>("calls", {
    filter: { deal_id: deal.id },
    sort: { field: "called_at", order: "DESC" },
    pagination: { page: 1, perPage: 500 },
  });
  const { data: events = [] } = useGetList<DealEvent>("deal_events", {
    filter: { deal_id: deal.id },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 500 },
  });
  const { data: messages = [] } = useDealMessages(deal.id);
  const items = buildTimeline({
    notes,
    tasks,
    calls,
    events,
    messages,
  }).reverse();

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [items.length]);

  return (
    <ol
      className="flex flex-col gap-3 px-6 py-5"
      aria-label={translate("crm.deals.timeline.title")}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index === 0 ||
          dayKey(items[index - 1].date) !== dayKey(item.date) ? (
            <li
              className="sticky top-0 z-10 flex justify-center py-1"
              aria-hidden
            >
              <span className="rounded-md bg-card/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-card backdrop-blur">
                {dayLabel(item.date, translate)}
              </span>
            </li>
          ) : null}
          <li>
            <FeedItem item={item} />
          </li>
        </Fragment>
      ))}
      <div ref={bottom} />
    </ol>
  );
};

const FeedItem = ({ item }: { item: TimelineItem }) => {
  switch (item.kind) {
    case "message":
      return <MessageBubble message={item.message} />;
    case "event":
      return (
        <div className="flex justify-center">
          <div className="max-w-[85%] text-center text-xs text-muted-foreground [&_p]:inline [&_p+p]:ml-1">
            <DealEventContent event={item.event} />
          </div>
        </div>
      );
    case "note":
      return <NoteItem note={item.note} />;
    case "call":
      return <CallItem call={item.call} />;
    case "task":
      return <DoneTaskItem task={item.task} />;
  }
};

const Card = ({
  icon,
  meta,
  children,
  tone,
}: {
  icon: React.ReactNode;
  meta: string;
  children: React.ReactNode;
  tone?: string;
}) => (
  <div
    className={`mx-auto flex w-full max-w-[85%] gap-3 rounded-lg px-4 py-3 text-sm shadow-card ${tone ?? "bg-card"}`}
  >
    <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="text-[11px] text-muted-foreground">{meta}</p>
      <div className="whitespace-pre-line break-words">{children}</div>
    </div>
  </div>
);

const NoteItem = ({ note }: { note: DealNote }) => {
  const translate = useTranslate();
  const author = useGetSalesName(note.sales_id);
  return (
    <Card
      icon={<StickyNote className="size-4" />}
      meta={`${time(note.date)} · ${translate("crm.deals.page.note")}${author ? ` · ${author}` : ""}`}
      tone="bg-card border-l-4 border-brand-yellow"
    >
      {note.text}
    </Card>
  );
};

const CallItem = ({ call }: { call: Call }) => {
  const translate = useTranslate();
  const author = useGetSalesName(call.sales_id ?? undefined, {
    enabled: call.sales_id != null,
  });
  const Icon = call.direction === "out" ? PhoneOutgoing : PhoneIncoming;
  return (
    <Card
      icon={<Icon className="size-4" />}
      meta={`${time(call.called_at)} · ${translate(`crm.calls.direction.${call.direction}`)}${author ? ` · ${author}` : ""}`}
    >
      {formatDuration(call.duration_seconds)}
      {call.comment ? ` — ${call.comment}` : ""}
    </Card>
  );
};

const DoneTaskItem = ({ task }: { task: Task }) => {
  const translate = useTranslate();
  const author = useGetSalesName(task.sales_id, {
    enabled: task.sales_id != null,
  });
  return (
    <Card
      icon={<CheckCircle2 className="size-4 text-brand-lime" />}
      meta={`${time(task.done_date!)} · ${translate("crm.deals.timeline.task_done")}${author ? ` · ${author}` : ""}`}
    >
      <span className="font-medium">
        {translate(`crm.tasks.types.${task.type}`)}
      </span>{" "}
      {task.text}
    </Card>
  );
};
