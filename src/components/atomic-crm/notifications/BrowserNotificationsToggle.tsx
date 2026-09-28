import { useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import {
  browserPermission,
  requestBrowserPermission,
  type BrowserPermission,
} from "./browserNotifications";
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
} from "./useNotificationPreferences";

/**
 * «Включить уведомления в браузере»: asks the browser for the permission and
 * turns the browser channel on (in the bell dropdown and in the profile).
 */
export const BrowserNotificationsToggle = ({
  compact = false,
}: {
  compact?: boolean;
}) => {
  const translate = useTranslate();
  const { data: preferences } = useNotificationPreferences();
  const { mutate: save, isPending } = useSaveNotificationPreferences();
  const [permission, setPermission] =
    useState<BrowserPermission>(browserPermission);

  if (!preferences) return null;
  if (permission === "unsupported") {
    return compact ? null : (
      <p className="text-xs text-muted-foreground">
        {translate("notifications.browser.unsupported")}
      </p>
    );
  }
  if (permission === "denied") {
    return (
      <p className="text-xs text-muted-foreground">
        {translate("notifications.browser.denied")}
      </p>
    );
  }
  const enabled = preferences.browser_enabled && permission === "granted";
  if (enabled) {
    return (
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {translate("notifications.browser.enabled")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={isPending}
          onClick={() => save({ browser_enabled: false })}
        >
          {translate("notifications.browser.disable")}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={isPending}
        onClick={async () => {
          const result = await requestBrowserPermission();
          setPermission(result);
          if (result === "granted") save({ browser_enabled: true });
        }}
      >
        {translate("notifications.browser.enable")}
      </Button>
      {compact ? null : (
        <p className="text-xs text-muted-foreground">
          {translate("notifications.browser.hint")}
        </p>
      )}
    </div>
  );
};
