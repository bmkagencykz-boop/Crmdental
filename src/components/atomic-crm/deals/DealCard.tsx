import { Draggable } from "@hello-pangea/dnd";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { useRedirect, useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import {
  findById,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { accent, onAccent } from "../misc/accent";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { useGetSalesName } from "../sales/useGetSalesName";
import { useTags } from "../tags/useTags";
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
  const { data: stages } = useStages();
  const { data: allTags } = useTags();
  const tags = (deal.tags ?? [])
    .map((id) => allTags?.find((tag) => tag.id === id))
    .filter((tag) => tag != null);
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
  const color = accent(findById(stages, deal.stage_id)?.color);
  // Avatar: the state of the deal first (overdue, no task), else its stage
  const avatarColor =
    taskState === "overdue"
      ? "#FF453A"
      : taskState === "no_task"
        ? "#FFE500"
        : color;
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
          "relative overflow-hidden rounded-[1.75rem] bg-pill py-2.5 pr-4 pl-2.5 text-[13px] leading-snug transition-all duration-200",
          snapshot?.isDragging
            ? "rotate-[1.5deg] ring-2 ring-white/40"
            : "hover:bg-[#242427]",
        )}
      >
        {/* Paid part of the treatment plan, like the progress lines of the reference */}
        {deal.plan_amount > 0 ? (
          <span
            className="absolute top-0 left-6 h-[3px] rounded-b-full"
            style={{
              width: `calc(${Math.min(100, Math.round((deal.paid_amount / deal.plan_amount) * 100))}% - 3rem)`,
              backgroundColor: color,
            }}
            aria-hidden
          />
        ) : null}
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
            style={{
              backgroundColor: avatarColor,
              color: onAccent(avatarColor),
            }}
            aria-hidden
          >
            {initials(patientName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[14px] font-semibold">
                {patientName}
              </p>
              <span className="flex shrink-0 items-center gap-1.5">
                {deal.nb_unread_messages ? (
                  <span
                    className="flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full bg-brand-lime px-1.5 text-[11px] font-bold text-black"
                    title={translate("crm.messages.unread", {
                      smart_count: deal.nb_unread_messages,
                    })}
                    aria-label={translate("crm.messages.unread", {
                      smart_count: deal.nb_unread_messages,
                    })}
                  >
                    <MessageCircle className="size-3" />
                    {deal.nb_unread_messages}
                  </span>
                ) : null}
                <ArrowUpRight
                  className="size-4 text-foreground/80"
                  aria-hidden
                />
              </span>
            </div>
            <p className="truncate text-[12px] text-muted-foreground">
              {deal.name || service?.name || translate("crm.deals.untitled")}
              {" · "}
              <span className="tabular-nums text-foreground/80">
                {formatMoney(deal.plan_amount, currency)}
              </span>
            </p>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                <span className="truncate">
                  {salesName || translate("crm.deals.unassigned")}
                </span>
                {tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag.id}
                    className="shrink-0 rounded-full px-1.5 text-[10px] font-semibold text-black"
                    style={{ backgroundColor: accent(tag.color) }}
                  >
                    {tag.name}
                  </span>
                ))}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <TaskBadge state={taskState} />
                {taskState === "ok" || taskState === "closed" ? (
                  <time className="tabular-nums">{date}</time>
                ) : null}
              </span>
            </div>
          </div>
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
      <span className="rounded-full bg-brand-yellow px-1.5 font-semibold text-black">
        {translate("crm.deals.no_task")}
      </span>
    );
  }
  if (state === "overdue") {
    return (
      <span className="rounded-full bg-brand-red px-1.5 font-semibold text-white">
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
