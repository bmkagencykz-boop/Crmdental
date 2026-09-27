import { Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { findDealLabel } from "./dealUtils";
import { DealCard } from "./DealCard";
import { formatMoney } from "./kanbanFormat";

/**
 * Stage accent line under the column title. Stages get their own colors once
 * pipelines are configurable; until then: won is green, lost is coral,
 * every open stage is blue.
 */
const stageLineClass = (stage: string) =>
  stage === "won"
    ? "bg-brand-green"
    : stage === "lost"
      ? "bg-brand-red"
      : "bg-brand-blue";

export const DealColumn = ({
  stage,
  deals,
  isFirst = false,
}: {
  stage: string;
  deals: Deal[];
  isFirst?: boolean;
}) => {
  const translate = useTranslate();
  const totalAmount = deals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const { dealStages, currency } = useConfigurationContext();
  return (
    <section className="flex w-[17rem] shrink-0 flex-col">
      <header className="pb-3 text-center">
        <h3 className="truncate text-xs font-bold uppercase tracking-[0.06em]">
          {findDealLabel(dealStages, stage)}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {translate("crm.deals.count", {
            smart_count: deals.length,
            _: `${deals.length}`,
          })}
          {": "}
          {formatMoney(totalAmount, currency, totalAmount >= 1_000_000)}
        </p>
        <div className={cn("mt-2.5 h-[2px] w-full", stageLineClass(stage))} />
      </header>
      {isFirst ? (
        <Link
          to="/deals/create"
          className="mb-2 flex items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-input py-3 text-[13px] text-muted-foreground no-underline transition-colors hover:border-brand-blue hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {translate("crm.deals.quick_add", { _: "Быстрое добавление" })}
        </Link>
      ) : null}
      <Droppable droppableId={stage}>
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className={cn(
              "flex min-h-24 flex-1 flex-col gap-1.5 rounded-[4px] transition-colors",
              snapshot.isDraggingOver && "bg-brand-blue/10",
            )}
          >
            {deals.map((deal, index) => (
              <DealCard key={deal.id} deal={deal} index={index} />
            ))}
            {droppableProvided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  );
};
