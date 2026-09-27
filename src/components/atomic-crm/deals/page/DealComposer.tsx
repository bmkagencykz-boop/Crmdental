import { AlertTriangle } from "lucide-react";
import {
  useCreate,
  useGetIdentity,
  useGetList,
  useNotify,
  useTranslate,
} from "ra-core";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { MessageComposer } from "../../messages/MessageComposer";
import { patientDisplayName } from "../../patients/parsePatientText";
import { CallForm } from "../../patients/PatientCalls";
import { Task } from "../../tasks/Task";
import { TASK_TYPES } from "../../tasks/taskTypes";
import type { Deal, Task as TaskRecord, TaskType } from "../../types";

export type ComposerMode = "chat" | "note" | "task" | "call";
const MODES: ComposerMode[] = ["chat", "note", "task", "call"];

const tomorrowMorning = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T10:00`;
};

/**
 * Bottom of the deal page (amoCRM): the open tasks, a warning when there is
 * none, and one input for a message, a note, a task or a call.
 */
export const DealComposer = ({
  deal,
  mode,
  setMode,
}: {
  deal: Deal;
  mode: ComposerMode;
  setMode: (mode: ComposerMode) => void;
}) => {
  const translate = useTranslate();
  const { data: openTasks = [] } = useGetList<TaskRecord>("tasks", {
    filter: { deal_id: deal.id, "done_date@is": null },
    sort: { field: "due_date", order: "ASC" },
    pagination: { page: 1, perPage: 50 },
  });
  const refreshFeed = useRefreshFeed();
  const patient = patientDisplayName({
    last_name: deal.patient_last_name,
    first_name: deal.patient_first_name,
  });

  return (
    <div className="flex flex-col gap-3 border-t border-border px-6 py-4">
      {openTasks.length ? (
        <div
          className="flex max-h-36 flex-col gap-2 overflow-y-auto rounded-2xl bg-card px-4 py-3"
          aria-label={translate("crm.deals.timeline.next_steps")}
        >
          {openTasks.map((task) => (
            <Task key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl bg-brand-yellow/30 px-4 py-2.5 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-[#b9801a]" />
          <span>{translate("crm.deals.page.no_task")}</span>
          <button
            type="button"
            onClick={() => setMode("task")}
            className="font-semibold text-brand-link underline"
          >
            {translate("crm.deals.page.add_task")}
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-card p-3 shadow-card">
        <div
          className="mb-2 flex flex-wrap items-center gap-1 text-sm"
          role="tablist"
        >
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded-full px-3 py-1 font-semibold transition-colors",
                mode === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {translate(`crm.deals.page.modes.${value}`)}
            </button>
          ))}
          {mode === "chat" && patient ? (
            <span className="ml-1 text-muted-foreground">
              {translate("crm.deals.page.chat_with", { name: patient })}
            </span>
          ) : null}
        </div>
        {mode === "chat" ? <MessageComposer dealId={deal.id} /> : null}
        {mode === "note" ? <NoteForm deal={deal} /> : null}
        {mode === "task" ? (
          <TaskForm deal={deal} onDone={() => setMode("chat")} />
        ) : null}
        {mode === "call" ? (
          <CallForm
            patientId={deal.patient_id}
            dealId={deal.id}
            onAdded={refreshFeed}
          />
        ) : null}
      </div>
    </div>
  );
};

const useRefreshFeed = () => {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["deal_notes", "tasks", "calls", "deals"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
};

const NoteForm = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const [create, { isPending }] = useCreate();
  const refreshFeed = useRefreshFeed();
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    create(
      "deal_notes",
      {
        data: {
          deal_id: deal.id,
          text: text.trim(),
          date: new Date().toISOString(),
          sales_id: identity?.id,
        },
      },
      {
        onSuccess: () => {
          setText("");
          refreshFeed();
          notify("resources.notes.added", { type: "info" });
        },
      },
    );
  };
  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        placeholder={translate("crm.deals.page.note_placeholder")}
        aria-label={translate("crm.deals.page.note_placeholder")}
        className="min-h-12 resize-none"
      />
      <Button
        onClick={add}
        disabled={!text.trim() || isPending}
        className="shrink-0"
      >
        {translate("crm.deals.page.save_note")}
      </Button>
    </div>
  );
};

const TaskForm = ({ deal, onDone }: { deal: Deal; onDone: () => void }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { identity } = useGetIdentity();
  const [create, { isPending }] = useCreate();
  const refreshFeed = useRefreshFeed();
  const [type, setType] = useState<TaskType>("call");
  const [text, setText] = useState("");
  const [due, setDue] = useState(tomorrowMorning());
  const add = () => {
    if (!text.trim() || !due) return;
    create(
      "tasks",
      {
        data: {
          deal_id: deal.id,
          type,
          text: text.trim(),
          due_date: new Date(due).toISOString(),
          sales_id: deal.sales_id ?? identity?.id,
        },
      },
      {
        onSuccess: () => {
          setText("");
          refreshFeed();
          notify("resources.tasks.added", { type: "info" });
          onDone();
        },
      },
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={type}
        onChange={(event) => setType(event.target.value as TaskType)}
        aria-label={translate("resources.tasks.fields.type")}
        className="soft h-10 rounded-full border-0 px-3 text-sm"
      >
        {TASK_TYPES.map((value) => (
          <option key={value} value={value}>
            {translate(`crm.tasks.types.${value}`)}
          </option>
        ))}
      </select>
      <Input
        type="datetime-local"
        value={due}
        onChange={(event) => setDue(event.target.value)}
        aria-label={translate("resources.tasks.fields.due_date")}
        className="w-52"
      />
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && add()}
        placeholder={translate("crm.deals.page.task_placeholder")}
        aria-label={translate("crm.deals.page.task_placeholder")}
        className="min-w-48 flex-1"
      />
      <Button onClick={add} disabled={!text.trim() || isPending}>
        {translate("crm.deals.page.save_task")}
      </Button>
    </div>
  );
};
