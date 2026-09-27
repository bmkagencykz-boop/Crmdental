import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { cn } from "@/lib/utils";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import type { OrganizationSettings, Sale } from "../types";
import { Choice } from "./AccessSettings";

const MODES: OrganizationSettings["lead_distribution"][] = [
  "off",
  "round_robin",
  "first_response",
];

/**
 * Who gets a new lead coming from a messenger or a website form (spec §5):
 * nobody (the head assigns), each chosen employee in turn, or the first
 * chosen employee who answers.
 */
export const DistributionSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: settings } = useOrganizationSettings();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    filter: { "disabled@neq": true },
    sort: { field: "last_name", order: "ASC" },
    pagination: { page: 1, perPage: 100 },
  });
  const { mutate } = useMutation({
    mutationFn: (data: Partial<OrganizationSettings>) =>
      dataProvider.updateOrganizationSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["organization_settings"], data);
      notify("crm.settings.saved", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });
  if (!settings) return null;

  const chosen = settings.lead_distribution_sales_ids ?? [];
  const toggle = (id: Identifier) =>
    mutate({
      lead_distribution_sales_ids: chosen.some((c) => String(c) === String(id))
        ? chosen.filter((c) => String(c) !== String(id))
        : [...chosen, id],
    });

  return (
    <div className="flex flex-col gap-8">
      <Choice
        title={translate("crm.settings.distribution.mode")}
        value={settings.lead_distribution}
        options={MODES.map((value) => ({
          value,
          label: translate(`crm.settings.distribution.modes.${value}`),
        }))}
        onChange={(lead_distribution) => mutate({ lead_distribution })}
      />
      {settings.lead_distribution !== "off" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">
            {translate("crm.settings.distribution.employees")}
          </legend>
          <p className="text-xs text-muted-foreground">
            {translate(
              settings.lead_distribution === "round_robin"
                ? "crm.settings.distribution.round_robin_hint"
                : "crm.settings.distribution.first_response_hint",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {sales.map((sale) => {
              const active = chosen.some((c) => String(c) === String(sale.id));
              return (
                <button
                  key={sale.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => toggle(sale.id)}
                  className={cn(
                    "rounded-md px-4 py-2 text-sm font-medium transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "soft hover:bg-card",
                  )}
                >
                  {sale.first_name} {sale.last_name}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
};
