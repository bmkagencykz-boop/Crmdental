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
            "rounded-[4px] border bg-card px-3 py-2.5 text-[13px] leading-snug transition-colors",
            snapshot?.isDragging
              ? "border-brand-blue shadow-md"
              : "border-border hover:border-brand-blue/60",
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <PatientName contactId={deal.contact_ids?.[0]} />
            <time className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {date}
            </time>
          </div>
          {salesName ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {salesName}
            </p>
          ) : null}
          <p className="mt-1.5 line-clamp-2 text-brand-link">{deal.name}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            {category ? (
              <span className="truncate rounded-[3px] border border-border px-1.5 py-px text-[11px] text-muted-foreground">
                {category.label}
              </span>
            ) : (
              <span />
            )}
            <span className="shrink-0 text-xs font-medium tabular-nums">
              {formatMoney(deal.amount, currency)}
            </span>
          </div>
        </article>
      </RecordContextProvider>
    </div>
  );
};

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
