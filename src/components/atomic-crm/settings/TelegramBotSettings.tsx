import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { CrmDataProvider } from "../providers/types";

/**
 * Settings → Messengers → Telegram bot: the clinic's own bot from
 * @BotFather, next to Wazzup24 (spec §8). The token is checked and kept on
 * the server (edge function telegram_connect), never shown again.
 */
export const TelegramBotSettings = ({
  onChange,
}: {
  onChange?: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const { data: status, isPending } = useQuery({
    queryKey: ["telegram_bot_status"],
    queryFn: () => dataProvider.getTelegramBotStatus(),
  });
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["telegram_bot_status"] });
    onChange?.();
  };
  const connect = useMutation({
    mutationFn: () => dataProvider.connectTelegramBot(botToken.trim()),
    onSuccess: () => {
      setBotToken("");
      onSuccess();
      notify("telegram.connected", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });
  const disconnect = useMutation({
    mutationFn: () => dataProvider.disconnectTelegramBot(),
    onSuccess,
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  if (isPending) return null;
  const connected = !!status?.connected;

  return (
    <section
      className="flex flex-col gap-4 border-t pt-6"
      aria-labelledby="telegram-bot-title"
    >
      <div>
        <h3 id="telegram-bot-title" className="text-base font-semibold">
          {translate("telegram.title")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {translate("telegram.hint")}
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {connected ? (
          <CircleCheck className="size-5 text-brand-lime" />
        ) : (
          <CircleAlert className="size-5 text-muted-foreground" />
        )}
        {connected
          ? translate("telegram.status_connected", {
              name: status?.username
                ? `@${status.username}`
                : (status?.name ?? ""),
            })
          : translate("telegram.status_disconnected")}
      </div>
      {status?.last_error ? (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {status.last_error}
        </p>
      ) : null}

      <div className="flex max-w-xl flex-col gap-2">
        <label htmlFor="telegram-bot-token" className="text-sm font-medium">
          {translate("telegram.token")}
        </label>
        <div className="flex gap-2">
          <Input
            id="telegram-bot-token"
            type="password"
            autoComplete="off"
            value={botToken}
            onChange={(event) => setBotToken(event.target.value)}
            placeholder={translate(
              connected
                ? "telegram.token_replace"
                : "telegram.token_placeholder",
            )}
          />
          <Button
            onClick={() => connect.mutate()}
            disabled={!botToken.trim() || connect.isPending}
          >
            {translate("telegram.connect")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("telegram.token_help")}
        </p>
      </div>

      {connected ? (
        <div>
          <Button
            variant="outline"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            {translate("telegram.disconnect")}
          </Button>
        </div>
      ) : null}
    </section>
  );
};
