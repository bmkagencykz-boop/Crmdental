import { useTranslate, type Identifier } from "ra-core";

import { useFormatWaiting, useOverdueDeal } from "./useWaitingDeals";

/** Red «Ждёт ответа 23 мин» on a board card, past the clinic's limit */
export const WaitingBadge = ({ dealId }: { dealId: Identifier }) => {
  const translate = useTranslate();
  const format = useFormatWaiting();
  const waiting = useOverdueDeal(dealId);
  if (!waiting) return null;
  return (
    <p
      className="mt-1 flex w-fit items-center gap-1 rounded-sm bg-brand-red/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-red"
      data-testid="waiting-badge"
    >
      {translate("notifications.waiting.badge", {
        time: format(waiting.waiting_minutes),
      })}
    </p>
  );
};
