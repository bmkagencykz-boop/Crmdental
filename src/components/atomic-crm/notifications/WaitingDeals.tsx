import { Flame } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";

import { useGetSalesName } from "../sales/useGetSalesName";
import type { DealWaiting } from "../types";
import { useFormatWaiting, useOverdueDeals } from "./useWaitingDeals";

/**
 * Dashboard widget «Ждут ответа»: the deals whose patient waits longer than
 * the clinic's limit, the longest wait first.
 */
export const WaitingDeals = () => {
  const translate = useTranslate();
  const { data = [], isPending } = useOverdueDeals();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <Flame className="mr-3 size-4 text-brand-red" />
        <h2 className="text-[15px] font-semibold text-foreground">
          {translate("notifications.waiting.title")}
        </h2>
        {data.length ? (
          <span className="ml-2 rounded-sm bg-brand-red/10 px-1.5 text-xs font-bold text-brand-red">
            {data.length}
          </span>
        ) : null}
      </div>
      <Card className="py-0">
        {isPending ? null : data.length ? (
          <ul
            className="divide-y divide-border"
            aria-label={translate("notifications.waiting.title")}
          >
            {data.slice(0, 10).map((row) => (
              <WaitingDealRow key={row.id} row={row} />
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {translate("notifications.waiting.empty")}
          </p>
        )}
      </Card>
    </div>
  );
};

const WaitingDealRow = ({ row }: { row: DealWaiting }) => {
  const translate = useTranslate();
  const format = useFormatWaiting();
  const salesName = useGetSalesName(row.sales_id ?? undefined, {
    enabled: row.sales_id != null,
  });
  const patient =
    [row.patient_last_name, row.patient_first_name].filter(Boolean).join(" ") ||
    row.patient_phone ||
    "—";
  return (
    <li>
      <Link
        to={`/deals/${row.id}/show`}
        className="flex items-center justify-between gap-3 px-4 py-2.5 no-underline transition-colors hover:bg-accent"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-brand-link">
            {patient}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {salesName || translate("crm.deals.unassigned")}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-brand-red">
          {format(row.waiting_minutes)}
        </span>
      </Link>
    </li>
  );
};
