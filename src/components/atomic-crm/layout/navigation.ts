import {
  DashboardGlyph,
  DealsGlyph,
  InboxGlyph,
  type NavGlyph,
  PatientsGlyph,
  ScheduleGlyph,
  TasksGlyph,
} from "./navGlyphs";
import { useGetList, useTranslate } from "ra-core";
import { useEffect } from "react";
import { useLocation } from "react-router";

import { UNSORTED_FILTER } from "../unsorted/unsorted";

export const SIDEBAR_WIDTH = "6.5rem";

export type NavItem = {
  to: string;
  match: string;
  icon: NavGlyph;
  label: string;
  /** canAccess resource of the section, asked with the action "menu" */
  resource?: string;
  /** Counter shown on the icon (unread conversations, unsorted leads) */
  badge?: number;
  /** What the counter counts (screen readers, tooltip) */
  badgeLabel?: string;
};

/**
 * Main navigation items, shared with the page title shown in the layout.
 */
export const useNavItems = (): NavItem[] => {
  const translate = useTranslate();
  // Conversations waiting for an answer
  const { total: unread, refetch: refetchUnread } = useGetList(
    "deals",
    {
      filter: { "nb_unread_messages@gt": 0 },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { refetchInterval: 30_000 },
  );
  // Leads waiting in «Неразобранное» (stage 18)
  const { total: unsorted, refetch: refetchUnsorted } = useGetList(
    "deals",
    {
      filter: UNSORTED_FILTER,
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    },
    { refetchInterval: 30_000 },
  );
  // Counters are fresh on every screen change, not only every 30 s
  const { pathname } = useLocation();
  useEffect(() => {
    refetchUnread();
    refetchUnsorted();
  }, [pathname, refetchUnread, refetchUnsorted]);
  return [
    {
      to: "/",
      match: "/",
      icon: DashboardGlyph,
      label: translate("crm.navigation.dashboard", { _: "Рабочий стол" }),
      resource: "dashboard",
    },
    {
      to: "/deals",
      match: "/deals/*",
      icon: DealsGlyph,
      label: translate("resources.deals.name", { smart_count: 2 }),
      resource: "deals",
      badge: unsorted ?? 0,
      badgeLabel: translate("unsorted.nav_badge", { count: unsorted ?? 0 }),
    },
    {
      to: "/inbox",
      match: "/inbox",
      icon: InboxGlyph,
      label: translate("crm.navigation.inbox"),
      resource: "messages",
      badge: unread ?? 0,
    },
    {
      to: "/tasks",
      match: "/tasks",
      icon: TasksGlyph,
      label: translate("resources.tasks.name", { smart_count: 2 }),
      resource: "tasks",
    },
    {
      to: "/schedule",
      match: "/schedule",
      icon: ScheduleGlyph,
      label: translate("schedule.nav"),
      resource: "visits",
    },
    {
      to: "/patients",
      match: "/patients/*",
      icon: PatientsGlyph,
      label: translate("resources.patients.name", { smart_count: 2 }),
      resource: "patients",
    },
  ];
};
