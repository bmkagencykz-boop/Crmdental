import { useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { findById, useLeadSources } from "../dictionaries/useDictionaries";
import { InlineField } from "../deals/page/InlineField";
import { useDealUpdate } from "../deals/page/useDealUpdate";
import type { Deal } from "../types";
import {
  ATTRIBUTION_FIELDS,
  attributionSummary,
  type AttributionField,
} from "./marketingMath";

/**
 * «Источник/UTM» of the deal page (stage 32): the source and the UTM tags of
 * the website form, one line folded; unfolded, every tag, the referrer and
 * the landing page are edited in place.
 */
export const DealAttribution = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const { save } = useDealUpdate(deal);
  const { data: sources } = useLeadSources();
  const summary = attributionSummary(deal);
  const sourceName = findById(sources, deal.source_id)?.name;

  return (
    <section
      className="flex flex-col gap-2 border-t border-border px-5 py-4"
      data-testid="deal-attribution"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {translate("marketing.deal.title")}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 rounded-md px-2 text-xs"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {translate(open ? "marketing.deal.hide" : "marketing.deal.show")}
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col">
          {ATTRIBUTION_FIELDS.map((field: AttributionField) => (
            <InlineField
              key={field}
              label={translate(`marketing.deal.fields.${field}`)}
              value={deal[field] ?? null}
              display={
                (field === "referrer" || field === "landing_page") &&
                deal[field] ? (
                  <span className="break-all">{deal[field]}</span>
                ) : undefined
              }
              editor={{ kind: "text" }}
              onSave={(value) =>
                save({ [field]: (value as string | null) || null })
              }
            />
          ))}
        </div>
      ) : (
        <p className="truncate text-xs text-muted-foreground">
          {[sourceName, summary].filter(Boolean).join(" · ") ||
            translate("marketing.deal.empty")}
        </p>
      )}
    </section>
  );
};
