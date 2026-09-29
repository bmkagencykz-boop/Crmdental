import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import { useOrganizationSettings } from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import type { OrganizationSettings } from "../types";

const VISIBILITY: OrganizationSettings["manager_deal_visibility"][] = [
  "all",
  "own_and_unassigned",
  "own",
];
const MOVE_MODES: OrganizationSettings["pipeline_move_mode"][] = [
  "first_stage",
  "choose_stage",
];

/** Clinic rules: which deals administrators see, moving between pipelines */
export const AccessSettings = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { data: settings } = useOrganizationSettings();
  const { mutate } = useMutation({
    mutationFn: (data: Partial<OrganizationSettings>) =>
      dataProvider.updateOrganizationSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["organization_settings"], data);
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      notify("crm.settings.saved", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  if (!settings) return null;

  return (
    <div className="flex flex-col gap-5">
      <Choice
        title={translate("crm.settings.access.visibility")}
        value={settings.manager_deal_visibility}
        options={VISIBILITY.map((value) => ({
          value,
          label: translate(`crm.settings.access.visibility_${value}`),
        }))}
        onChange={(manager_deal_visibility) =>
          mutate({ manager_deal_visibility })
        }
      />
      <Choice
        title={translate("crm.settings.access.pipeline_move")}
        value={settings.pipeline_move_mode}
        options={MOVE_MODES.map((value) => ({
          value,
          label: translate(`crm.settings.access.pipeline_move_${value}`),
        }))}
        onChange={(pipeline_move_mode) => mutate({ pipeline_move_mode })}
      />
      {/* Stage 42: administrators record expenses of the cash desk */}
      <Choice
        title={translate("cash_out.settings.managers")}
        value={settings.manager_cash_expenses ? "yes" : "no"}
        options={(["no", "yes"] as const).map((value) => ({
          value,
          label: translate(`cash_out.settings.${value}`),
        }))}
        onChange={(value) =>
          mutate({ manager_cash_expenses: value === "yes" })
        }
      />
    </div>
  );
};

export const Choice = <T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) => (
  <fieldset className="flex flex-col gap-2">
    <legend className="mb-2 text-sm text-muted-foreground">{title}</legend>
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 rounded-md border px-3 text-sm font-medium transition-colors",
            value === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-card hover:bg-[var(--surface-strong)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  </fieldset>
);
