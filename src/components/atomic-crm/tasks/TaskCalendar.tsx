import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useGetIdentity,
  useGetList,
  useGetOne,
  useLocaleState,
  useNotify,
  useRefresh,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { patientDisplayName } from "../patients/parsePatientText";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Deal, Task, TaskType } from "../types";
import { TaskCreateDialog } from "./AddTask";
import {
  blockBox,
  calendarRange,
  taskDuration,
  formatMinutes,
  GRID_END,
  GRID_START,
  keyToDate,
  layoutDay,
  minuteOfDay,
  MONTH_PREVIEW,
  moveToDay,
  moveToSlot,
  QUICK_RESCHEDULES,
  sameMonth,
  shiftAnchor,
  SLOT_COUNT,
  SLOT_MINUTES,
  slotAt,
  tasksByDay,
  taskStatus,
  todayKey,
  type CalendarView,
  type DayKey,
} from "./calendarLayout";
import {
  formatTaskDuration,
  formatTaskTime,
  TaskResultForm,
  useTaskActions,
} from "./taskActions";
import { TaskEdit } from "./TaskEdit";
import { TASK_TYPES } from "./taskTypes";
import { useClinicTimeZone } from "./useClinicTimeZone";

/** Height of a 30-minute row, px */
const SLOT_HEIGHT = 28;
/** Morning time of a task created from a day of the month */
const MONTH_CREATE_MINUTES = 10 * 60;
const DRAG_TYPE = "application/x-crm-task";

/** Color of each task type: theme tokens only (light and dark themes) */
const TYPE_CLASSES: Record<TaskType, string> = {
  call: "border-chart-1 bg-chart-1/15",
  message: "border-chart-5 bg-chart-5/20",
  meeting: "border-brand-yellow bg-brand-yellow/25",
  reminder: "border-chart-4 bg-chart-4/20",
  other: "border-muted-foreground/60 bg-muted",
};
const TYPE_DOTS: Record<TaskType, string> = {
  call: "bg-chart-1",
  message: "bg-chart-5",
  meeting: "bg-brand-yellow",
  reminder: "bg-chart-4",
  other: "bg-muted-foreground/60",
};

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

const intlLocale = (locale?: string) => (locale === "en" ? "en-GB" : "ru-RU");

/** «28 сентября», «пн» … of a day key */
const formatDay = (
  key: DayKey,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    ...options,
    timeZone: "UTC",
  }).format(keyToDate(key));

