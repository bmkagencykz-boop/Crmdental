import type { Identifier } from "ra-core";

/**
 * Bulk actions of the deal list (stage 21): the shapes of
 * public.bulk_deals(action, ids, params) and the pure helpers shared by the
 * dialog and the demo data provider.
 */

export const BULK_ACTIONS = [
  "stage",
  "responsible",
  "add_tags",
  "remove_tags",
  "task",
  "message",
  "export",
  "archive",
  "delete",
] as const;

export type BulkActionId = (typeof BULK_ACTIONS)[number];
/** The actions done by the database (export is done in the browser) */
export type BulkDealsAction = Exclude<BulkActionId, "export">;

/** Actions for the owner and the head only (checked by the database too) */
export const ADMIN_ACTIONS: BulkActionId[] = [
  "message",
  "archive",
  "delete",
];

export const isAllowedAction = (
  action: BulkActionId,
  role: string | undefined,
) =>
  !ADMIN_ACTIONS.includes(action) ||
  role === "owner" ||
  role === "head";

export type BulkParams = {
  stage_id?: Identifier;
  lost_reason_id?: Identifier | null;
  lost_comment?: string | null;
  sales_id?: Identifier | null;
  tag_ids?: Identifier[];
  text?: string;
  due_date?: string;
  type?: string;
  template_id?: Identifier | null;
  body?: string | null;
  name?: string | null;
};

export type BulkDealResult = {
  id: Identifier;
  ok: boolean;
  error?: string;
  code?: string;
};

export type BulkDealsResult = {
  action: BulkDealsAction;
  results: BulkDealResult[];
  ok: number;
  failed: number;
  mailing_id?: Identifier | null;
};

/** At most this many deals per call, so that the progress moves */
export const BULK_CHUNK = 50;
/** At most this many deals for «all matching the filter» */
export const BULK_MAX = 1000;

export const chunk = <T>(items: T[], size = BULK_CHUNK): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

/** The answers of several calls as one */
export const mergeResults = (
  action: BulkDealsAction,
  answers: BulkDealsResult[],
): BulkDealsResult => {
  const results = answers.flatMap((answer) => answer.results);
  return {
    action,
    results,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    mailing_id: answers.find((answer) => answer.mailing_id != null)?.mailing_id,
  };
};

/** Distinct ids, in their first order */
export const distinctIds = (ids: Identifier[]) => {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const key = String(id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Tags of a deal after add_tags / remove_tags (same as bulk_deals) */
export const nextTags = (
  action: "add_tags" | "remove_tags",
  tags: Identifier[],
  tagIds: Identifier[],
): Identifier[] => {
  const ids = distinctIds(tagIds).map(String);
  if (action === "remove_tags") {
    return tags.filter((tag) => !ids.includes(String(tag)));
  }
  const current = tags.map(String);
  const added = distinctIds(tagIds)
    .filter((tag) => !current.includes(String(tag)))
    .sort((a, b) => Number(a) - Number(b));
  return [...tags, ...added];
};

/** A database error as a per-deal result: message and hint (the rule) */
export const failure = (id: Identifier, error: unknown): BulkDealResult => {
  const err = error as { message?: string; hint?: string; code?: string };
  return {
    id,
    ok: false,
    error: err?.message || String(error),
    code: err?.hint || err?.code || "error",
  };
};
