import { useGetList, useTranslate } from "ra-core";
import { Checkbox } from "@/components/ui/checkbox";

import { useDictionaryMutations } from "../settings/useDictionaryMutations";
import type { Deal, DealChecklistCheck, StageChecklistItem } from "../types";

/**
 * What must be done at the current stage (spec §6). Until every item is
 * checked the database refuses to move the deal further.
 */
export const StageChecklist = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { data: items = [] } = useGetList<StageChecklistItem>(
    "stage_checklist_items",
    {
      filter: { stage_id: deal.stage_id },
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 100 },
    },
  );
  const { data: checks = [] } = useGetList<DealChecklistCheck>(
    "deal_checklist_checks",
    {
      filter: { deal_id: deal.id },
      pagination: { page: 1, perPage: 500 },
      sort: { field: "id", order: "ASC" },
    },
  );
  const { create, remove } = useDictionaryMutations("deal_checklist_checks");
  if (!items.length) return null;

  const done = items.filter((item) =>
    checks.some((check) => String(check.item_id) === String(item.id)),
  ).length;

  return (
    <section className="rounded-lg bg-muted/60 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">
          {translate("crm.deals.checklist.title")}
        </h3>
        <span
          className={
            done === items.length
              ? "text-xs font-semibold text-brand-lime"
              : "text-xs font-semibold text-muted-foreground"
          }
        >
          {translate("crm.deals.checklist.progress", {
            done,
            total: items.length,
          })}
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => {
          const check = checks.find(
            (c) => String(c.item_id) === String(item.id),
          );
          const id = `checklist-${item.id}`;
          return (
            <li key={item.id} className="flex items-start gap-2.5 text-sm">
              <Checkbox
                id={id}
                checked={!!check}
                onCheckedChange={() =>
                  check
                    ? remove(check)
                    : create({ deal_id: deal.id, item_id: item.id })
                }
                className="mt-0.5"
              />
              <label
                htmlFor={id}
                className={check ? "text-muted-foreground line-through" : ""}
              >
                {item.text}
              </label>
            </li>
          );
        })}
      </ul>
      {done < items.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {translate("crm.deals.checklist.hint")}
        </p>
      ) : null}
    </section>
  );
};