const rangeTitle = (
  view: CalendarView,
  days: DayKey[],
  anchor: DayKey,
  locale?: string,
) => {
  if (view === "day") {
    return formatDay(anchor, locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (view === "month") {
    return formatDay(anchor, locale, { month: "long", year: "numeric" });
  }
  const first = days[0];
  const last = days[days.length - 1];
  return `${formatDay(first, locale, { day: "numeric", month: "short" })} – ${formatDay(last, locale, { day: "numeric", month: "short", year: "numeric" })}`;
};

/**
 * Calendar of the tasks screen (amoCRM «Календарь задач»): a time grid of a
 * day or a week (8:00-21:00, 30-minute rows) or a month. Tasks are colored by
 * type, overdue ones red, done ones muted. Drag a task to reschedule it,
 * click an empty slot to create one, click a task for its details.
 */
export const TaskCalendar = ({
  view,
  setView,
  salesFilter,
}: {
  view: CalendarView;
  setView: (view: CalendarView) => void;
  salesFilter: Record<string, unknown>;
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const notify = useNotify();
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  const { identity } = useGetIdentity();
  const timeZone = useClinicTimeZone();
  const now = useNow();
  const today = todayKey(timeZone, now);
  const [anchor, setAnchor] = useState<DayKey>(today);
  const [createAt, setCreateAt] = useState<string | null>(null);

  const range = useMemo(
    () => calendarRange(view, anchor, timeZone),
    [view, anchor, timeZone],
  );
  const { data: tasks = [] } = useGetList<Task>(
    "tasks",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "due_date", order: "ASC" },
      filter: {
        ...salesFilter,
        "due_date@gte": range.start.toISOString(),
        "due_date@lt": range.end.toISOString(),
      },
    },
    { enabled: identity != null },
  );

  const [update] = useUpdate<Task>();
  const moveTask = (id: string, due: string) => {
    const task = tasks.find((item) => String(item.id) === id);
    if (!task || new Date(task.due_date).getTime() === new Date(due).getTime())
      return;
    update(
      "tasks",
      { id: task.id, data: { due_date: due }, previousData: task },
      {
        mutationMode: "optimistic",
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["tasks", "getList"] });
          notify("task_calendar.rescheduled", {
            type: "info",
            messageArgs: { date: formatTaskTime(due, timeZone, locale) },
          });
        },
      },
    );
  };

  const openDay = (day: DayKey) => {
    setAnchor(day);
    setView("day");
  };

  const calendarProps = {
    tasks,
    timeZone,
    now,
    today,
    locale,
    onCreate: setCreateAt,
    onMove: moveTask,
    onOpenDay: openDay,
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setAnchor(shiftAnchor(view, anchor, -1))}
          aria-label={translate("task_calendar.previous")}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setAnchor(today)}
        >
          {translate("task_calendar.today")}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setAnchor(shiftAnchor(view, anchor, 1))}
          aria-label={translate("task_calendar.next")}
        >
          <ChevronRight className="size-4" />
        </Button>
        <h2 className="ml-1 text-base font-semibold first-letter:uppercase">
          {rangeTitle(view, range.days, anchor, locale)}
        </h2>
        <ul
          className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
          aria-label={translate("task_calendar.legend")}
        >
          {TASK_TYPES.map((type) => (
            <li key={type} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", TYPE_DOTS[type])} />
              {translate(`crm.tasks.types.${type}`)}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-destructive" />
            {translate("task_calendar.overdue")}
          </li>
        </ul>
      </div>

      {view === "month" ? (
        <MonthGrid days={range.days} anchor={anchor} {...calendarProps} />
      ) : (
        <TimeGrid days={range.days} {...calendarProps} />
      )}
      <p className="text-xs text-muted-foreground">
        {translate("task_calendar.drag_hint")}
      </p>

      {createAt && identity ? (
        <TaskCreateDialog
          open
          selectDeal
          onClose={() => setCreateAt(null)}
          onSuccess={() => {
            setCreateAt(null);
            notify("resources.tasks.added");
            refresh();
          }}
          record={{
            due_date: createAt,
            sales_id:
              (salesFilter.sales_id as Identifier | undefined) ?? identity.id,
          }}
        />
      ) : null}
    </div>
  );
};

type GridProps = {
  days: DayKey[];
  tasks: Task[];
  timeZone: string;
  now: Date;
  today: DayKey;
  locale?: string;
  onCreate: (due: string) => void;
  onMove: (id: string, due: string) => void;
  onOpenDay: (day: DayKey) => void;
};

const readDrag = (event: React.DragEvent) => {
  try {
    return JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as {
      id: string;
      offset: number;
    };
  } catch {
    return null;
  }
};

const allowDrop = (event: React.DragEvent) => {
  if (event.dataTransfer.types.includes(DRAG_TYPE)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
};

const TimeGrid = ({
  days,
  tasks,
  timeZone,
  now,
  today,
  locale,
  onCreate,
  onMove,
  onOpenDay,
}: GridProps) => {
  const translate = useTranslate();
  const layouts = useMemo(
    () => days.map((day) => layoutDay(tasks, day, timeZone)),
    [days, tasks, timeZone],
  );
  const hasOutside = layouts.some((layout) => layout.outside.length > 0);
  const height = SLOT_COUNT * SLOT_HEIGHT;
  const nowMinute = minuteOfDay(now, timeZone);
  const columns = {
    gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))`,
  };

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div
        className={cn("grid", days.length > 1 && "min-w-[760px]")}
        style={columns}
      >
        <div className="border-b border-border" />
        {days.map((day) => (
          <div
            key={day}
            className="border-b border-l border-border px-2 py-1.5 text-xs"
          >
            <button
              type="button"
              onClick={() => onOpenDay(day)}
              className={cn(
                "rounded-md px-1.5 py-0.5 font-semibold first-letter:uppercase hover:bg-accent",
                day === today &&
                  "bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {formatDay(day, locale, {
                weekday: "short",
                day: "numeric",
                month: days.length === 1 ? "long" : undefined,
              })}
            </button>
          </div>
        ))}

        {hasOutside ? (
          <>
            <div className="border-b border-border px-1 py-1 text-[10px] leading-tight text-muted-foreground">
              {translate("task_calendar.outside_hours")}
            </div>
            {layouts.map((layout, index) => (
              <div
                key={days[index]}
                className="flex flex-col gap-0.5 border-b border-l border-border p-0.5"
              >
                {layout.outside.map((task) => (
                  <CalendarTask
                    key={task.id}
                    task={task}
                    timeZone={timeZone}
                    now={now}
                    locale={locale}
                    className="relative truncate whitespace-nowrap"
                  />
                ))}
              </div>
            ))}
          </>
        ) : null}

        <div className="relative" style={{ height }} aria-hidden>
          {Array.from({ length: SLOT_COUNT / 2 }, (_, index) => (
            <span
              key={index}
              className="absolute right-1.5 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: index * 2 * SLOT_HEIGHT + 2 }}
            >
              {formatMinutes(GRID_START + index * 60)}
            </span>
          ))}
        </div>
        {days.map((day, index) => (
          <div
            key={day}
            className="relative border-l border-border"
            style={{ height }}
            data-day={day}
            onDragOver={allowDrop}
            onDrop={(event) => {
              const drag = readDrag(event);
              if (!drag) return;
              event.preventDefault();
              const top = event.currentTarget.getBoundingClientRect().top;
              onMove(
                drag.id,
                moveToSlot(
                  day,
                  slotAt(
                    event.clientY - top - drag.offset + SLOT_HEIGHT / 2,
                    SLOT_HEIGHT,
                  ),
                  timeZone,
                ),
              );
            }}
          >
            {Array.from({ length: SLOT_COUNT }, (_, slot) => {
              const minutes = GRID_START + slot * SLOT_MINUTES;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => onCreate(moveToSlot(day, minutes, timeZone))}
                  className={cn(
                    "block w-full border-b border-border/70 transition-colors hover:bg-accent/70",
                    slot % 2 === 0 && "border-dashed border-border/40",
                  )}
                  style={{ height: SLOT_HEIGHT }}
                  aria-label={translate("task_calendar.new_task_at", {
                    time: `${formatDay(day, locale, { day: "numeric", month: "long" })} ${formatMinutes(minutes)}`,
                  })}
                />
              );
            })}
            {layouts[index].blocks.map((block) => {
              const box = blockBox(block);
              return (
                <CalendarTask
                  key={block.task.id}
                  task={block.task}
                  timeZone={timeZone}
                  now={now}
                  locale={locale}
                  className={cn(
                    "absolute",
                    box.height <= 1 && "truncate whitespace-nowrap",
                  )}
                  style={{
                    top: box.top * SLOT_HEIGHT + 1,
                    height: box.height * SLOT_HEIGHT - 2,
                    left: `calc(${box.left * 100}% + 2px)`,
                    width: `calc(${box.width * 100}% - 4px)`,
                  }}
                />
              );
            })}
            {day === today &&
            nowMinute >= GRID_START &&
            nowMinute < GRID_END ? (
              <div
                className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive"
                style={{
                  top: ((nowMinute - GRID_START) / SLOT_MINUTES) * SLOT_HEIGHT,
                }}
                title={translate("task_calendar.now")}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

const MonthGrid = ({
  days,
  anchor,
  tasks,
  timeZone,
  now,
  today,
  locale,
  onCreate,
  onMove,
  onOpenDay,
}: GridProps & { anchor: DayKey }) => {
  const translate = useTranslate();
  const byDay = useMemo(() => tasksByDay(tasks, timeZone), [tasks, timeZone]);
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <div className="grid min-w-[760px] grid-cols-7">
        {days.slice(0, 7).map((day) => (
          <div
            key={day}
            className="border-b border-border px-2 py-1.5 text-xs font-semibold first-letter:uppercase text-muted-foreground"
          >
            {formatDay(day, locale, { weekday: "short" })}
          </div>
        ))}
        {days.map((day, index) => {
          const dayTasks = byDay.get(day) ?? [];
          const label = formatDay(day, locale, {
            day: "numeric",
            month: "long",
          });
          return (
            <div
              key={day}
              data-day={day}
              className={cn(
                "flex min-h-28 flex-col gap-0.5 border-b border-border p-1",
                index % 7 !== 0 && "border-l",
                !sameMonth(day, anchor) && "bg-muted/40",
              )}
              onDragOver={allowDrop}
              onDrop={(event) => {
                const drag = readDrag(event);
                if (!drag) return;
                event.preventDefault();
                const task = tasks.find((item) => String(item.id) === drag.id);
                if (task)
                  onMove(drag.id, moveToDay(task.due_date, day, timeZone));
              }}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className={cn(
                    "rounded-md px-1.5 text-xs font-semibold tabular-nums hover:bg-accent",
                    day === today &&
                      "bg-primary text-primary-foreground hover:bg-primary",
                    !sameMonth(day, anchor) &&
                      day !== today &&
                      "text-muted-foreground",
                  )}
                  aria-label={label}
                >
                  {Number(day.slice(8))}
                </button>
                {dayTasks.length ? (
                  <span
                    className="rounded-md bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
                    title={translate("task_calendar.tasks_count", {
                      count: dayTasks.length,
                    })}
                  >
                    {dayTasks.length}
                  </span>
                ) : null}
              </div>
              {dayTasks.slice(0, MONTH_PREVIEW).map((task) => (
                <CalendarTask
                  key={task.id}
                  task={task}
                  timeZone={timeZone}
                  now={now}
                  locale={locale}
                  className="relative truncate whitespace-nowrap"
                />
              ))}
              {dayTasks.length > MONTH_PREVIEW ? (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="px-1 text-left text-[11px] text-muted-foreground hover:underline"
                >
                  {translate("task_calendar.more", {
                    count: dayTasks.length - MONTH_PREVIEW,
                  })}
                </button>
              ) : null}
              <button
                type="button"
                className="min-h-3 flex-1 rounded-md transition-colors hover:bg-accent/70"
                onClick={() =>
                  onCreate(moveToSlot(day, MONTH_CREATE_MINUTES, timeZone))
                }
                aria-label={translate("task_calendar.new_task_at", {
                  time: `${label} ${formatMinutes(MONTH_CREATE_MINUTES)}`,
                })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** A task of the calendar: a colored block, its details in a popover */
const CalendarTask = ({
  task,
  timeZone,
  now,
  locale,
  className,
  style,
}: {
  task: Task;
  timeZone: string;
  now: Date;
  locale?: string;
  className?: string;
  style?: CSSProperties;
}) => {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const status = taskStatus(task, now);
  const time = formatMinutes(minuteOfDay(task.due_date, timeZone));
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                DRAG_TYPE,
                JSON.stringify({
                  id: String(task.id),
                  offset: event.clientY - rect.top,
                }),
              );
            }}
            data-task-id={task.id}
            data-status={status}
            className={cn(
              "z-10 min-h-5 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-xs leading-tight text-foreground shadow-card transition-shadow hover:shadow-soft cursor-grab active:cursor-grabbing",
              TYPE_CLASSES[task.type] ?? TYPE_CLASSES.other,
              status === "overdue" &&
                "border-destructive bg-destructive text-primary-foreground",
              status === "done" && "opacity-50 line-through",
              className,
            )}
            style={style}
          >
            <span className="font-semibold tabular-nums">{time}</span>{" "}
            <span>{task.text}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-4" align="start">
          <TaskDetails
            task={task}
            timeZone={timeZone}
            locale={locale}
            status={status}
            onEdit={() => {
              setOpen(false);
              setEditing(true);
            }}
          />
        </PopoverContent>
      </Popover>
      <TaskEdit
        taskId={task.id}
        open={editing}
        close={() => setEditing(false)}
      />
    </>
  );
};

const TaskDetails = ({
  task,
  timeZone,
  locale,
  status,
  onEdit,
}: {
  task: Task;
  timeZone: string;
  locale?: string;
  status: ReturnType<typeof taskStatus>;
  onEdit: () => void;
}) => {
  const translate = useTranslate();
  const { complete, reopen, rescheduleBy, isPending } = useTaskActions(task);
  const responsible = useGetSalesName(task.sales_id, {
    enabled: task.sales_id != null,
  });
  const checkboxId = `calendar-task-done-${task.id}`;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn("size-2.5 rounded-sm", TYPE_DOTS[task.type])} />
        <span className="font-semibold">
          {translate(`crm.tasks.types.${task.type}`)}
        </span>
        {status !== "open" ? (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
              status === "overdue"
                ? "bg-destructive text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {translate(`task_calendar.${status}`)}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          onClick={onEdit}
        >
          {translate("task_calendar.edit")}
        </Button>
      </div>
      <p className="whitespace-pre-line break-words">{task.text}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">
          {translate("resources.tasks.fields.due_date")}
        </dt>
        <dd>
          {formatTaskTime(task.due_date, timeZone, locale)} ·{" "}
          {formatTaskDuration(taskDuration(task), translate)}
        </dd>
        <dt className="text-muted-foreground">
          {translate("task_calendar.deal")}
        </dt>
        <dd>
          <TaskDealLink dealId={task.deal_id} />
        </dd>
        <dt className="text-muted-foreground">
          {translate("task_calendar.responsible")}
        </dt>
        <dd>{responsible || "—"}</dd>
        {task.done_date && task.result ? (
          <>
            <dt className="text-muted-foreground">
              {translate("task_calendar.result")}
            </dt>
            <dd className="whitespace-pre-line break-words">{task.result}</dd>
          </>
        ) : null}
      </dl>
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={!!task.done_date}
          disabled={isPending}
          onCheckedChange={(checked) => (checked ? complete() : reopen())}
        />
        <Label htmlFor={checkboxId} className="text-sm font-normal">
          {translate("task_calendar.done")}
        </Label>
      </div>
      {!task.done_date ? (
        <TaskResultForm disabled={isPending} onComplete={complete} />
      ) : null}
      <div className="flex flex-wrap items-center gap-1 border-t border-border pt-3">
        <span className="mr-1 text-xs text-muted-foreground">
          {translate("task_calendar.reschedule.title")}:
        </span>
        {QUICK_RESCHEDULES.map((kind) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={isPending}
            onClick={() => rescheduleBy(kind)}
          >
            {translate(`task_calendar.reschedule.${kind}`)}
          </Button>
        ))}
      </div>
    </div>
  );
};

const TaskDealLink = ({ dealId }: { dealId: Identifier }) => {
  const { data: deal } = useGetOne<Deal>("deals", { id: dealId });
  if (!deal) return <span>…</span>;
  const patient = patientDisplayName({
    last_name: deal.patient_last_name,
    first_name: deal.patient_first_name,
  });
  return (
    <Link
      to={`/deals/${deal.id}/show`}
      className="text-brand-link hover:underline"
    >
      {[patient, deal.name].filter(Boolean).join(" · ")}
    </Link>
  );
};
