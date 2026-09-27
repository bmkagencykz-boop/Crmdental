import type { Identifier } from "ra-core";

import type { CrmNotification, NotificationPreferences } from "../types";

/**
 * Browser notifications (Notification API) while a CRM tab is open. Push
 * through a service worker (tab closed) is not done: it needs a push server
 * and VAPID keys.
 */

export type BrowserPermission = NotificationPermission | "unsupported";

export const browserPermission = (): BrowserPermission =>
  typeof window === "undefined" || !("Notification" in window)
    ? "unsupported"
    : window.Notification.permission;

export const requestBrowserPermission =
  async (): Promise<BrowserPermission> => {
    if (browserPermission() === "unsupported") return "unsupported";
    return window.Notification.requestPermission();
  };

/** A notification older than this is not shown (e.g. after a sleep) */
const MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The notifications to show in the browser: new since the last poll (ids not
 * seen yet), unread, recent, of a kind the employee chose, when the browser
 * channel is on.
 */
export const pickBrowserNotifications = (
  notifications: CrmNotification[],
  seen: Set<Identifier>,
  preferences:
    | Pick<NotificationPreferences, "browser_enabled" | "kinds">
    | null
    | undefined,
  now = Date.now(),
) => {
  if (!preferences?.browser_enabled) return [];
  return notifications.filter(
    (notification) =>
      !seen.has(notification.id) &&
      !notification.read_at &&
      preferences.kinds.includes(notification.kind) &&
      now - new Date(notification.updated_at).getTime() < MAX_AGE_MS,
  );
};

export const showBrowserNotification = ({
  title,
  body,
  tag,
  onClick,
}: {
  title: string;
  body?: string | null;
  tag: string;
  onClick: () => void;
}) => {
  if (browserPermission() !== "granted") return;
  try {
    const notification = new window.Notification(title, {
      body: body ?? undefined,
      tag,
    });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker
  }
};
