import {
  ArrowDown,
  ArrowUp,
  Building2,
  Lock,
  Plus,
  Trash2,
  User,
} from "lucide-react";
import { useTranslate } from "ra-core";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  moveItem,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import type { QuickReply } from "../types";
import { normalizeShortcut, QUICK_REPLY_VARIABLES } from "./renderQuickReply";
import { useCurrentSale, useQuickReplies } from "./useQuickReplies";

type Scope = "clinic" | "personal";

/**
 * Settings → Quick replies: the clinic-wide replies (owner and head edit
 * them) and the personal replies of the current employee.
 */
export const QuickRepliesEditor = () => {
  const translate = useTranslate();
  const sale = useCurrentSale();
  const canEditClinic = sale?.role === "owner" || sale?.role === "head";
  const { data: replies } = useQuickReplies();
  const clinic = replies.filter((reply) => reply.sales_id == null);
  const personal = replies.filter((reply) => reply.sales_id != null);

  return (
    <div className="flex flex-col gap-6">
      <VariablesHint />
      <ReplyGroup
        title={translate("quick_replies.clinic_replies")}
        hint={translate(
          canEditClinic
            ? "quick_replies.clinic_hint"
            : "quick_replies.clinic_hint_readonly",
        )}
        replies={clinic}
        editable={canEditClinic}
      />
      <ReplyGroup
        title={translate("quick_replies.personal_replies")}
        hint={translate("quick_replies.personal_hint")}
        replies={personal}
        editable
      />
      {sale ? (
        <NewReply
          canEditClinic={canEditClinic}
          salesId={sale.id}
          positions={{
            clinic: (clinic.at(-1)?.position ?? -1) + 1,
            personal: (personal.at(-1)?.position ?? -1) + 1,
          }}
        />
      ) : null}
    </div>
  );
};

const VariablesHint = ({ onInsert }: { onInsert?: (name: string) => void }) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-2 rounded-md bg-card p-4 text-sm">
      <span className="font-medium">
        {translate("quick_replies.variables.title")}
      </span>
      <div className="flex flex-wrap gap-2">
        {QUICK_REPLY_VARIABLES.map((name) =>
          onInsert ? (
            <button
              key={name}
              type="button"
              onClick={() => onInsert(name)}
              className="rounded-md border border-border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
              title={translate(`quick_replies.variables.${name}`)}
              aria-label={translate("quick_replies.variables.insert", {
                variable: `{${name}}`,
              })}
            >
              {`{${name}}`}
            </button>
          ) : (
            <Badge
              key={name}
              variant="outline"
              title={translate(`quick_replies.variables.${name}`)}
            >
              {`{${name}}`}
              <span className="font-normal text-muted-foreground">
                {translate(`quick_replies.variables.${name}`)}
              </span>
            </Badge>
          ),
        )}
      </div>
      {onInsert ? null : (
        <span className="text-xs text-muted-foreground">
          {translate("quick_replies.variables.hint")}
        </span>
      )}
    </div>
  );
};

