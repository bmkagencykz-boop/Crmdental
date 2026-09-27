import { Draggable } from "@hello-pangea/dnd";
import {
  RecordContextProvider,
  useGetManyAggregate,
  useRedirect,
  useTranslate,
} from "ra-core";
import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Contact, Deal } from "../types";
import { formatCardDate, formatMoney } from "./kanbanFormat";

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
 * Compact amoCRM-like card: patient and date, responsible, deal link,
 * then service and amount.
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
  const { dealCategories, currency } = useConfigurationContext();
  const translate = useTranslate();
  const redirect = useRedirect();
  const handleClick = () => {
    redirect(`/deals/${deal.id}/show`, undefined, undefined, undefined, {
      _scrollToTop: false,
    });
  };
  const salesName = useGetSalesName(deal.sales_id);
  const category = dealCategories.find((c) => c.value === deal.category);
  const date = formatCardDate(deal.created_at, {
    today: translate("crm.common.today", { _: "Сегодня" }),
    yesterday: translate("crm.common.yesterday", { _: "Вчера" }),
  });

  return (
    <div
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      ref={provided?.innerRef}
      onClick={handleClick}
      className="cursor-pointer outline-none"
    >
      <RecordContextProvider value={deal}>
        <article
          className={cn(
            "rounded-[10px] bg-card px-3.5 py-3 text-[13px] leading-snug shadow-card transition-all duration-200",
            snapshot?.isDragging
              ? "rotate-[1.5deg] shadow-[var(--shadow-soft)] ring-2 ring-brand-blue/50"
              : "hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]",
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <PatientName contactId={deal.contact_ids?.[0]} />
            <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {date}
            </time>
          </div>
          <p className="mt-1 line-clamp-2 font-medium text-brand-link">
            {deal.name}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              {category ? (
                <span className="truncate rounded-full bg-brand-blue/15 px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                  {category.label}
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-[13px] font-semibold tabular-nums">
              {formatMoney(deal.amount, currency)}
            </span>
          </div>
          {salesName ? (
            <div className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2.5 text-xs text-muted-foreground">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-yellow/60 text-[9px] font-bold text-foreground">
                {initials(salesName)}
              </span>
              <span className="truncate">{salesName}</span>
            </div>
          ) : null}
        </article>
      </RecordContextProvider>
    </div>
  );
};

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

const PatientName = ({ contactId }: { contactId?: Contact["id"] }) => {
  const { data } = useGetManyAggregate<Contact>(
    "contacts",
    { ids: contactId != null ? [contactId] : [] },
    { enabled: contactId != null },
  );
  const contact = data?.[0];
  const name = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(" ")
    : "—";
  return <p className="truncate font-semibold">{name}</p>;
};
