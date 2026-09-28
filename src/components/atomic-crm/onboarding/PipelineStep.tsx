import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import {
  getDefaultPipeline,
  getPipelineStages,
  useOrganizationSettings,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import { accent } from "../misc/accent";
import type { CrmDataProvider } from "../providers/types";
import {
  moveItem,
  useDictionaryMutations,
} from "../settings/useDictionaryMutations";
import type { AutomessageRule, OrganizationSettings, Sale } from "../types";

/**
 * Step «Воронка»: the stages of the default pipeline (rename, reorder or
 * keep) and the recommended automations — the reminder a day before the
 * visit, «Неразобранное», round robin among the invited employees.
 */
export const PipelineStep = () => {
  const translate = useTranslate();
  const { data: pipelines } = usePipelines();
  const { data: allStages } = useStages();
  const pipeline = getDefaultPipeline(pipelines);
  const stages = getPipelineStages(allStages, pipeline?.id);
  const { update } = useDictionaryMutations("stages");

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">
          {translate("onboarding.pipeline.stages")}
          {pipeline ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {pipeline.name}
            </span>
          ) : null}
        </h3>
        <ol className="flex flex-col gap-1.5">
          {stages.map((stage, index) => (
            <li key={stage.id} className="flex items-center gap-2">
              <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: accent(stage.color) }}
                aria-hidden
              />
              <Input
                key={`${stage.id}-${stage.name}`}
                defaultValue={stage.name}
                aria-label={translate("onboarding.pipeline.stage_name")}
                className="h-8"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== stage.name) {
                    update(stage, { name: value });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              {stage.kind !== "open" ? (
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {translate(`onboarding.pipeline.${stage.kind}`)}
                </span>
              ) : null}
              <div className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={index === 0}
                  onClick={() =>
                    moveItem(stages, stage.id, -1).forEach(
                      ([record, position]) => update(record, { position }),
                    )
                  }
                  aria-label={translate("crm.settings.move_up")}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={index === stages.length - 1}
                  onClick={() =>
                    moveItem(stages, stage.id, 1).forEach(
                      ([record, position]) => update(record, { position }),
                    )
                  }
                  aria-label={translate("crm.settings.move_down")}
                >
                  <ArrowDown className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <Automations />
    </div>
  );
};

const Automations = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: settings } = useOrganizationSettings();
  const { data: rules = [] } = useGetList<AutomessageRule>(
    "automessage_rules",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "position", order: "ASC" },
    },
  );
  const { data: sales = [] } = useGetList<Sale>("sales", {
    filter: { "disabled@neq": true },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const [updateRule] = useUpdate<AutomessageRule>();
  const saveSettings = useMutation({
    mutationFn: (data: Partial<OrganizationSettings>) =>
      dataProvider.updateOrganizationSettings(data),
    onSuccess: (data) => {
      queryClient.setQueryData(["organization_settings"], data);
      notify("onboarding.pipeline.saved", { type: "info" });
    },
    onError: () => notify("onboarding.save_error", { type: "error" }),
  });
  if (!settings) return null;

  const reminder = rules.find((rule) => rule.timing === "before_visit");
  const employees = sales.filter((sale) => sale.role !== "owner");
  const roundRobin = settings.lead_distribution === "round_robin";

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">
        {translate("onboarding.pipeline.automations")}
      </h3>
      <Toggle
        id="onboarding-reminder"
        label={translate("onboarding.pipeline.reminder")}
        hint={translate(
          reminder
            ? "onboarding.pipeline.reminder_hint"
            : "onboarding.pipeline.reminder_missing",
        )}
        checked={!!reminder?.is_active}
        disabled={!reminder}
        onChange={(is_active) =>
          reminder &&
          updateRule(
            "automessage_rules",
            { id: reminder.id, data: { is_active }, previousData: reminder },
            {
              mutationMode: "pessimistic",
              onSuccess: () =>
                notify("onboarding.pipeline.saved", { type: "info" }),
              onError: () => notify("onboarding.save_error", { type: "error" }),
            },
          )
        }
      />
      <Toggle
        id="onboarding-unsorted"
        label={translate("onboarding.pipeline.unsorted")}
        hint={translate("onboarding.pipeline.unsorted_hint")}
        checked={!!settings.unsorted_enabled}
        onChange={(unsorted_enabled) =>
          saveSettings.mutate({ unsorted_enabled })
        }
      />
      <Toggle
        id="onboarding-round-robin"
        label={translate("onboarding.pipeline.round_robin")}
        hint={
          employees.length || roundRobin ? (
            <>
              {translate("onboarding.pipeline.round_robin_hint")}
              {employees.length ? (
                <span className="text-foreground">
                  {" "}
                  {employees
                    .map((sale) => `${sale.first_name} ${sale.last_name}`)
                    .join(", ")}
                </span>
              ) : null}
            </>
          ) : (
            translate("onboarding.pipeline.round_robin_none")
          )
        }
        checked={roundRobin}
        disabled={!employees.length && !roundRobin}
        onChange={(checked) =>
          saveSettings.mutate(
            checked
              ? {
                  lead_distribution: "round_robin",
                  lead_distribution_sales_ids: employees.map((sale) => sale.id),
                }
              : { lead_distribution: "off" },
          )
        }
      />
    </section>
  );
};

const Toggle = ({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <div className="flex items-start gap-3 rounded-md border bg-card px-4 py-3">
    <Switch
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      className="mt-0.5"
    />
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="cursor-pointer text-sm font-medium">
        {label}
      </label>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  </div>
);
