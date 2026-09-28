import { useQuery } from "@tanstack/react-query";
import {
  Bot,
  ChevronDown,
  Globe,
  MessageCircle,
  Phone,
  type LucideIcon,
} from "lucide-react";
import { useDataProvider, useTranslate } from "ra-core";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LeadSettings } from "../leads/LeadSettings";
import type { CrmDataProvider } from "../providers/types";
import { MessengerSettings } from "../settings/MessengerSettings";
import { TelegramBotSettings } from "../settings/TelegramBotSettings";
import { TelephonySettings } from "../telephony/TelephonySettings";

type ChannelStatus = "connected" | "not_connected" | "ready";
type Channel = "wazzup" | "website" | "telegram_bot" | "telephony";

/**
 * Step «Каналы»: WhatsApp / Instagram / Telegram through Wazzup24, the
 * website form, the clinic's Telegram bot and the telephony. Each one opens
 * the same block as in Settings, with a clear status; all are optional.
 */
export const ChannelsStep = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [open, setOpen] = useState<Channel | null>(null);
  // Same query keys as the settings blocks: they refresh the statuses
  const { data: messenger } = useQuery({
    queryKey: ["messenger_status"],
    queryFn: () => dataProvider.getMessengerStatus(),
  });
  const { data: bot } = useQuery({
    queryKey: ["telegram_bot_status"],
    queryFn: () => dataProvider.getTelegramBotStatus(),
  });
  const { data: telephony } = useQuery({
    queryKey: ["telephony_status"],
    queryFn: () => dataProvider.getTelephonyStatus(),
  });

  const channels: {
    id: Channel;
    icon: LucideIcon;
    status: ChannelStatus;
    content: ReactNode;
  }[] = [
    {
      id: "wazzup",
      icon: MessageCircle,
      status: messenger?.connected ? "connected" : "not_connected",
      content: <MessengerSettings withTelegramBot={false} />,
    },
    {
      id: "website",
      icon: Globe,
      status: "ready",
      content: <LeadSettings />,
    },
    {
      id: "telegram_bot",
      icon: Bot,
      status: bot?.connected ? "connected" : "not_connected",
      content: <TelegramBotSettings />,
    },
    {
      id: "telephony",
      icon: Phone,
      status: telephony ? "connected" : "not_connected",
      content: <TelephonySettings />,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {channels.map(({ id, icon: Icon, status, content }) => {
        const expanded = open === id;
        const title = translate(`onboarding.channels.${id}.title`);
        return (
          <section
            key={id}
            aria-label={title}
            className="rounded-md border bg-card"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="text-xs text-muted-foreground">
                  {translate(`onboarding.channels.${id}.hint`)}
                </p>
              </div>
              <StatusPill status={status} />
              <Button
                variant={expanded ? "ghost" : "outline"}
                size="sm"
                onClick={() => setOpen(expanded ? null : id)}
                aria-expanded={expanded}
              >
                {translate(
                  expanded
                    ? "onboarding.channels.collapse"
                    : "onboarding.channels.set_up",
                )}
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </Button>
            </div>
            {expanded ? (
              <div className="border-t px-4 py-4">{content}</div>
            ) : null}
          </section>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {translate("onboarding.channels.later_hint")}
      </p>
    </div>
  );
};

const StatusPill = ({ status }: { status: ChannelStatus }) => {
  const translate = useTranslate();
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        status === "connected"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "connected"
            ? "bg-primary"
            : status === "ready"
              ? "bg-brand-yellow"
              : "bg-muted-foreground/50",
        )}
      />
      {translate(`onboarding.channels.status.${status}`)}
    </span>
  );
};
