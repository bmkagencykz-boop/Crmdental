import { useQueryClient } from "@tanstack/react-query";
import { useGetList, type Identifier } from "ra-core";
import { useCallback, useEffect } from "react";
import { useLocation } from "react-router";

import { useMyAccessRights } from "../access-rights/useAccessRights";
import type { WaitingEntry } from "./types";

const EMPTY: never[] = [];

/** Active entries: waiting or offered (the filter of the counters) */
export const ACTIVE_FILTER = { "status@in": "(waiting,offered)" };

/**
 * Who does what with the waiting list (the same rules as the database):
 * whoever sees the patient (and the deal) reads and edits the entry; the
 * owner, the head or its author deletes it; the integrator sees nothing.
 */
export const useWaitingRights = () => {
  const { data, isPending } = useMyAccessRights();
  const role = data?.role;
  const me = data?.sales_id ?? null;
  const chief = role === "owner" || role === "head";
  return {
    isPending,
    me,
    canUse: role === "owner" || role === "head" || role === "manager",
    canDelete: (authorId: Identifier | null | undefined) =>
      chief ||
      (role === "manager" &&
        authorId != null &&
        me != null &&
        String(authorId) === String(me)),
  };
};

/** Entries of the list (the oldest first), with an optional filter */
export const useWaitingEntries = (
  filter: Record<string, unknown> = {},
  enabled = true,
) => {
  const { data, isPending, refetch } = useGetList<WaitingEntry>(
    "waiting_list",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "created_at", order: "ASC" },
      filter,
    },
    { enabled },
  );
  return { data: data ?? (EMPTY as WaitingEntry[]), isPending, refetch };
};

/**
 * The counter chip: active entries of the list, and how many have a freed
 * slot. Fresh on every screen change and every minute.
 */
export const useWaitingCount = (enabled = true) => {
  const { data, total, refetch } = useGetList<WaitingEntry>(
    "waiting_list",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "created_at", order: "ASC" },
      filter: ACTIVE_FILTER,
    },
    { enabled, refetchInterval: 60_000 },
  );
  const { pathname } = useLocation();
  useEffect(() => {
    if (enabled) refetch();
  }, [pathname, enabled, refetch]);
  const now = Date.now();
  return {
    total: total ?? 0,
    freed: (data ?? []).filter(
      (entry) =>
        entry.slot_starts_at && new Date(entry.slot_starts_at).getTime() > now,
    ).length,
  };
};

/** Refetches the lists after a change of the waiting list or the schedule */
export const useRefreshWaiting = () => {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["waiting_list"] });
    queryClient.invalidateQueries({ queryKey: ["visits"] });
  }, [queryClient]);
};
