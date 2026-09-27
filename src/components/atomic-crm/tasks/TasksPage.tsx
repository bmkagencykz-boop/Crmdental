import {
  useCanAccess,
  useGetIdentity,
  useGetList,
  useStore,
  useTranslate,
} from "ra-core";
import { Fragment, useMemo } from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import type { Sale, Task as TaskRecord } from "../types";
import { AddTask } from "./AddTask";
import type { CalendarView } from "./calendarLayout";
import { Task } from "./Task";
import { TaskCalendar } from "./TaskCalendar";
import { isDueToday, isOverdue } from "./tasksPredicate";

export type TasksTab = "today" | "overdue" | "open" | "done";
const TABS: TasksTab[] = ["today", "overdue", "open", "done"];

/** The list of tabs, or the calendar of a day, a week or a month */
export type TasksView = "list" | CalendarView;
const VIEWS: TasksView[] = ["list", "day", "week", "month"];
export const TASKS_VIEW_STORE_KEY = "tasks.view";

/** Whose tasks: the current user, everybody, or one employee (by id) */
export type TasksOwner = "me" | "all" | string;

/** Tasks shown in a tab, open tasks sorted by due date */
export const filterTasksByTab = (
  tasks: TaskRecord[],
  tab: TasksTab,
): TaskRecord[] => {
  switch (tab) {
    case "today":
      return tasks.filter(
        (task) => !task.done_date && isDueToday(task.due_date),
      );
    case "overdue":
      return tasks.filter(
        (task) => !task.done_date && isOverdue(task.due_date),
      );
    case "open":
      return tasks.filter((task) => !task.done_date);
    case "done":
      return tasks.filter((task) => !!task.done_date);
  }
};

/**
 * Tasks screen (spec §4.4): today, overdue, all open and done tasks, for the
 * current user or, for the head, per employee.
 */
export const TasksPage = () => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const { canAccess: canSeeStaff } = useCanAccess({
    resource: "sales",
    action: "list",
  });
  const [tab, setTab] = useStore<TasksTab>("tasks.tab", "today");
  const [owner, setOwner] = useStore<TasksOwner>("tasks.owner", "me");
  const [view, setView] = useStore<TasksView>(TASKS_VIEW_STORE_KEY, "list");
  const isList = view === "list";

  const { data: sales = [] } = useGetList<Sale>(
    "sales",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "last_name", order: "ASC" },
      filter: { "disabled@neq": true },
    },
    { enabled: !!canSeeStaff },
  );

  const salesFilter =
    owner === "me"
      ? { sales_id: identity?.id }
      : owner === "all"
        ? {}
        : { sales_id: owner };
  const done = tab === "done";
  const { data: tasks = [], isPending } = useGetList<TaskRecord>(
    "tasks",
    {
      pagination: { page: 1, perPage: done ? 100 : 1000 },
      sort: done
        ? { field: "done_date", order: "DESC" }
        : { field: "due_date", order: "ASC" },
      filter: {
        ...salesFilter,
        ...(done ? { "done_date@not.is": null } : { "done_date@is": null }),
      },
    },
    { enabled: identity != null && isList },
  );
  const { data: openTasks = [] } = useGetList<TaskRecord>(
    "tasks",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "due_date", order: "ASC" },
      filter: { ...salesFilter, "done_date@is": null },
    },
    { enabled: identity != null },
  );

  const counts = useMemo(
    () => ({
      today: filterTasksByTab(openTasks, "today").length,
      overdue: filterTasksByTab(openTasks, "overdue").length,
      open: openTasks.length,
    }),
    [openTasks],
  );
  const shown = filterTasksByTab(tasks, tab);

  return (
    <div className={cn("flex flex-col gap-6", isList && "max-w-4xl")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
          role="group"
          aria-label={translate("task_calendar.view_label")}
        >
          {VIEWS.map((value) => (
            <Pill
              key={value}
              small
              active={view === value}
              onClick={() => setView(value)}
            >
              {translate(`task_calendar.views.${value}`)}
            </Pill>
          ))}
        </div>
        <AddTask selectDeal />
      </div>

      {isList ? (
        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((value) => (
            <Pill
              key={value}
              role="tab"
              active={tab === value}
              onClick={() => setTab(value)}
              alert={value === "overdue" && counts.overdue > 0}
            >
              {translate(`crm.tasks.tabs.${value}`)}
              {value !== "done" ? (
                <span className="ml-1.5 tabular-nums opacity-70">
                  {counts[value]}
                </span>
              ) : null}
            </Pill>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {translate("crm.tasks.owner")}
        </span>
        <Pill small active={owner === "me"} onClick={() => setOwner("me")}>
          {translate("crm.common.me")}
        </Pill>
        <Pill small active={owner === "all"} onClick={() => setOwner("all")}>
          {translate("crm.tasks.everyone")}
        </Pill>
        {sales
          .filter((sale) => sale.id !== identity?.id)
          .map((sale) => (
            <Pill
              key={sale.id}
              small
              active={owner === String(sale.id)}
              onClick={() => setOwner(String(sale.id))}
            >
              {sale.first_name} {sale.last_name}
            </Pill>
          ))}
      </div>

      {!isList ? (
        <TaskCalendar view={view} setView={setView} salesFilter={salesFilter} />
      ) : null}

      {isList ? (
        <section className="glass rounded-lg p-6">
          {isPending ? null : shown.length ? (
            <div className="flex flex-col gap-4">
              {shown.map((task, index) => (
                <Fragment key={task.id}>
                  <Task task={task} showDeal showResponsible={owner !== "me"} />
                  {index < shown.length - 1 ? <Separator /> : null}
                </Fragment>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate(`crm.tasks.empty.${tab}`)}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
};

TasksPage.path = "/tasks";

const Pill = ({
  active,
  alert,
  small,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  active: boolean;
  alert?: boolean;
  small?: boolean;
}) => (
  <button
    type="button"
    aria-pressed={active}
    className={cn(
      "rounded-md font-semibold transition-all",
      small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
      active
        ? "bg-primary text-primary-foreground shadow-soft"
        : "soft text-foreground/80 hover:text-foreground",
      alert && !active && "text-brand-red",
      className,
    )}
    {...props}
  />
);
