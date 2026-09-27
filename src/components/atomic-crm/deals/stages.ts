import type { Deal, Stage } from "../types";

export type DealsByStage = Record<string, Deal[]>;

/**
 * Groups the deals of a pipeline by stage id, each column ordered by index.
 * Every stage gets a column, even without deals.
 */
export const getDealsByStage = (
  deals: Deal[],
  stages: Stage[],
): DealsByStage => {
  const byStage: DealsByStage = Object.fromEntries(
    stages.map((stage) => [String(stage.id), [] as Deal[]]),
  );
  deals.forEach((deal) => {
    byStage[String(deal.stage_id)]?.push(deal);
  });
  Object.values(byStage).forEach((column) =>
    column.sort((a, b) => a.index - b.index),
  );
  return byStage;
};
