import { Trash2 } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  getPipelineStages,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import { TASK_TYPES } from "../tasks/taskTypes";
import type { TaskRule } from "../types";
import { useDictionaryMutations } from "./useDictionaryMutations";

const UNITS = [
  { key: "minutes", minutes: 1 },
  { key: "hours", minutes: 60 },
  { key: "days", minutes: 24 * 60 },
] as const;

/** "90 minutes" as 90 minutes, "1 day" as 1 day: the largest exact unit */
export const splitDelay = (minutes: number) => {
  const unit =
    [...UNITS]
      .reverse()
      .find((u) => minutes > 0 && minutes % u.minutes === 0) ?? UNITS[0];
  return { amount: minutes / unit.minutes, unit: unit.key };
};

/**
 * Tasks created on their own (spec §6): when a deal is created, or when it
 * enters a stage. The task goes to the responsible of the deal.
 */
export const TaskRulesEditor = () => {
  const translate = useTranslate();
  const { data: rules = [] } = useGetList<TaskRule>("task_rules", {
    sort: { field: "position", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });
  const { create } = useDictionaryMutations("task_rules");

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} />
      ))}
      <div>
        <Button
          variant="outline"
          onClick={() =>
            create({
              event: "deal_created",
              type: "call",
              text: translate("crm.settings.automations.default_text"),
              due_in_minutes: 60,
              position: rules.length,
            })
          }
        >
          {translate("crm.settings.automations.add")}
        </Button>
      </div>
    </div>
  );
};

const RuleRow = ({ rule }: { rule: TaskRule }) => {
  const translate = useTranslate();
  const { update, remove } = useDictionaryMutations("task_rules");
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const delay = splitDelay(rule.due_in_minutes);
  const when =
    rule.event === "deal_created" ? "deal_created" : String(rule.stage_id);

  return (
    <div className="flex flex-col gap-3 rounded-md bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={when}
          onValueChange={(value) =>
            update(
              rule,
              value === "deal_created"
                ? { event: "deal_created", stage_id: null }
                : { event: "stage_entered", stage_id: Number(value) },
            )
          }
        >
          <SelectTrigger
            className="w-96 max-w-full"
            aria-label={translate("crm.settings.automations.when")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deal_created">
              {translate("crm.settings.automations.deal_created")}
            </SelectItem>
            {pipelines.flatMap((pipeline) =>
              getPipelineStages(stages, pipeline.id).map((stage) => (
                <SelectItem key={stage.id} value={String(stage.id)}>
                  {translate("crm.settings.automations.stage_entered", {
                    stage:
                      pipelines.length > 1
                        ? `${pipeline.name} · ${stage.name}`
                        : stage.name,
                  })}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
        <Select
          value={rule.type}
          onValueChange={(type) => update(rule, { type })}
        >
          <SelectTrigger
            className="w-40"
            aria-label={translate("resources.tasks.fields.type")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {translate(`crm.tasks.types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {translate("crm.settings.automations.due_in")}
        </span>
        <Input
          key={`${rule.id}-${rule.due_in_minutes}`}
          type="number"
          min={0}
          defaultValue={delay.amount}
          className="w-20"
          aria-label={translate("crm.settings.automations.due_in")}
          onBlur={(event) => {
            const amount = Math.max(0, Number(event.target.value) || 0);
            const unit = UNITS.find((u) => u.key === delay.unit)!;
            if (amount * unit.minutes !== rule.due_in_minutes) {
              update(rule, { due_in_minutes: amount * unit.minutes });
            }
          }}
        />
        <Select
          value={delay.unit}
          onValueChange={(key) =>
            update(rule, {
              due_in_minutes:
                delay.amount * UNITS.find((u) => u.key === key)!.minutes,
            })
          }
        >
          <SelectTrigger
            className="w-28"
            aria-label={translate("crm.settings.automations.unit")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((unit) => (
              <SelectItem key={unit.key} value={unit.key}>
                {translate(`crm.settings.automations.units.${unit.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={rule.is_active}
            onCheckedChange={(is_active) => update(rule, { is_active })}
            aria-label={translate("crm.settings.active")}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => remove(rule)}
            aria-label={translate("ra.action.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <Input
        key={`${rule.id}-${rule.text}`}
        defaultValue={rule.text}
        aria-label={translate("crm.settings.automations.text")}
        onBlur={(event) => {
          const text = event.target.value.trim();
          if (text && text !== rule.text) update(rule, { text });
        }}
      />
    </div>
  );
};
