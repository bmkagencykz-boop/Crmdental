import { Draggable } from "@hello-pangea/dnd";

import { useCanAccess, useRedirect, useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import {
  findById,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { accent, NO_TASK_COLOR, onAccent, OVERDUE_COLOR } from "../misc/accent";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { formatPhone } from "../misc/formatPhone";
import { useGetSalesName } from "../sales/useGetSalesName";
import { useTags } from "../tags/useTags";
import type { Deal } from "../types";
import { formatCardDate, formatMoney } from "./kanbanFormat";
import { getDealTaskState } from "./taskState";
import { WaitingBadge } from "../notifications/WaitingBadge";
import { cardFields } from "../custom-fields/customFields";
import {
  useCustomFields,
  useCustomValueText,
} from "../custom-fields/useCustomFields";

export const DealCard = ({ deal, index }: { deal: Deal; index: number }) => {
  // The integrator (stage 25) only reads the deals: no drag; the access
  // rights (stage 30) may keep the edit to the employee's own deals
  const { canAccess: canEdit } = useCanAccess({
    resource: "deals",
    action: "edit",
    record: deal,
  });
  if (!deal) return null;

  return (
    <Draggable
      draggableId={String(deal.id)}
      index={index}
      isDragDisabled={canEdit === false}
    >
      {(provided, snapshot) => (
        <DealCardContent provided={provided} snapshot={snapshot} deal={deal} />
      )}
    </Draggable>
  );
};

/**
 * amoCRM-like card: patient (link color) and date, deal, amount, responsible,
 * and the task control of the spec (no task / overdue) in text and in the
 * left strip.
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
    formatPhone(deal.patient_phone) ||
    "—";
  const taskState = getDealTaskState(deal);
  const color = accent(findById(stages, deal.stage_id)?.color);
  const date = formatCardDate(deal.created_at, {
    today: translate("crm.common.today"),
    yesterday: translate("crm.common.yesterday"),
  });
  // Left strip: the state of the deal first (overdue, no task), else its stage
  const stripColor =
    taskState === "overdue"
      ? OVERDUE_COLOR
      : taskState === "no_task"
        ? NO_TASK_COLOR
        : color;

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
          "relative overflow-hidden rounded-md border border-border bg-pill py-2 pr-2.5 pl-3.5 text-[13px] leading-snug shadow-card transition-colors",
          snapshot?.isDragging
            ? "rotate-[1.5deg] ring-2 ring-primary/50"
            : "hover:bg-pill-hover",
        )}
      >
        <span
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: stripColor }}
          aria-hidden
        />
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-semibold text-brand-link">
            {patientName}
          </p>
          <span className="flex shrink-0 items-center gap-1.5">
            {deal.nb_unread_messages ? (
              <span
                className="flex h-[18px] min-w-[18px] items-center justify-center gap-0.5 rounded-sm bg-primary px-1 text-[11px] font-bold text-primary-foreground"
                title={translate("crm.messages.unread", {
                  smart_count: deal.nb_unread_messages,
                })}
                aria-label={translate("crm.messages.unread", {
                  smart_count: deal.nb_unread_messages,
                })}
              >
                {deal.nb_unread_messages}
              </span>
            ) : null}
            <time className="text-[11px] tabular-nums text-muted-foreground">
              {date}
            </time>
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {deal.name || service?.name || translate("crm.deals.untitled")}
          {deal.doctor_name ? (
            <span
              className="text-[11px]"
              title={translate("resources.deals.fields.doctor_id")}
            >
              {" · "}
              {deal.doctor_name}
            </span>
          ) : null}
        </p>
        <CardCustomFields deal={deal} />
        <WaitingBadge dealId={deal.id} />
        {deal.plan_amount > 0 ? (
          <p className="mt-0.5 text-[13px] font-semibold tabular-nums">
            {formatMoney(deal.plan_amount, currency)}
            {deal.paid_amount > 0 ? (
              <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">
                {translate("crm.deals.paid_short", {
                  amount: formatMoney(deal.paid_amount, currency),
                })}
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <span className="truncate">
              {salesName || translate("crm.deals.unassigned")}
            </span>
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="shrink-0 rounded-sm px-1 text-[10px] font-semibold"
                style={{
                  backgroundColor: tag.color,
                  color: onAccent(tag.color),
                }}
              >
                {tag.name}
              </span>
            ))}
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
      <span className="shrink-0 font-semibold text-warn">
        {translate("crm.deals.no_task")}
      </span>
    );
  }
  if (state === "overdue") {
    return (
      <span className="shrink-0 font-semibold text-brand-red">
        {translate("crm.deals.overdue_task")}
      </span>
    );
  }
  return null;
};

/**
 * The custom fields the clinic chose for the card (Settings → Поля, two at
 * most, stage 19), in small text: «Откуда узнал: Инстаграм · Есть снимок
 * КТ: Да». Empty fields are not shown.
 */
const CardCustomFields = ({ deal }: { deal: Deal }) => {
  const { data: fields } = useCustomFields();
  const text = useCustomValueText();
  const shown = cardFields(fields)
    .map((field) => ({
      field,
      value: text(field, deal.custom_values?.[String(field.id)]),
    }))
    .filter(({ value }) => value != null);
  if (!shown.length) return null;
  return (
    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
      {shown.map(({ field, value }, index) => (
        <span key={field.id} data-card-field={field.id}>
          {index > 0 ? " · " : null}
          {field.name}: <span className="text-foreground/80">{value}</span>
        </span>
      ))}
    </p>
  );
};
