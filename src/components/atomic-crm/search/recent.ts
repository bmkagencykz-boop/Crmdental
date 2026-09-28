import type { Identifier } from "ra-core";
import { matchPath } from "react-router";

/**
 * «Недавние»: the patients and deals the user opened last, shown by the
 * search field while it is empty (stored per user in the ra store, i.e.
 * localStorage of the browser).
 */

export type RecentItem = { kind: "patient" | "deal"; id: Identifier };

export const RECENT_MAX = 8;

export const recentStoreKey = (userId?: Identifier) =>
  `search.recent.${userId ?? "anonymous"}`;

/** The item first, without its older copy, at most `max` items */
export const addRecent = (
  list: RecentItem[] | undefined,
  item: RecentItem,
  max = RECENT_MAX,
): RecentItem[] =>
  [
    item,
    ...(list ?? []).filter(
      (other) =>
        !(other.kind === item.kind && String(other.id) === String(item.id)),
    ),
  ].slice(0, max);

/** The patient or deal a page shows (/patients/12/show, /deals/5/show) */
export const recentFromPath = (pathname: string): RecentItem | null => {
  const patient =
    matchPath("/patients/:id/show/*", pathname) ??
    matchPath("/patients/:id/show", pathname) ??
    matchPath("/patients/:id", pathname);
  if (patient?.params.id && /^\d+$/.test(patient.params.id)) {
    return { kind: "patient", id: Number(patient.params.id) };
  }
  const deal =
    matchPath("/deals/:id/show/*", pathname) ??
    matchPath("/deals/:id/show", pathname);
  if (deal?.params.id && /^\d+$/.test(deal.params.id)) {
    return { kind: "deal", id: Number(deal.params.id) };
  }
  return null;
};
