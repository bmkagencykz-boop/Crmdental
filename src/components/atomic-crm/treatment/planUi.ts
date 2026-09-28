import type { Identifier } from "ra-core";

/** Helpers of the plan editor page (stage 34) */

/** The link of the plan page */
export const planPath = (
  patientId: Identifier,
  planId: Identifier | "new",
  dealId?: Identifier | null,
) =>
  `/patients/${patientId}/plans/${planId}${
    planId === "new" && dealId != null ? `?deal_id=${dealId}` : ""
  }`;

/** The same id as in a list (numbers in the database, strings in a select) */
export const pickId = <T extends { id: Identifier }>(
  list: T[] | undefined,
  value: string | null,
): Identifier | null =>
  value == null
    ? null
    : (list?.find((row) => String(row.id) === value)?.id ?? value);

/** A dictionary without its archived entries, but with the current one */
export const activeChoices = <
  T extends { id: Identifier; name: string; is_archived?: boolean },
>(
  list: T[] | undefined,
  current: Identifier | null | undefined,
) =>
  (list ?? [])
    .filter((row) => !row.is_archived || String(row.id) === String(current))
    .map((row) => ({ id: row.id, name: row.name }));

/** A tone per stage status (the status chip of a tab) */
export const STAGE_TONE: Record<string, string> = {
  new: "bg-muted text-muted-foreground",
  in_progress: "bg-tone-blue/15 text-tone-blue",
  done: "bg-tone-green/15 text-tone-green",
  cancelled: "bg-tone-red/10 text-tone-red line-through",
};
