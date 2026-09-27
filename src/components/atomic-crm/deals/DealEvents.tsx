import { useTranslate } from "ra-core";

import { findById, useStages } from "../dictionaries/useDictionaries";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { DealEvent } from "../types";
import { formatMoney } from "./kanbanFormat";

const MONEY_FIELDS = ["plan_amount", "paid_amount"];

/** One entry of the deal log: date, author, stage change, changed fields */
export const DealEventContent = ({ event }: { event: DealEvent }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const author = useGetSalesName(event.sales_id ?? undefined, {
    enabled: event.sales_id != null,
  });
  const stageName = (id: DealEvent["to_stage_id"]) =>
    findById(stages, id)?.name ?? "—";
  const changedFields = Object.keys(event.changes ?? {});

  return (
    <div className="text-sm">
      <p className="text-xs text-muted-foreground">
        {new Date(event.created_at).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
        {author ? ` · ${author}` : ` · ${translate("crm.deals.events.system")}`}
      </p>
      {event.type === "created" ? (
        <p>
          {translate("crm.deals.events.created", {
            stage: stageName(event.to_stage_id),
          })}
        </p>
      ) : null}
      {event.type === "stage_changed" ? (
        <p>
          {translate("crm.deals.events.stage_changed")}{" "}
          <span className="text-muted-foreground">
            {stageName(event.from_stage_id)}
          </span>{" "}
          →{" "}
          <span className="font-semibold">{stageName(event.to_stage_id)}</span>
        </p>
      ) : null}
      {changedFields.length ? (
        <ul className="mt-0.5 text-muted-foreground">
          {changedFields.map((field) => {
            const [before, after] = event.changes[field];
            return (
              <li key={field}>
                {translate(`resources.deals.fields.${field}`)}
                {MONEY_FIELDS.includes(field)
                  ? `: ${formatMoney(Number(before ?? 0), currency)} → ${formatMoney(Number(after ?? 0), currency)}`
                  : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};
