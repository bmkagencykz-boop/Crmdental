import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type { Deal } from "../types";
import { IdSelect } from "./StepPanel";
import type { Salesbot } from "./types";
import { useDealBotSession } from "./useDealBotSession";

const time = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const refreshKeys = [
  "salesbot_sessions",
  "salesbot_logs",
  "automessages",
  "messages",
  "deals",
  "tasks",
];

/**
 * «Бот ведёт диалог» in the header of the deal page, with «Остановить
 * бота». Nothing when no bot runs.
 */
export const DealBotIndicator = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const session = useDealBotSession(deal.id);
  const stop = useMutation({
    mutationFn: () => dataProvider.stopSalesbot(deal.id),
    onSuccess: () => {
      for (const key of refreshKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      notify("salesbot.deal.stopped", { type: "info" });
    },
    onError: (error: unknown) =>
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      }),
  });
  if (!session) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-l-4 border-l-primary bg-card px-3 py-1.5 text-xs"
      data-testid="deal-bot-indicator"
    >
      <span className="font-semibold">
        {translate("salesbot.deal.running")}
      </span>
      <span className="text-muted-foreground">
        «{session.bot_name}»
        {session.status === "waiting" && session.wait_until
          ? ` · ${translate("salesbot.deal.waiting_until", { time: time(session.wait_until) })}`
          : ""}
      </span>
      <button
        type="button"
        className="ml-auto rounded px-1.5 py-0.5 font-medium text-destructive hover:bg-destructive/10"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
      >
        {translate("salesbot.deal.stop")}
      </button>
    </div>
  );
};

/** «Запустить бота»: choose an active bot; replaces the running one */
export const StartBotDialog = ({
  deal,
  open,
  onClose,
}: {
  deal: Deal;
  open: boolean;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [botId, setBotId] = useState<Identifier | null>(null);
  const { data: bots = [] } = useGetList<Salesbot>(
    "salesbots",
    {
      filter: { is_active: true },
      pagination: { page: 1, perPage: 200 },
      sort: { field: "position", order: "ASC" },
    },
    { enabled: open },
  );
  const chosen = botId ?? bots[0]?.id ?? null;
  const start = useMutation({
    mutationFn: () => dataProvider.startSalesbot(deal.id, chosen!),
    onSuccess: () => {
      for (const key of refreshKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      notify("salesbot.deal.started", { type: "info" });
      onClose();
    },
    onError: (error: unknown) =>
      notify(
        error instanceof Error ? error.message : "ra.notification.http_error",
        { type: "error" },
      ),
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{translate("salesbot.deal.start")}</DialogTitle>
          <DialogDescription>
            {translate("salesbot.deal.start_hint")}
          </DialogDescription>
        </DialogHeader>
        {bots.length ? (
          <IdSelect
            value={chosen}
            items={bots.map((bot) => ({ id: bot.id, name: bot.name }))}
            label={translate("salesbot.deal.choose")}
            onChange={setBotId}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("salesbot.deal.no_bots")}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            disabled={chosen == null || start.isPending}
            onClick={() => start.mutate()}
          >
            {translate("salesbot.deal.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
