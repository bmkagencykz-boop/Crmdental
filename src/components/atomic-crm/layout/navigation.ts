import type { LucideIcon } from "lucide-react";
import {
  Columns3,
  LayoutGrid,
  ListChecks,
  MessagesSquare,
  UsersRound,
} from "lucide-react";
import { useGetList, useTranslate } from "ra-core";

export const SIDEBAR_WIDTH = "6rem";

export type NavItem = {
  to: string;
  match: string;
  icon: LucideIcon;
  label: string;
  /** Counter shown on the icon (unread conversations) */
  badge?: number;
};

/**
 * Main navigation items, shared with the page title shown in the layout.
 */
export const useNavItems = (): NavItem[] => {
  const translate = useTranslate();
  // Conversations waiting for an answer
  const { total: unread } = useGetList(
    "deals",
    {
      filter: { "nb_unread_messages@gt": 0 },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { refetchInterval: 30_000 },
  );
  return [
    {
      to: "/",
      match: "/",
      icon: LayoutGrid,
      label: translate("crm.navigation.dashboard", { _: "Рабочий стол" }),
    },
    {
      to: "/deals",
      match: "/deals/*",
      icon: Columns3,
      label: translate("resources.deals.name", { smart_count: 2 }),
    },
    {
      to: "/inbox",
      match: "/inbox",
      icon: MessagesSquare,
      label: translate("crm.navigation.inbox"),
      badge: unread ?? 0,
    },
    {
      to: "/tasks",
      match: "/tasks",
      icon: ListChecks,
      label: translate("resources.tasks.name", { smart_count: 2 }),
    },
    {
      to: "/patients",
      match: "/patients/*",
      icon: UsersRound,
      label: translate("resources.patients.name", { smart_count: 2 }),
    },
  ];
};
