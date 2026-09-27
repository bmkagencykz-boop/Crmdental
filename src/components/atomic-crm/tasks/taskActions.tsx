import { useQueryClient } from "@tanstack/react-query";
import {
  useLocaleState,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

import type { Task } from "../types";
import { quickReschedule, type QuickReschedule } from "./calendarLayout";
import { useClinicTimeZone } from "./useClinicTimeZone";

/** "28 сент., 10:00" in the clinic time zone */
export const formatTaskTime = (
  value: string,
  timeZone: string,
  locale = "ru",
) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));

/** 30 → "30 мин", 90 → "1 ч 30 мин" */
export const formatTaskDuration = (
  minutes: number,
  translate: (key: string, options?: any) => string,
) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [
    hours ? translate("task_calendar.hours", { count: hours }) : null,
    rest ? translate("task_calendar.minutes", { count: rest }) : null,
  ]
    .filter(Boolean)
    .join(" ");
};

/**
 * Completing (with a result), reopening and rescheduling a task. Lists of
 * tasks are refetched after a reschedule: the task changes place.
 */
export const useTaskActions = (task: Task) => {
  const [update, { isPending }] = useUpdate<Task>();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const timeZone = useClinicTimeZone();
  const [locale] = useLocaleState();

  const save = (data: Partial<Task>, onSuccess?: () => void) =>
    update("tasks", { id: task.id, data, previousData: task }, { onSuccess });

  const complete = (result?: string) =>
    save(
      { done_date: new Date().toISOString(), result: result?.trim() || null },
      () => notify("task_calendar.completed", { type: "info" }),
    );
  const reopen = () => save({ done_date: null });
  const reschedule = (due: string) =>
    save({ due_date: due }, () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", "getList"] });
      notify("task_calendar.rescheduled", {
        type: "info",
        messageArgs: { date: formatTaskTime(due, timeZone, locale) },
      });
    });
  const rescheduleBy = (kind: QuickReschedule) =>
    reschedule(quickReschedule(kind, task.due_date, timeZone));

  return { complete, reopen, reschedule, rescheduleBy, isPending, timeZone };
};

/** Field of the result of a task, completed on submit (Enter) */
export const TaskResultForm = ({
  onComplete,
  disabled,
}: {
  onComplete: (result: string) => void;
  disabled?: boolean;
}) => {
  const translate = useTranslate();
  const id = useId();
  const [result, setResult] = useState("");
  const submit = () => {
    onComplete(result);
    setResult("");
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {translate("task_calendar.result")}
      </Label>
      <Textarea
        id={id}
        autoFocus
        rows={2}
        value={result}
        onChange={(event) => setResult(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={translate("task_calendar.result_placeholder")}
        maxLength={2000}
        className="min-h-14 resize-none text-sm"
      />
      <Button type="submit" size="sm" disabled={disabled} className="self-end">
        {translate("task_calendar.complete")}
      </Button>
    </form>
  );
};

/**
 * Done checkbox of a task (amoCRM): checking it asks for the result first,
 * unchecking reopens the task.
 */
export const TaskCheckbox = ({
  task,
  id,
  className,
}: {
  task: Task;
  id?: Identifier;
  className?: string;
}) => {
  const translate = useTranslate();
  const { complete, reopen, isPending } = useTaskActions(task);
  const [open, setOpen] = useState(false);
  const label = translate("task_calendar.done");

  if (task.done_date) {
    return (
      <Checkbox
        id={id != null ? String(id) : undefined}
        checked
        onCheckedChange={reopen}
        disabled={isPending}
        className={className}
        aria-label={label}
      />
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Checkbox
          id={id != null ? String(id) : undefined}
          checked={false}
          disabled={isPending}
          className={className}
          aria-label={label}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <TaskResultForm
          disabled={isPending}
          onComplete={(result) => {
            complete(result);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
};
