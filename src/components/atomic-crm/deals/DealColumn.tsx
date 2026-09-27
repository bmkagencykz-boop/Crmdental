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
 * Stage color. Stages get their own colors once pipelines are configurable;
 * until then: won is green, lost is coral, open stages are blue.
 */
const stageTone = (stage: string) =>
  stage === "won"
    ? { dot: "bg-brand-green", pill: "bg-brand-green/20" }
    : stage === "lost"
      ? { dot: "bg-brand-red", pill: "bg-brand-red/20" }
      : { dot: "bg-brand-blue", pill: "bg-brand-blue/20" };

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
  const tone = stageTone(stage);
  return (
    <section className="glass flex min-h-[calc(100vh-15.5rem)] w-[17.5rem] shrink-0 flex-col rounded-[1.5rem] p-2">
      <header className="px-3 pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", tone.dot)} />
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {findDealLabel(dealStages, stage)}
          </h3>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
              tone.pill,
            )}
            title={translate("crm.deals.count", {
              smart_count: deals.length,
            })}
          >
            {deals.length}
          </span>
        </div>
        <p className="mt-1.5 pl-4 text-xs text-muted-foreground tabular-nums">
          {formatMoney(totalAmount, currency, totalAmount >= 1_000_000)}
        </p>
      </header>
      {isFirst ? (
        <Link
          to="/deals/create"
          className="mb-2 flex items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-foreground/15 py-2.5 text-[13px] font-medium text-muted-foreground no-underline transition-colors hover:border-brand-blue hover:bg-card/60 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {translate("crm.deals.quick_add")}
        </Link>
      ) : null}
      <Droppable droppableId={stage}>
        {(droppableProvided, snapshot) => (
          <div
            ref={droppableProvided.innerRef}
            {...droppableProvided.droppableProps}
            className={cn(
              "flex flex-1 flex-col gap-2 rounded-[1rem] transition-colors",
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
