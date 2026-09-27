import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleAlert } from "lucide-react";
import { useDataProvider, useGetList, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { CrmDataProvider } from "../providers/types";
import type { MessengerChannel } from "../types";

/**
 * Wazzup24 connection (spec §8): the owner pastes the API key from the
 * Wazzup24 account; the CRM imports the channels (WhatsApp numbers,
 * Instagram and Telegram accounts) and registers its webhook.
 */
export const MessengerSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const { data: status, isPending } = useQuery({
    queryKey: ["messenger_status"],
    queryFn: () => dataProvider.getMessengerStatus(),
  });
  const { data: channels = [], refetch } = useGetList<MessengerChannel>(
    "messenger_channels",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["messenger_status"] });
    refetch();
  };
  const connect = useMutation({
    mutationFn: () => dataProvider.connectMessenger(apiKey.trim()),
    onSuccess: () => {
      setApiKey("");
      onSuccess();
      notify("crm.settings.messengers.connected", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });
  const disconnect = useMutation({
    mutationFn: () => dataProvider.disconnectMessenger(),
    onSuccess,
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  if (isPending) return null;
  const connected = !!status?.connected;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {connected ? (
          <CircleCheck className="size-5 text-brand-lime" />
        ) : (
          <CircleAlert className="size-5 text-muted-foreground" />
        )}
        {translate(
          connected
            ? "crm.settings.messengers.status_connected"
            : "crm.settings.messengers.status_disconnected",
        )}
      </div>
      {status?.last_error ? (
        <p className="rounded-2xl bg-brand-red/10 px-4 py-3 text-sm text-destructive">
          {status.last_error}
        </p>
      ) : null}

      <div className="flex max-w-xl flex-col gap-2">
        <label htmlFor="wazzup-key" className="text-sm font-medium">
          {translate("crm.settings.messengers.api_key")}
        </label>
        <div className="flex gap-2">
          <Input
            id="wazzup-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={translate(
              connected
                ? "crm.settings.messengers.api_key_replace"
                : "crm.settings.messengers.api_key_placeholder",
            )}
          />
          <Button
            onClick={() => connect.mutate()}
            disabled={!apiKey.trim() || connect.isPending}
          >
            {translate("crm.settings.messengers.connect")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("crm.settings.messengers.api_key_help")}
        </p>
      </div>

      {channels.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            {translate("crm.settings.messengers.channels")}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {channels.map((channel) => (
              <li
                key={channel.id}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-2.5 text-sm"
              >
                <span className="font-medium">
                  {translate(`crm.messages.transport.${channel.transport}`)}
                </span>
                <span className="text-muted-foreground">
                  {channel.name ?? channel.external_id}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {connected ? (
        <div>
          <Button
            variant="outline"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            {translate("crm.settings.messengers.disconnect")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
