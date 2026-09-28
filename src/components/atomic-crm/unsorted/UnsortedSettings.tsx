import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  useLeadSources,
  useOrganizationSettings,
} from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import type { OrganizationSettings } from "../types";

/**
 * Settings → «Неразобранное» (owner and head): new leads of the system
 * channels wait to be accepted, optionally only for some sources.
 */
export const UnsortedSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: settings } = useOrganizationSettings();
  const { data: sources } = useLeadSources();
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

  const enabled = !!settings.unsorted_enabled;
  const chosen = settings.unsorted_source_ids ?? [];
  const toggleSource = (id: Identifier) =>
    mutate({
      unsorted_source_ids: chosen.some((c) => String(c) === String(id))
        ? chosen.filter((c) => String(c) !== String(id))
        : [...chosen, id],
    });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch
            id="unsorted-enabled"
            checked={enabled}
            onCheckedChange={(unsorted_enabled) => mutate({ unsorted_enabled })}
          />
          <Label htmlFor="unsorted-enabled">
            {translate("unsorted.settings.enabled")}
          </Label>
        </div>
        <p className="max-w-2xl text-xs text-muted-foreground">
          {translate("unsorted.settings.enabled_hint")}
        </p>
      </div>
      <fieldset
        className={cn(
          "flex flex-col gap-3",
          enabled ? "" : "pointer-events-none opacity-50",
        )}
      >
        <legend className="mb-1 text-sm font-semibold">
          {translate("unsorted.settings.sources")}
        </legend>
        <p className="text-xs text-muted-foreground">
          {translate("unsorted.settings.sources_hint")}
        </p>
        <div className="flex flex-wrap gap-2">
          {sources
            .filter(
              (source) =>
                !source.is_archived ||
                chosen.some((c) => String(c) === String(source.id)),
            )
            .map((source) => {
              const active = chosen.some(
                (c) => String(c) === String(source.id),
              );
              return (
                <button
                  key={source.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  onClick={() => toggleSource(source.id)}
                  className={cn(
                    "rounded-md px-4 py-2 text-sm font-medium transition-all",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "soft hover:bg-card",
                  )}
                >
                  {source.name}
                </button>
              );
            })}
        </div>
      </fieldset>
    </div>
  );
};
