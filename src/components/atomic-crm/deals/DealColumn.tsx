import { Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { accent, onAccent } from "../misc/accent";
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
  const color = accent(stage.color);
  const ink = onAccent(stage.color);
  return (
    <section className="flex min-h-[calc(100vh-18rem)] w-[18rem] shrink-0 flex-col border-l border-white/[0.06] px-2.5 first:border-l-0">
      <header
        className="mb-3 flex items-center gap-3 rounded-full py-2.5 pr-5 pl-3"
        style={{ backgroundColor: color, color: ink }}
      >
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-[1.35rem] font-semibold tabular-nums"
          style={{
            backgroundColor:
              ink === "#FFFFFF"
                ? "rgba(255,255,255,0.16)"
                : "rgba(26,21,23,0.08)",
          }}
          title={translate("crm.deals.count", {
            smart_count: deals.length,
          })}
        >
          {deals.length}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold leading-tight">
            {stage.name}
          </h3>
          <p className="text-[12px] tabular-nums opacity-70">
            {formatMoney(totalAmount, currency, totalAmount >= 1_000_000)}
          </p>
        </div>
      </header>
      {isFirst ? (
        <Link
          to={`/deals/create?stage_id=${stage.id}`}
          className="mb-2 flex items-center justify-center gap-1.5 rounded-full border border-dashed border-white/15 py-2.5 text-[13px] font-medium text-muted-foreground no-underline transition-colors hover:border-white/40 hover:text-foreground"
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
              snapshot.isDraggingOver && "bg-white/[0.04]",
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
