import { Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { useCanAccess, useTranslate } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { accent } from "../misc/accent";
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
  // The integrator (stage 25) only reads the deals
  const { canAccess: canCreate } = useCanAccess({
    resource: "deals",
    action: "create",
  });
  const { currency } = useConfigurationContext();
  const totalAmount = deals.reduce(
    (sum, deal) => sum + (deal.plan_amount ?? 0),
    0,
  );
  const color = accent(stage.color);
  return (
    <section className="flex min-h-[calc(100vh-18rem)] w-[17rem] shrink-0 flex-col px-1.5">
      <header className="mb-2 px-1">
        <h3
          className="truncate text-[12px] font-semibold uppercase tracking-[0.04em] text-foreground"
          title={stage.name}
        >
          {stage.name}
        </h3>
        <span
          className="mt-1.5 block h-[3px] rounded-sm"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <p className="mt-1.5 text-[12px] tabular-nums text-muted-foreground">
          {translate("crm.deals.count", { smart_count: deals.length })}
          {": "}
          <span className="font-medium text-foreground">
            {formatMoney(totalAmount, currency, totalAmount >= 1_000_000)}
          </span>
        </p>
      </header>
      {isFirst && canCreate ? (
        <Link
          to={`/deals/create?stage_id=${stage.id}`}
          className="mb-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-[12px] font-medium text-muted-foreground no-underline transition-colors hover:border-primary/60 hover:text-foreground"
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
              "flex flex-1 flex-col gap-1.5 rounded-md transition-colors",
              snapshot.isDraggingOver && "bg-primary/[0.06]",
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
