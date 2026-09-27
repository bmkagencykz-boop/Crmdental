import { useGetList, useTranslate, type Identifier } from "ra-core";

import { splitMinutes } from "../providers/commons/responseTime";
import type { DealWaiting } from "../types";

/**
 * Deals whose patient waits for an answer longer than the clinic's limit
 * (view deals_waiting), the longest wait first. One query shared by every
 * card of the board and the dashboard.
 */
export const useOverdueDeals = () =>
  useGetList<DealWaiting>(
    "deals_waiting",
    {
      filter: { overdue: true },
      sort: { field: "waiting_minutes", order: "DESC" },
      pagination: { page: 1, perPage: 500 },
    },
    { refetchInterval: 30_000 },
  );

export const useOverdueDeal = (dealId: Identifier) => {
  const { data } = useOverdueDeals();
  return data?.find((row) => String(row.id) === String(dealId));
};

/** "23 мин", "1 ч 5 мин" */
export const useFormatWaiting = () => {
  const translate = useTranslate();
  return (total: number) => {
    const { hours, minutes } = splitMinutes(Math.max(0, total));
    return hours
      ? translate("notifications.waiting.hours", { hours, minutes })
      : translate("notifications.waiting.minutes", { minutes });
  };
};
