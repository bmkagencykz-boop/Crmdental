import { Draggable } from "@hello-pangea/dnd";
import { useRedirect, useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import { findById, useServices } from "../dictionaries/useDictionaries";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Deal } from "../types";
import { formatCardDate, formatMoney } from "./kanbanFormat";
import { getDealTaskState } from "./taskState";

export const DealCard = ({ deal, index }: { deal: Deal; index: number }) => {
  if (!deal) return null;

  return (
    <Draggable draggableId={String(deal.id)} index={index}>
      {(provided, snapshot) => (
        <DealCardContent provided={provided} snapshot={snapshot} deal={deal} />
      )}
    </Draggable>
  );
};

/**
 * Compact amoCRM-like card: patient and date, deal, service and amount,
 * responsible, and the task control of the spec (no task / overdue).
 */
export const DealCardContent = ({
  provided,
  snapshot,
  deal,
}: {
  provided?: any;
  snapshot?: any;
  deal: Deal;
}) => {
  const { currency } = useConfigurationContext();
  const { data: services } = useServices();
  const translate = useTranslate();
  const redirect = useRedirect();
  const handleClick = () => {
    redirect(`/deals/${deal.id}/show`, undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };
  const salesName = useGetSalesName(deal.sales_id ?? undefined, {
    enabled: deal.sales_id != null,
  });
  const service = findById(services, deal.service_id);
  const patientName =
    [deal.patient_last_name, deal.patient_first_name]
      .filter(Boolean)
      .join(" ") ||
    deal.patient_phone ||
    "—";
  const taskState = getDealTaskState(deal);
  const date = formatCardDate(deal.created_at, {
    today: translate("crm.common.today"),
    yesterday: translate("crm.common.yesterday"),
  });

  return (
    <div
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
      data-deal-id={deal.id}
      className="cursor-pointer outline-none"
    >
      <article
        className={cn(
          "rounded-[10px] bg-card px-3.5 py-3 text-[13px] leading-snug shadow-card transition-all duration-200",
          snapshot?.isDragging
            ? "rotate-[1.5deg] shadow-[var(--shadow-soft)] ring-2 ring-brand-blue/50"
            : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-semibold">{patientName}</p>
          <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {date}
          </time>
        </div>
        <p className="mt-1 line-clamp-2 font-medium text-brand-link">
          {deal.name || service?.name || translate("crm.deals.untitled")}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {service ? (
              <span className="truncate rounded-full bg-brand-blue/15 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                {service.name}
              </span>
            ) : null}
          </div>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums">
            {formatMoney(deal.plan_amount, currency)}
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            {salesName ? (
              <>
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-yellow/60 text-[9px] font-bold text-foreground">
                  {initials(salesName)}
                </span>
                <span className="truncate">{salesName}</span>
              </>
            ) : (
              <span className="truncate">
                {translate("crm.deals.unassigned")}
              </span>
            )}
          </span>
          <TaskBadge state={taskState} />
        </div>
      </article>
    </div>
  );
};

const TaskBadge = ({
  state,
}: {
  state: ReturnType<typeof getDealTaskState>;
}) => {
  const translate = useTranslate();
  if (state === "no_task") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-medium text-[#b9801a] dark:text-brand-yellow">
        <span className="size-1.5 rounded-full bg-brand-yellow" />
        {translate("crm.deals.no_task")}
      </span>
    );
  }
  if (state === "overdue") {
    return (
      <span className="flex shrink-0 items-center gap-1 font-medium text-destructive">
        <span className="size-1.5 rounded-full bg-brand-red" />
        {translate("crm.deals.overdue_task")}
      </span>
    );
  }
  return null;
};

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
