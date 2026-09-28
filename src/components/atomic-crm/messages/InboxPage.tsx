import {
  useGetList,
  useGetOne,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { findById, useStages } from "../dictionaries/useDictionaries";
import { patientDisplayName } from "../patients/parsePatientText";
import type { Deal } from "../types";
import { UnsortedActions } from "../unsorted/UnsortedActions";
import { UNSORTED_FILTER } from "../unsorted/unsorted";
import { formatMessageTime, MessageBubble } from "./MessageBubble";
import { MessageComposer } from "./MessageComposer";
import {
  MESSAGES_REFRESH_MS,
  useDealMessages,
  useMarkDealRead,
} from "./useMessages";

/**
 * Inbox (spec §4.5): every conversation of the clinic, newest first, the
 * unread ones highlighted; the chat on the right. Each conversation is a
 * deal: a message from a new contact already created the patient and the
 * deal (public.ingest_message).
 */
export const InboxPage = () => {
  const translate = useTranslate();
  const [selectedId, setSelectedId] = useStore<Identifier | undefined>(
    "inbox.deal_id",
  );
  // All, unread, or the leads waiting in «Неразобранное» (stage 18)
  const [tab, setTab] = useState<InboxTab>("all");
  const [search, setSearch] = useState("");
  const { data: deals = [], isPending } = useGetList<Deal>(
    "deals",
    {
      filter: {
        "last_message_at@not.is": null,
        ...(tab === "unread" ? { "nb_unread_messages@gt": 0 } : {}),
        ...(tab === "unsorted" ? UNSORTED_FILTER : {}),
        ...(search.trim() ? { q: search.trim() } : {}),
      },
      sort: { field: "last_message_at", order: "DESC" },
      pagination: { page: 1, perPage: 100 },
    },
    { refetchInterval: MESSAGES_REFRESH_MS },
  );
  const selected = deals.find((deal) => deal.id === selectedId);

  return (
    <div className="grid h-[calc(100vh-6rem)] min-h-[32rem] grid-cols-[22rem_1fr] gap-5">
      <section className="glass flex min-h-0 flex-col rounded-lg p-3">
        <div className="flex flex-col gap-2 p-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={translate("crm.deals.search")}
            aria-label={translate("crm.deals.search")}
          />
          <div className="flex gap-1" role="tablist">
            {INBOX_TABS.map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {translate(
                  value === "unsorted"
                    ? "unsorted.inbox_tab"
                    : `crm.inbox.${value}`,
                )}
              </button>
            ))}
          </div>
        </div>
        <ul
          className="min-h-0 flex-1 overflow-y-auto"
          aria-label={translate("crm.inbox.conversations")}
        >
          {deals.map((deal) => (
            <li key={deal.id}>
              <ConversationRow
                deal={deal}
                active={deal.id === selectedId}
                onClick={() => setSelectedId(deal.id)}
              />
            </li>
          ))}
          {!isPending && !deals.length ? (
            <li className="p-4 text-sm text-muted-foreground">
              {translate("crm.inbox.empty")}
            </li>
          ) : null}
        </ul>
      </section>
      <section className="glass flex min-h-0 flex-col rounded-lg">
        {selectedId != null ? (
          <Conversation
            dealId={selectedId}
            fallback={selected}
            onSelect={setSelectedId}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm">{translate("crm.inbox.pick")}</p>
          </div>
        )}
      </section>
    </div>
  );
};

InboxPage.path = "/inbox";

const INBOX_TABS = ["all", "unread", "unsorted"] as const;
type InboxTab = (typeof INBOX_TABS)[number];

const ConversationRow = ({
  deal,
  active,
  onClick,
}: {
  deal: Deal;
  active: boolean;
  onClick: () => void;
}) => {
  const translate = useTranslate();
  const unread = deal.nb_unread_messages ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors",
        active ? "bg-card shadow-card" : "hover:bg-card/60",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-sm",
            unread ? "font-bold" : "font-semibold",
          )}
        >
          {patientDisplayName({
            last_name: deal.patient_last_name,
            first_name: deal.patient_first_name,
          }) || deal.patient_phone}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {deal.last_message_at ? formatMessageTime(deal.last_message_at) : ""}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-xs",
            unread ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {deal.last_message_text || translate("crm.messages.content.file")}
        </span>
        {unread ? (
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
            {unread}
          </span>
        ) : null}
      </span>
    </button>
  );
};

const Conversation = ({
  dealId,
  fallback,
  onSelect,
}: {
  dealId: Identifier;
  fallback?: Deal;
  /** A merged lead is gone: show the deal it went into */
  onSelect: (dealId: Identifier) => void;
}) => {
  const translate = useTranslate();
  const { data: deal = fallback } = useGetOne<Deal>(
    "deals",
    { id: dealId },
    { refetchInterval: MESSAGES_REFRESH_MS },
  );
  const { data: messages = [] } = useDealMessages(dealId);
  const { data: stages } = useStages();
  useMarkDealRead(deal);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, dealId]);
  if (!deal) return null;
  const stage = findById(stages, deal.stage_id);

  return (
    <>
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold">
            {patientDisplayName({
              last_name: deal.patient_last_name,
              first_name: deal.patient_first_name,
            }) || deal.patient_phone}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {[deal.name, stage?.name, deal.patient_phone]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/deals/${deal.id}/show`}>
            {translate("crm.inbox.open_deal")}
          </Link>
        </Button>
      </header>
      {deal.unsorted_at ? (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-6 py-2.5">
          <span className="text-sm font-semibold">
            {translate("unsorted.banner.title")}
          </span>
          <UnsortedActions lead={deal} onMerged={onSelect} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="flex flex-col gap-2">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={bottom} />
        </div>
      </div>
      <div className="border-t border-border p-4">
        <MessageComposer dealId={deal.id} />
      </div>
    </>
  );
};
