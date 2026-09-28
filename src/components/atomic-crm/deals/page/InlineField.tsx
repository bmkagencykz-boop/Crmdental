import { Pencil } from "lucide-react";
import { useTranslate } from "ra-core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type Choice = { id: string | number; name: string };

type Editor =
  | { kind: "text" }
  | { kind: "textarea" }
  /** nullable: an empty value saves null instead of 0 */
  | { kind: "number"; nullable?: boolean }
  | { kind: "datetime" }
  /** A day, YYYY-MM-DD (custom fields) */
  | { kind: "date" }
  | { kind: "select"; choices: Choice[]; emptyLabel?: string }
  /** Several options (custom fields), saved with «Готово» */
  | { kind: "multiselect"; choices: Choice[] };

/**
 * A row of the deal card, amoCRM style: label on the left, value on the
 * right, edited in place on click and saved on blur / Enter / choice.
 */
export const InlineField = ({
  label,
  value,
  display,
  editor,
  onSave,
  readOnly,
}: {
  label: string;
  value: unknown;
  display?: ReactNode;
  editor?: Editor;
  onSave?: (value: unknown) => void;
  readOnly?: boolean;
}) => {
  const translate = useTranslate();
  const [editing, setEditing] = useState(false);
  const shown =
    display ?? (value == null || value === "" ? null : String(value));
  const editable = !readOnly && editor && onSave;

  return (
    <div className="group grid grid-cols-[9.5rem_1fr] items-start gap-3 py-0.5 text-[13.5px]">
      <span className="pt-1 text-muted-foreground">{label}</span>
      {editing && editable ? (
        <FieldEditor
          editor={editor}
          value={value}
          label={label}
          onDone={(next, changed) => {
            setEditing(false);
            if (changed) onSave(next);
          }}
        />
      ) : (
        <button
          type="button"
          disabled={!editable}
          onClick={() => setEditing(true)}
          aria-label={
            editable ? `${label}: ${translate("ra.action.edit")}` : label
          }
          className={cn(
            "flex min-h-7 min-w-0 items-center gap-2 rounded-md px-2 py-0.5 text-left",
            editable && "hover:bg-card",
          )}
        >
          <span
            className={cn(
              "min-w-0 break-words",
              shown == null && "text-muted-foreground/60",
            )}
          >
            {shown ?? "…"}
          </span>
          {editable ? (
            <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-50" />
          ) : null}
        </button>
      )}
    </div>
  );
};

const toLocalInput = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const FieldEditor = ({
  editor,
  value,
  label,
  onDone,
}: {
  editor: Editor;
  value: unknown;
  label: string;
  onDone: (value: unknown, changed: boolean) => void;
}) => {
  const translate = useTranslate();
  const ref = useRef<
    HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement
  >(null);
  useEffect(() => ref.current?.focus(), []);

  if (editor.kind === "multiselect") {
    return (
      <MultiselectEditor
        choices={editor.choices}
        value={value}
        label={label}
        onDone={onDone}
      />
    );
  }

  if (editor.kind === "select") {
    return (
      <select
        ref={ref}
        aria-label={label}
        defaultValue={value == null ? "" : String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          const next =
            raw === ""
              ? null
              : (editor.choices.find((c) => String(c.id) === raw)?.id ?? raw);
          onDone(next, String(next ?? "") !== String(value ?? ""));
        }}
        onBlur={() => onDone(value, false)}
        className="soft h-9 w-full rounded-md border-0 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{editor.emptyLabel ?? "—"}</option>
        {editor.choices.map((choice) => (
          <option key={choice.id} value={String(choice.id)}>
            {choice.name}
          </option>
        ))}
      </select>
    );
  }

  const initial =
    editor.kind === "datetime" ? toLocalInput(value) : String(value ?? "");
  const finish = (raw: string) => {
    let next: unknown = raw.trim() === "" ? null : raw.trim();
    if (editor.kind === "number") {
      next =
        raw.trim() === ""
          ? editor.nullable
            ? null
            : 0
          : Number(raw.replace(/\s/g, "").replace(",", "."));
      if (Number.isNaN(next)) return onDone(value, false);
    }
    if (editor.kind === "datetime" && next) {
      next = new Date(String(next)).toISOString();
    }
    const before =
      editor.kind === "datetime"
        ? value
          ? new Date(String(value)).toISOString()
          : null
        : value;
    onDone(next, String(next ?? "") !== String(before ?? ""));
  };

  if (editor.kind === "textarea") {
    return (
      <Textarea
        ref={ref}
        aria-label={label}
        defaultValue={initial}
        rows={3}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(value, false);
        }}
        placeholder={translate("crm.deals.page.empty_value")}
      />
    );
  }
  return (
    <Input
      ref={ref}
      aria-label={label}
      type={
        editor.kind === "datetime"
          ? "datetime-local"
          : editor.kind === "date"
            ? "date"
            : editor.kind === "number"
              ? "number"
              : "text"
      }
      defaultValue={initial}
      onBlur={(event) => finish(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") onDone(value, false);
      }}
      className="h-9"
    />
  );
};

/** Checkboxes of the options, saved with «Готово», cancelled with Escape */
const MultiselectEditor = ({
  choices,
  value,
  label,
  onDone,
}: {
  choices: Choice[];
  value: unknown;
  label: string;
  onDone: (value: unknown, changed: boolean) => void;
}) => {
  const translate = useTranslate();
  const initial = Array.isArray(value) ? value.map(String) : [];
  const [chosen, setChosen] = useState<string[]>(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.querySelector("input")?.focus(), []);
  const done = () => {
    const next = choices
      .map((choice) => String(choice.id))
      .filter((id) => chosen.includes(id));
    onDone(next.length ? next : null, next.join("|") !== initial.join("|"));
  };
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className="flex flex-col gap-1.5 rounded-md bg-card p-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone(value, false);
      }}
    >
      {choices.map((choice) => (
        <label key={choice.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={chosen.includes(String(choice.id))}
            onChange={(event) =>
              setChosen((current) =>
                event.target.checked
                  ? [...current, String(choice.id)]
                  : current.filter((id) => id !== String(choice.id)),
              )
            }
          />
          {choice.name}
        </label>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={done}
          className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
        >
          {translate("custom_fields.values.done")}
        </button>
        <button
          type="button"
          onClick={() => onDone(value, false)}
          className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          {translate("ra.action.cancel")}
        </button>
      </div>
    </div>
  );
};