const ReplyGroup = ({
  title,
  hint,
  replies,
  editable,
}: {
  title: string;
  hint: string;
  replies: QuickReply[];
  editable: boolean;
}) => {
  const translate = useTranslate();
  const { update } = useDictionaryMutations("quick_replies");
  const move = (reply: QuickReply, direction: -1 | 1) =>
    moveItem(replies, reply.id, direction).forEach(([record, position]) =>
      update(record, { position }),
    );
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {replies.length ? (
        <ul className="flex flex-col gap-2" aria-label={title}>
          {replies.map((reply, index) => (
            <ReplyRow
              key={reply.id}
              reply={reply}
              editable={editable}
              isFirst={index === 0}
              isLast={index === replies.length - 1}
              onMove={(direction) => move(reply, direction)}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {translate("quick_replies.none")}
        </p>
      )}
    </section>
  );
};

const ScopeBadge = ({ personal }: { personal: boolean }) => {
  const translate = useTranslate();
  return (
    <Badge variant={personal ? "secondary" : "outline"}>
      {personal ? <User /> : <Building2 />}
      {translate(personal ? "quick_replies.personal" : "quick_replies.clinic")}
    </Badge>
  );
};

const ReplyRow = ({
  reply,
  editable,
  isFirst,
  isLast,
  onMove,
}: {
  reply: QuickReply;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
}) => {
  const translate = useTranslate();
  const { update, remove } = useDictionaryMutations("quick_replies");
  const personal = reply.sales_id != null;

  if (!editable) {
    return (
      <li className="flex flex-col gap-1 rounded-md bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{reply.title}</span>
          {reply.shortcut ? (
            <span className="text-sm text-muted-foreground">
              /{reply.shortcut}
            </span>
          ) : null}
          <ScopeBadge personal={personal} />
          <Lock
            className="ml-auto size-4 text-muted-foreground"
            aria-label={translate("quick_replies.readonly")}
          />
        </div>
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {reply.text}
        </p>
      </li>
    );
  }

  return (
    <li className="flex gap-2 rounded-md bg-card p-3">
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isFirst}
          onClick={() => onMove(-1)}
          aria-label={translate("crm.settings.move_up")}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isLast}
          onClick={() => onMove(1)}
          aria-label={translate("crm.settings.move_down")}
        >
          <ArrowDown className="size-4" />
        </Button>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            key={`${reply.id}-title-${reply.title}`}
            defaultValue={reply.title}
            aria-label={translate("quick_replies.fields.title")}
            className="min-w-48 flex-1"
            onBlur={(event) => {
              const title = event.target.value.trim();
              if (title && title !== reply.title) update(reply, { title });
            }}
          />
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground" aria-hidden="true">
              /
            </span>
            <Input
              key={`${reply.id}-shortcut-${reply.shortcut ?? ""}`}
              defaultValue={reply.shortcut ?? ""}
              aria-label={translate("quick_replies.fields.shortcut")}
              placeholder={translate("quick_replies.fields.shortcut")}
              className="w-36"
              onBlur={(event) => {
                const shortcut = normalizeShortcut(event.target.value);
                if (shortcut !== (reply.shortcut ?? null)) {
                  update(reply, { shortcut });
                }
              }}
            />
          </div>
          <ScopeBadge personal={personal} />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => remove(reply)}
            aria-label={translate("ra.action.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
        <Textarea
          key={`${reply.id}-text-${reply.text}`}
          defaultValue={reply.text}
          rows={2}
          aria-label={translate("quick_replies.fields.text")}
          className="min-h-12"
          onBlur={(event) => {
            const text = event.target.value.trim();
            if (text && text !== reply.text) update(reply, { text });
          }}
        />
      </div>
    </li>
  );
};

const NewReply = ({
  canEditClinic,
  salesId,
  positions,
}: {
  canEditClinic: boolean;
  salesId: QuickReply["id"];
  positions: Record<Scope, number>;
}) => {
  const translate = useTranslate();
  const { create } = useDictionaryMutations("quick_replies");
  const [title, setTitle] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [text, setText] = useState("");
  const [scope, setScope] = useState<Scope>(
    canEditClinic ? "clinic" : "personal",
  );
  const textRef = useRef<HTMLTextAreaElement>(null);
  const effectiveScope: Scope = canEditClinic ? scope : "personal";

  const insertVariable = (name: string) => {
    const element = textRef.current;
    const token = `{${name}}`;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const add = () => {
    if (!title.trim() || !text.trim()) return;
    create({
      title: title.trim(),
      text: text.trim(),
      shortcut: normalizeShortcut(shortcut),
      sales_id: effectiveScope === "personal" ? salesId : null,
      position: positions[effectiveScope],
    });
    setTitle("");
    setShortcut("");
    setText("");
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-border p-4"
      aria-label={translate("quick_replies.new")}
    >
      <h3 className="font-semibold">{translate("quick_replies.new")}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={translate("quick_replies.fields.title")}
          aria-label={translate("quick_replies.fields.title")}
          className="min-w-48 flex-1"
        />
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground" aria-hidden="true">
            /
          </span>
          <Input
            value={shortcut}
            onChange={(event) => setShortcut(event.target.value)}
            placeholder={translate("quick_replies.fields.shortcut")}
            aria-label={translate("quick_replies.fields.shortcut")}
            className="w-36"
          />
        </div>
        {canEditClinic ? (
          <div
            className="flex rounded-md border border-border p-0.5 text-sm"
            role="radiogroup"
            aria-label={translate("quick_replies.fields.scope")}
          >
            {(["clinic", "personal"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={scope === value}
                onClick={() => setScope(value)}
                className={cn(
                  "rounded-md px-3 py-1 font-medium transition-colors",
                  scope === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {translate(`quick_replies.${value}`)}
              </button>
            ))}
          </div>
        ) : (
          <ScopeBadge personal />
        )}
      </div>
      <Textarea
        ref={textRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder={translate("quick_replies.fields.text_placeholder")}
        aria-label={translate("quick_replies.fields.text")}
      />
      <VariablesHint onInsert={insertVariable} />
      <Button
        className="w-fit"
        onClick={add}
        disabled={!title.trim() || !text.trim()}
      >
        <Plus className="size-4" />
        {translate("quick_replies.add")}
      </Button>
    </section>
  );
};
