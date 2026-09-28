import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import { Molar3D } from "../misc/Dental3D";
import type { CrmDataProvider } from "../providers/types";
import type { OrganizationSettings } from "../types";
import { CellInput } from "./PlanBits";
import { parseNumber } from "./planMath";

/**
 * Settings → «Справочники и поля» → «Прайс». Since stage 35 the price list
 * is a section of its own (/#/price-list); this keeps the limit of the
 * discount a manager may give in the treatment plans and leads to the
 * price list (old links to this section keep working).
 */
export const PriceListEditor = () => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-4">
      <MaxDiscount />
      <div className="flex flex-wrap items-center gap-5 rounded-[22px] bg-muted/60 p-5">
        <Molar3D className="h-14 shrink-0" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {translate("price_list.settings.text")}
        </p>
        <Button asChild>
          <Link to="/price-list">{translate("price_list.settings.open")}</Link>
        </Button>
      </div>
    </div>
  );
};

/** «Скидка без руководителя — до N %» (organization_settings) */
const MaxDiscount = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: settings } = useOrganizationSettings();
  const { mutate } = useMutation({
    mutationFn: (data: Partial<OrganizationSettings>) =>
      dataProvider.updateOrganizationSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["organization_settings"], data);
      notify("crm.settings.saved", { type: "info" });
    },
    onError: () => notify("crm.settings.save_error", { type: "error" }),
  });
  if (!settings) return null;
  const value = Number(settings.max_discount_percent ?? 10);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{translate("treatment.price_list.max_discount")}</span>
      <CellInput
        value={String(value).replace(".", ",")}
        label={translate("treatment.price_list.max_discount")}
        align="right"
        inputMode="decimal"
        className="w-14 border-border"
        onCommit={(raw) => {
          const next = Math.min(100, Math.max(0, parseNumber(raw, value)));
          if (next !== value) mutate({ max_discount_percent: next });
        }}
      />
      <span>%</span>
      <span className="text-xs text-muted-foreground">
        {translate("treatment.price_list.max_discount_hint")}
      </span>
    </div>
  );
};
