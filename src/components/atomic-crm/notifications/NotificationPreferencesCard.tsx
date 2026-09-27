import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import type { CrmDataProvider } from "../providers/types";
import type { NotificationKind } from "../types";
import { BrowserNotificationsToggle } from "./BrowserNotificationsToggle";
import {
  PREFERENCES_KEY,
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from "./useNotificationPreferences";

const KINDS: NotificationKind[] = [
  "lead_assigned",
  "patient_message",
  "response_overdue",
  "task_overdue",
];

/** Username of the platform notification bot (without @), for the deep link */
const BOT_USERNAME = (
  import.meta.env.VITE_NOTIFY_TELEGRAM_BOT as string | undefined
)?.replace(/^@/, "");

/**
 * Profile → «Уведомления»: which kinds go to the browser and to Telegram,
 * the browser opt-in, and linking the employee's Telegram to the platform
 * bot (t.me/<bot>?start=<code>).
 */
export const NotificationPreferencesCard = () => {
  const translate = useTranslate();
  const { data: preferences } = useNotificationPreferences();
  const { mutate: save } = useSaveNotificationPreferences();
  if (!preferences) return null;

  const toggleKind = (kind: NotificationKind, on: boolean) =>
    save({
      kinds: on
        ? [...preferences.kinds, kind]
        : preferences.kinds.filter((k) => k !== kind),
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold text-muted-foreground">
            {translate("notifications.preferences.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {translate("notifications.preferences.hint")}
          </p>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">
            {translate("notifications.preferences.kinds")}
          </legend>
          {KINDS.map((kind) => (
            <div key={kind} className="flex items-center gap-3">
              <Switch
                id={`kind-${kind}`}
                checked={preferences.kinds.includes(kind)}
                onCheckedChange={(on) => toggleKind(kind, on)}
              />
              <Label htmlFor={`kind-${kind}`} className="font-normal">
                {translate(`notifications.kind_options.${kind}`)}
              </Label>
            </div>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold">
            {translate("notifications.preferences.channels")}
          </legend>
          <p className="text-sm text-muted-foreground">
            {translate("notifications.preferences.in_app")}
          </p>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              {translate("notifications.preferences.browser")}
            </p>
            <BrowserNotificationsToggle />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Switch
                id="telegram-enabled"
                checked={preferences.telegram_enabled}
                onCheckedChange={(telegram_enabled) =>
                  save({ telegram_enabled })
                }
              />
              <Label htmlFor="telegram-enabled">
                {translate("notifications.preferences.telegram")}
              </Label>
            </div>
            <TelegramLink />
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
};

const TelegramLink = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const {
    data: preferences,
    refetch,
    isFetching,
  } = useNotificationPreferences();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: PREFERENCES_KEY });
  const connect = useMutation({
    mutationFn: () => dataProvider.createTelegramLinkCode(),
    onSuccess: refresh,
    onError: () => notify("crm.settings.save_error", { type: "error" }),
  });
  const disconnect = useMutation({
    mutationFn: () => dataProvider.unlinkTelegram(),
    onSuccess: refresh,
    onError: () => notify("crm.settings.save_error", { type: "error" }),
  });
  if (!preferences) return null;

  if (preferences.telegram_linked) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
        <span className="flex items-center gap-2">
          <Send className="size-4 text-primary" />
          {preferences.telegram_username
            ? translate("notifications.telegram.connected_as", {
                username: preferences.telegram_username,
              })
            : translate("notifications.telegram.connected")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          {translate("notifications.telegram.disconnect")}
        </Button>
      </div>
    );
  }

  const code = preferences.telegram_link_code;
  if (!code) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={connect.isPending}
        onClick={() => connect.mutate()}
      >
        <Send className="size-4" />
        {translate("notifications.telegram.connect")}
      </Button>
    );
  }
  const link = BOT_USERNAME
    ? `https://t.me/${BOT_USERNAME}?start=${code}`
    : null;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <p>
        {translate(
          link
            ? "notifications.telegram.code_hint"
            : "notifications.telegram.no_bot",
          { code },
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate("notifications.telegram.expires")}
      </p>
      <div className="flex flex-wrap gap-2">
        {link ? (
          <Button type="button" size="sm" asChild>
            <a href={link} target="_blank" rel="noreferrer">
              <Send className="size-4" />
              {translate("notifications.telegram.open_bot")}
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={async () => {
            const { data } = await refetch();
            if (!data?.telegram_linked) {
              notify("notifications.telegram.not_linked", { type: "info" });
            }
          }}
        >
          {translate("notifications.telegram.check")}
        </Button>
      </div>
    </div>
  );
};
