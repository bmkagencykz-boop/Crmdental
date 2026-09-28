import { useQueryClient } from "@tanstack/react-query";
import { useGetList, useNotify, useTranslate, useUpdate } from "ra-core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { isAutomessageOpen } from "../providers/commons/automessages";
import type {
  Automessage,
  AutomessageRule,
  Deal,
  MessageTemplate,
} from "../types";

const formatSendAt = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_TONE: Record<Automessage["status"], string> = {
  pending: "bg-primary/10 text-primary",
  sending: "bg-primary/10 text-primary",
  awaiting: "bg-muted text-foreground",
  sent: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  failed: "bg-destructive/10 text-destructive",
};

/**
 * Automatic messages of the deal (Settings → Auto messages): the queued ones
 * with a cancel button, and what happened to the others.
 */
export const DealAutomessages = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: rows = [] } = useGetList<Automessage>(
    "automessages",
    {
      filter: { deal_id: deal.id },
      sort: { field: "send_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
    { refetchInterval: 30_000 },
  );
  const { data: rules = [] } = useGetList<AutomessageRule>(
    "automessage_rules",
    { pagination: { page: 1, perPage: 200 } },
    { enabled: rows.length > 0 },
  );
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    { pagination: { page: 1, perPage: 200 } },
    { enabled: rows.length > 0 },
  );
  if (!rows.length) return null;

  const templateName = (row: Automessage) => {
    if (row.salesbot_session_id != null) {
      return translate("salesbot.deal.queue_name");
    }
    const rule = rules.find((r) => String(r.id) === String(row.rule_id));
    const template = templates.find(
      (t) => String(t.id) === String(row.template_id ?? rule?.template_id),
    );
    return template?.name ?? translate("automessages.deal.rule_deleted");
  };
  // Waiting ones first, then the most recent
  const sorted = [...rows].sort(
    (a, b) =>
      Number(isAutomessageOpen(b)) - Number(isAutomessageOpen(a)) ||
      b.send_at.localeCompare(a.send_at),
  );

  return (
    <section
      className="rounded-md border bg-card p-4"
      aria-label={translate("automessages.deal.title")}
      data-testid="deal-automessages"
    >
      <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
        {translate("automessages.deal.title")}
      </h3>
      <ul className="flex flex-col gap-2.5">
        {sorted.slice(0, 10).map((row) => (
          <AutomessageItem key={row.id} row={row} name={templateName(row)} />
        ))}
      </ul>
    </section>
  );
};

const AutomessageItem = ({ row, name }: { row: Automessage; name: string }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [update, { isPending }] = useUpdate();
  const cancel = () =>
    update(
      "automessages",
      { id: row.id, data: { status: "cancelled" }, previousData: row },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["automessages"] });
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          notify("automessages.deal.cancelled", { type: "info" });
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );

  return (
    <li className="flex items-start gap-2 text-sm" data-status={row.status}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{name}</span>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              STATUS_TONE[row.status],
            )}
          >
            {translate(`automessages.status.${row.status}`)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {row.status === "pending"
            ? translate("automessages.deal.planned", {
                date: formatSendAt(row.send_at),
              })
            : formatSendAt(row.processed_at ?? row.send_at)}
          {row.error && row.status !== "sent" ? ` · ${row.error}` : null}
        </p>
      </div>
      {isAutomessageOpen(row) ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          disabled={isPending}
          onClick={cancel}
        >
          {translate("automessages.deal.cancel")}
        </Button>
      ) : null}
    </li>
  );
};
