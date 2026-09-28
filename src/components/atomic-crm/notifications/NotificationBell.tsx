import { useQueryClient } from "@tanstack/react-query";
import {
  AlarmClock,
  Bell,
  CheckCheck,
  Flame,
  Forward,
  MessageCircle,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useRelativeDate } from "../misc/RelativeDate";
import type { CrmDataProvider } from "../providers/types";
import type { CrmNotification, NotificationKind } from "../types";
import { BrowserNotificationsToggle } from "./BrowserNotificationsToggle";
import {
  pickBrowserNotifications,
  showBrowserNotification,
} from "./browserNotifications";
import { useNotificationPreferences } from "./useNotificationPreferences";

/** Same rhythm as the inbox: the bell asks the database every 20 seconds */
const POLL_INTERVAL = 20_000;

const KIND_ICONS: Record<NotificationKind, LucideIcon> = {
  lead_assigned: UserPlus,
  patient_message: MessageCircle,
  task_overdue: AlarmClock,
  response_overdue: Flame,
  bot_handoff: Forward,
  visit_reschedule: AlarmClock,
};

/** Title of a notification in the language of the user */
const useNotificationTitle = () => {
  const translate = useTranslate();
  return (notification: Pick<CrmNotification, "kind" | "message_count">) =>
    translate(`notifications.kinds.${notification.kind}`, {
      smart_count: notification.message_count ?? 1,
    });
};

/**
 * Bell of the header: unread count, the latest notifications (newest first),
 * «Прочитать все», the browser opt-in. A click opens the deal and marks the
 * notification read. New notifications also pop up in the browser when the
 * employee turned that on.
 */
export const NotificationBell = () => {
  const translate = useTranslate();
  const { identity } = useGetIdentity();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [update] = useUpdate<CrmNotification>();
  const enabled = identity?.id != null;
  const { data: notifications = [], isFetched } = useGetList<CrmNotification>(
    "notifications",
    {
      filter: { sales_id: identity?.id },
      sort: { field: "updated_at", order: "DESC" },
      pagination: { page: 1, perPage: 30 },
    },
    { enabled, refetchInterval: POLL_INTERVAL },
  );
  const { total: unread = 0 } = useGetList<CrmNotification>(
    "notifications",
    {
      filter: { sales_id: identity?.id, "read_at@is": null },
      sort: { field: "id", order: "DESC" },
      pagination: { page: 1, perPage: 1 },
    },
    { enabled, refetchInterval: POLL_INTERVAL },
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const openNotification = (notification: CrmNotification) => {
    setOpen(false);
    if (!notification.read_at) {
      update(
        "notifications",
        {
          id: notification.id,
          data: { read_at: new Date().toISOString() },
          previousData: notification,
        },
        { onSuccess: refresh },
      );
    }
    if (notification.deal_id != null) {
      navigate(`/deals/${notification.deal_id}/show`);
    }
  };

  useBrowserNotifications(isFetched ? notifications : null, openNotification);

  const markAllRead = async () => {
    await dataProvider.markAllNotificationsRead();
    await refresh();
  };

  const label = translate("notifications.bell.label");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={
            unread
              ? `${label}: ${translate("notifications.bell.unread", { smart_count: unread })}`
              : label
          }
          title={label}
        >
          <Bell className="size-5" />
          {unread ? (
            <span
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground ring-2 ring-background"
              data-testid="notifications-badge"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{label}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!unread}
            onClick={markAllRead}
          >
            <CheckCheck className="size-3.5" />
            {translate("notifications.bell.mark_all_read")}
          </Button>
        </div>
        {notifications.length ? (
          <ul
            className="max-h-[26rem] overflow-y-auto py-1"
            aria-label={translate("notifications.bell.list")}
          >
            {notifications.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  onOpen={openNotification}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {translate("notifications.bell.empty")}
          </p>
        )}
        <div className="border-t border-border px-4 py-3">
          <BrowserNotificationsToggle compact />
        </div>
      </PopoverContent>
    </Popover>
  );
};

const NotificationItem = ({
  notification,
  onOpen,
}: {
  notification: CrmNotification;
  onOpen: (notification: CrmNotification) => void;
}) => {
  const title = useNotificationTitle()(notification);
  const date = useRelativeDate(notification.updated_at);
  const Icon = KIND_ICONS[notification.kind] ?? Bell;
  const unread = !notification.read_at;
  return (
    <button
      type="button"
      onClick={() => onOpen(notification)}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent",
        unread ? "bg-primary/5" : "",
      )}
      data-unread={unread ? "true" : undefined}
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
          notification.kind === "response_overdue"
            ? "bg-brand-red/10 text-brand-red"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              unread ? "font-semibold text-foreground" : "text-foreground/80",
            )}
          >
            {title}
          </span>
          {unread ? (
            <span className="size-2 shrink-0 rounded-full bg-primary" />
          ) : null}
        </span>
        {notification.body ? (
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
            {notification.body}
          </span>
        ) : null}
        <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
          {date}
        </span>
      </span>
    </button>
  );
};

/**
 * Pops up the notifications that arrive while the tab is open. The ones
 * already there when the page loads are not shown again.
 */
const useBrowserNotifications = (
  notifications: CrmNotification[] | null,
  onOpen: (notification: CrmNotification) => void,
) => {
  const { data: preferences } = useNotificationPreferences();
  const title = useNotificationTitle();
  const seen = useRef<Set<Identifier> | null>(null);
  const callbacks = useRef({ onOpen, title });
  callbacks.current = { onOpen, title };

  useEffect(() => {
    if (notifications == null) return;
    if (seen.current == null) {
      seen.current = new Set(notifications.map((n) => n.id));
      return;
    }
    for (const notification of pickBrowserNotifications(
      notifications,
      seen.current,
      preferences,
    )) {
      showBrowserNotification({
        title: callbacks.current.title(notification),
        body: notification.body,
        tag: `crm-notification-${notification.id}`,
        onClick: () => callbacks.current.onOpen(notification),
      });
    }
    for (const notification of notifications) {
      seen.current.add(notification.id);
    }
  }, [notifications, preferences]);
};
