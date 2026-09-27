import type { LucideIcon } from "lucide-react";
import { Columns3, LayoutGrid, ListChecks, UsersRound } from "lucide-react";
import { useTranslate } from "ra-core";

export const SIDEBAR_WIDTH = "6rem";

export type NavItem = {
  to: string;
  match: string;
  icon: LucideIcon;
  label: string;
};

/**
 * Main navigation items, shared with the page title shown in the layout.
 */
export const useNavItems = (): NavItem[] => {
  const translate = useTranslate();
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
