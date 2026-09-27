import type { Deal } from "../types";

export type DealTaskState = "ok" | "no_task" | "overdue" | "closed";

/**
 * Task control of the spec: every open deal needs an open task; a task past
 * its due date is overdue. Closed deals (won, lost) are not controlled.
 */
export const getDealTaskState = (
  deal: Deal,
  now = new Date(),
): DealTaskState => {
  if (deal.stage_kind && deal.stage_kind !== "open") return "closed";
  if (!deal.nb_open_tasks) return "no_task";
  if (deal.next_task_due_at && new Date(deal.next_task_due_at) < now) {
    return "overdue";
  }
  return "ok";
};
