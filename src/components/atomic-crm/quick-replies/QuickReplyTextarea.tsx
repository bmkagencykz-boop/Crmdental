import { User } from "lucide-react";
import { useTranslate, type Identifier } from "ra-core";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  filterQuickReplies,
  findSlashQuery,
  insertQuickReply,
  renderQuickReply,
} from "./renderQuickReply";
import { useQuickReplies, useQuickReplyContext } from "./useQuickReplies";

/** The part of the text the chosen reply replaces */
type Trigger = { start: number; end: number; query: string };

/**
 * Chat input with quick replies: "/" at the start or after a space (or the
 * lightning button) opens the list, filtered by what follows the "/". ↑↓
 * move, Enter or Tab insert the reply with its variables filled from the
 * deal, Esc closes. Otherwise Enter submits, Shift+Enter breaks the line.
 */
export const QuickReplyTextarea = ({
  dealId,
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
}: {
  dealId: Identifier;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
}) => {
  const translate = useTranslate();
  const listId = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { data: replies } = useQuickReplies();
  const context = useQuickReplyContext(dealId);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  // Esc on a "/": do not reopen the list until another "/" is typed
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(
    () => (trigger ? filterQuickReplies(replies, trigger.query) : []),
    [replies, trigger],
  );
  const open = trigger != null;
  const activeReply = matches[Math.min(active, matches.length - 1)];
  const optionId = (id: Identifier) => `${listId}-option-${id}`;

  useEffect(() => setActive(0), [trigger?.query, trigger?.start]);
  useEffect(() => {
    if (!activeReply) return;
    document
      .getElementById(optionId(activeReply.id))
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeReply?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const detect = (element: HTMLTextAreaElement) => {
    const caret = element.selectionStart ?? element.value.length;
    const found = findSlashQuery(element.value, caret);
    if (!found || found.start === dismissedAt) {
      setTrigger(null);
      if (!found) setDismissedAt(null);
      return;
    }
    setTrigger({ start: found.start, end: caret, query: found.query });
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event.target.value);
    detect(event.target);
  };

  const handleSelect = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    // Moving the caret away from the "/query" closes the list; the lightning
    // list (no "/") stays until something is typed
    if (trigger && trigger.end === trigger.start) return;
    detect(event.currentTarget);
  };

  const close = () => {
    if (trigger && trigger.end > trigger.start) setDismissedAt(trigger.start);
    setTrigger(null);
  };

  const choose = (index: number) => {
    const reply = matches[index];
    if (!trigger || !reply) return;
    const rendered = renderQuickReply(reply.text, context);
    const next = insertQuickReply(value, trigger.start, trigger.end, rendered);
    onChange(next.text);
    setTrigger(null);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (matches.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive(
            (current) =>
              (Math.min(current, matches.length - 1) + step + matches.length) %
              matches.length,
          );
          return;
        }
        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
          event.preventDefault();
          choose(Math.min(active, matches.length - 1));
          return;
        }
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  const openFromButton = () => {
    const element = textarea.current;
    if (open) {
      close();
      return;
    }
    const caret = element?.selectionStart ?? value.length;
    setTrigger({ start: caret, end: caret, query: "" });
    element?.focus();
  };

  return (
    <div className="relative flex-1">
      {open ? (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              {trigger.query
                ? translate("quick_replies.picker.searching", {
                    query: trigger.query,
                  })
                : translate("quick_replies.picker.title")}
            </span>
            <span aria-hidden="true">
              {translate("quick_replies.picker.keys")}
            </span>
          </div>
          {matches.length ? (
            <ul
              id={listId}
              role="listbox"
              aria-label={translate("quick_replies.picker.title")}
              className="max-h-64 overflow-y-auto py-1"
            >
              {matches.map((reply, index) => {
                const selected = reply.id === activeReply?.id;
                return (
                  <li
                    key={reply.id}
                    id={optionId(reply.id)}
                    role="option"
                    aria-selected={selected}
                    // Keep the focus (and the caret) in the input
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 px-3 py-2 text-sm",
                      selected && "bg-accent text-accent-foreground",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{reply.title}</span>
                      {reply.shortcut ? (
                        <span className="text-xs text-muted-foreground">
                          /{reply.shortcut}
                        </span>
                      ) : null}
                      {reply.sales_id != null ? (
                        <User
                          className="size-3 text-muted-foreground"
                          aria-label={translate("quick_replies.personal")}
                        />
                      ) : null}
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {renderQuickReply(reply.text, context)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {replies.length
                ? translate("quick_replies.picker.no_match")
                : translate("quick_replies.picker.empty")}
            </p>
          )}
          <div className="border-t border-border px-3 py-1.5 text-xs">
            <Link
              to="/settings?section=quick_replies"
              onMouseDown={(event) => event.preventDefault()}
              className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {translate("quick_replies.picker.manage")}
            </Link>
          </div>
        </div>
      ) : null}
      <div className="flex items-end gap-1">
        <Textarea
          ref={textarea}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onBlur={() => setTrigger(null)}
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-controls={open && matches.length ? listId : undefined}
          aria-activedescendant={
            open && activeReply ? optionId(activeReply.id) : undefined
          }
          aria-describedby={`${listId}-hint`}
          className="min-h-12 resize-none"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0"
          // Keep the caret where the reply goes
          onMouseDown={(event) => event.preventDefault()}
          onClick={openFromButton}
          aria-label={translate("quick_replies.picker.open")}
          aria-expanded={open}
          aria-haspopup="listbox"
          title={translate("quick_replies.picker.open")}
        ></Button>
      </div>
      <span id={`${listId}-hint`} className="sr-only">
        {translate("quick_replies.picker.hint")}
      </span>
    </div>
  );
};
