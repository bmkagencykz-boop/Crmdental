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
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { useDictionaryMutations } from "../settings/useDictionaryMutations";
import type { MessageTemplate } from "../types";
import type { RecallRule } from "./types";

const NONE = "none";

/**
 * Settings → Повторные продажи: rules "a deal won (of a service) → N months
 * later a new deal", optionally with a message to the patient.
 */
export const RecallRulesSettings = () => {
  const translate = useTranslate();
  const { data: rules = [] } = useGetList<RecallRule>("recall_rules", {
    sort: { field: "position", order: "ASC" },
    pagination: { page: 1, perPage: 200 },
  });
  const { create } = useDictionaryMutations("recall_rules");
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const pipeline = pipelines.find((p) => p.is_default) ?? pipelines[0];
  const firstStage = pipeline
    ? getPipelineStages(stages, pipeline.id)[0]
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {translate("recalls.settings.how")}
      </p>
      {rules.map((rule) => (
        <RecallRuleRow key={rule.id} rule={rule} />
      ))}
      <div>
        <Button
          variant="outline"
          disabled={!pipeline || !firstStage}
          onClick={() =>
            create({
              name: translate("recalls.settings.new_rule_name"),
              service_id: null,
              delay_months: 6,
              pipeline_id: pipeline!.id,
              stage_id: firstStage!.id,
              deal_service_id: null,
              template_id: null,
              message_mode: "confirm",
              is_active: false,
              position: rules.length,
            })
          }
        >
          {translate("recalls.settings.add_rule")}
        </Button>
      </div>
    </div>
  );
};

const RecallRuleRow = ({ rule }: { rule: RecallRule }) => {
  const translate = useTranslate();
  const { update, remove } = useDictionaryMutations("recall_rules");
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const { data: services } = useServices();
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    {
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
  );
  const toId = (value: string) => (value === NONE ? null : Number(value));

  return (
    <div
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-testid="recall-rule"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          key={`${rule.id}-${rule.name}`}
          defaultValue={rule.name}
          className="w-56 max-w-full font-medium"
          aria-label={translate("recalls.settings.name")}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== rule.name) update(rule, { name });
          }}
        />
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

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {translate("recalls.settings.when")}
        </span>
        <Select
          value={rule.service_id == null ? NONE : String(rule.service_id)}
          onValueChange={(value) => update(rule, { service_id: toId(value) })}
        >
          <SelectTrigger
            className="w-56 max-w-full"
            aria-label={translate("recalls.settings.service")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {translate("recalls.settings.any_service")}
            </SelectItem>
            {services.map((service) => (
              <SelectItem key={service.id} value={String(service.id)}>
                {service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">
          {translate("recalls.settings.after")}
        </span>
        <Input
          key={`${rule.id}-${rule.delay_months}`}
          type="number"
          min={1}
          max={60}
          defaultValue={rule.delay_months}
          className="w-20"
          aria-label={translate("recalls.settings.delay")}
          onBlur={(event) => {
            const months = Math.min(
              60,
              Math.max(1, Math.round(Number(event.target.value) || 1)),
            );
            if (months !== rule.delay_months) {
              update(rule, { delay_months: months });
            }
          }}
        />
        <span className="text-muted-foreground">
          {translate("recalls.settings.months")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {translate("recalls.settings.create_deal")}
        </span>
        <Select
          value={String(rule.stage_id)}
          onValueChange={(value) => {
            const stage = stages.find((s) => String(s.id) === value);
            if (stage) {
              update(rule, {
                stage_id: stage.id,
                pipeline_id: stage.pipeline_id,
              });
            }
          }}
        >
          <SelectTrigger
            className="w-72 max-w-full"
            aria-label={translate("recalls.settings.stage")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pipelines.flatMap((pipeline) =>
              getPipelineStages(stages, pipeline.id).map((stage) => (
                <SelectItem key={stage.id} value={String(stage.id)}>
                  {pipelines.length > 1
                    ? `${pipeline.name} · ${stage.name}`
                    : stage.name}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
        <Select
          value={
            rule.deal_service_id == null ? NONE : String(rule.deal_service_id)
          }
          onValueChange={(value) =>
            update(rule, { deal_service_id: toId(value) })
          }
        >
          <SelectTrigger
            className="w-64 max-w-full"
            aria-label={translate("recalls.settings.deal_service")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {translate("recalls.settings.same_service")}
            </SelectItem>
            {services.map((service) => (
              <SelectItem key={service.id} value={String(service.id)}>
                {translate("recalls.settings.service_named", {
                  name: service.name,
                })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {translate("recalls.settings.message")}
        </span>
        <Select
          value={rule.template_id == null ? NONE : String(rule.template_id)}
          onValueChange={(value) => update(rule, { template_id: toId(value) })}
        >
          <SelectTrigger
            className="w-60 max-w-full"
            aria-label={translate("recalls.settings.template")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              {translate("recalls.settings.no_message")}
            </SelectItem>
            {templates.map((template) => (
              <SelectItem key={template.id} value={String(template.id)}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {rule.template_id != null ? (
          <Select
            value={rule.message_mode}
            onValueChange={(message_mode) => update(rule, { message_mode })}
          >
            <SelectTrigger
              className="w-72 max-w-full"
              aria-label={translate("recalls.settings.mode")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["confirm", "auto"] as const).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {translate(`recalls.settings.modes.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
};
