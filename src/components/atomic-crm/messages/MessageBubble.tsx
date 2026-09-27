import { Check, CheckCheck, CircleAlert } from "lucide-react";
import { useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import { useGetSalesName } from "../sales/useGetSalesName";
import type { Message } from "../types";

export const formatMessageTime = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** A chat bubble: the patient on the left, the clinic on the right */
export const MessageBubble = ({ message }: { message: Message }) => {
  const translate = useTranslate();
  const author = useGetSalesName(message.sales_id ?? undefined, {
    enabled: message.sales_id != null,
  });
  const outgoing = message.direction === "out";
  return (
    <div className={cn("flex", outgoing ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-card",
          outgoing
            ? "rounded-br-md bg-[#dcebdd] text-[#1f2635] dark:bg-[#2c4a36] dark:text-foreground"
            : "rounded-bl-md bg-card",
        )}
      >
        {message.text ? (
          <p className="whitespace-pre-line break-words">{message.text}</p>
        ) : null}
        {message.content_uri ? (
          <a
            href={message.content_uri}
            target="_blank"
            rel="noreferrer"
            className="text-brand-link underline"
          >
            {translate(`crm.messages.content.${message.content_type}`, {
              _: translate("crm.messages.content.file"),
            })}
          </a>
        ) : null}
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          <span>
            {translate(`crm.messages.transport.${message.transport}`)}
          </span>
          {outgoing ? (
            <span>· {author || translate("crm.messages.from_phone")}</span>
          ) : null}
          <span>· {formatMessageTime(message.sent_at)}</span>
          {outgoing ? <StatusIcon message={message} /> : null}
        </p>
      </div>
    </div>
  );
};

const StatusIcon = ({ message }: { message: Message }) => {
  const translate = useTranslate();
  const label = translate(`crm.messages.status.${message.status}`);
  if (message.status === "error") {
    return (
      <CircleAlert className="size-3.5 text-destructive" aria-label={label}>
        <title>{message.error ?? label}</title>
      </CircleAlert>
    );
  }
  if (message.status === "delivered" || message.status === "read") {
    return (
      <CheckCheck
        className={cn(
          "size-3.5",
          message.status === "read" && "text-brand-blue",
        )}
        aria-label={label}
      />
    );
  }
  return <Check className="size-3.5" aria-label={label} />;
};
