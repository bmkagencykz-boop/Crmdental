import { Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, Stage } from "../types";
import { DealCard } from "./DealCard";
import { formatMoney } from "./kanbanFormat";

export const DealColumn = ({
  stage,
  deals,
  isFirst = false,
}: {
  stage: Stage;
  deals: Deal[];
  isFirst?: boolean;
}) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const totalAmount = deals.reduce(
    (sum, deal) => sum + (deal.plan_amount ?? 0),
    0,
  );
  return (
    <section className="glass flex min-h-[calc(100vh-18rem)] w-[17.5rem] shrink-0 flex-col rounded-[1.5rem] p-2">
      <header className="px-3 pt-3 pb-3.5">
        <div className="flex items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color }}
          />
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
            {stage.name}
          </h3>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{ backgroundColor: `${stage.color}33` }}
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
          to={`/deals/create?stage_id=${stage.id}`}
          className="mb-2 flex items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-foreground/15 py-2.5 text-[13px] font-medium text-muted-foreground no-underline transition-colors hover:border-brand-blue hover:bg-card/60 hover:text-foreground"
        >
          <Plus className="size-3.5" />
          {translate("crm.deals.quick_add")}
        </Link>
      ) : null}
      <Droppable droppableId={String(stage.id)}>
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
