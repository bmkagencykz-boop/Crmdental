import { Plus, Trash2 } from "lucide-react";
import { useGetList, useTranslate } from "ra-core";
import { useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

import {
  getPipelineStages,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import {
  previewValues,
  renderTemplate,
  TEMPLATE_VARIABLES,
} from "../providers/commons/automessages";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { AutomessageRule, MessageTemplate } from "../types";
import { useDictionaryMutations } from "./useDictionaryMutations";
import {
  sampleCustomText,
  templateVariable,
} from "../custom-fields/customFields";
import { useEntityFields } from "../custom-fields/useCustomFields";

const UNITS = [
  { key: "minutes", minutes: 1 },
  { key: "hours", minutes: 60 },
  { key: "days", minutes: 24 * 60 },
] as const;

/** "90 minutes" as 90 minutes, "1 day" as 1 day: the largest exact unit */
const splitOffset = (minutes: number) => {
  const unit =
    [...UNITS]
      .reverse()
      .find((u) => minutes > 0 && minutes % u.minutes === 0) ?? UNITS[0];
  return { amount: minutes / unit.minutes, unit: unit.key };
};

/**
 * Automatic messages to patients (spec §6): templates with variables, and
 * rules "stage → template" sent after entering the stage or before the
 * visit, automatically or shown to the employee first.
 */
export const AutomessagesSettings = () => {
  const translate = useTranslate();
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    {
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
  );
  const { data: rules = [] } = useGetList<AutomessageRule>(
    "automessage_rules",
    {
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3" aria-labelledby="am-rules">
        <div>
          <h3 id="am-rules" className="text-base font-semibold">
            {translate("automessages.settings.rules")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {translate("automessages.settings.rules_hint")}
          </p>
        </div>
        <RulesEditor rules={rules} templates={templates} />
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="am-templates">
        <div>
          <h3 id="am-templates" className="text-base font-semibold">
            {translate("automessages.settings.templates")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {translate("automessages.settings.templates_hint")}
          </p>
        </div>
        <TemplatesEditor templates={templates} rules={rules} />
      </section>
    </div>
  );
};

const TemplatesEditor = ({
  templates,
  rules,
}: {
  templates: MessageTemplate[];
  rules: AutomessageRule[];
}) => {
  const translate = useTranslate();
  const { create } = useDictionaryMutations("message_templates");
  return (
    <div className="flex flex-col gap-3">
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          inUse={rules.some(
            (rule) => String(rule.template_id) === String(template.id),
          )}
        />
      ))}
      <div>
        <Button
          variant="outline"
          onClick={() =>
            create({
              name: translate("automessages.settings.new_template_name"),
              body: translate("automessages.settings.new_template_body"),
              position: templates.length,
            })
          }
        >
          <Plus className="size-4" />
          {translate("automessages.settings.add_template")}
        </Button>
      </div>
    </div>
  );
};

const TemplateCard = ({
  template,
  inUse,
}: {
  template: MessageTemplate;
  inUse: boolean;
}) => {
  const translate = useTranslate();
  const config = useConfigurationContext();
  const { update, remove } = useDictionaryMutations("message_templates");
  const [body, setBody] = useState(template.body);
  const [lastSaved, setLastSaved] = useState(template.body);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // The record changed elsewhere (saved, refreshed): show it
  if (template.body !== lastSaved) {
    setLastSaved(template.body);
    setBody(template.body);
  }

  const save = (value: string) => {
    const text = value.trim();
    if (text && text !== template.body) update(template, { body: text });
  };
  const { data: dealFields } = useEntityFields("deal");
  const insert = (variable: string) => {
    const element = textarea.current;
    const token = `{${variable}}`;
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    save(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-testid="message-template"
    >
      <div className="flex items-center gap-2">
        <Input
          key={`${template.id}-${template.name}`}
          defaultValue={template.name}
          aria-label={translate("automessages.settings.template_name")}
          className="font-medium"
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== template.name) update(template, { name });
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={inUse}
          title={
            inUse
              ? translate("automessages.settings.template_in_use")
              : translate("ra.action.delete")
          }
          onClick={() => remove(template)}
          aria-label={translate("ra.action.delete")}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Textarea
            ref={textarea}
            value={body}
            rows={4}
            aria-label={translate("automessages.settings.template_body")}
            onChange={(event) => setBody(event.target.value)}
            onBlur={(event) => save(event.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((variable) => (
              <button
                key={variable}
                type="button"
                // Keep the cursor of the textarea
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(variable)}
                className="rounded-md border bg-muted px-2 py-0.5 font-mono text-xs text-foreground hover:bg-accent"
              >
                {`{${variable}}`}
              </button>
            ))}
            {/* Custom fields of the deals (stage 19): {поле:Название} */}
            {dealFields.map((field) => (
              <button
                key={field.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(templateVariable(field))}
                title={translate("custom_fields.templates.hint")}
                className="rounded-md border border-dashed bg-muted px-2 py-0.5 font-mono text-xs text-foreground hover:bg-accent"
              >
                {`{${templateVariable(field)}}`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {translate("automessages.settings.preview")}
          </span>
          <p
            className="whitespace-pre-line rounded-md bg-muted px-3 py-2 text-sm"
            data-testid="template-preview"
          >
            {renderTemplate(body, {
              ...previewValues(config.title),
              ...Object.fromEntries(
                dealFields.map((field) => [
                  templateVariable(field),
                  sampleCustomText(field),
                ]),
              ),
            })}
          </p>
        </div>
      </div>
    </div>
  );
};

const RulesEditor = ({
  rules,
  templates,
}: {
  rules: AutomessageRule[];
  templates: MessageTemplate[];
}) => {
  const translate = useTranslate();
  const { create } = useDictionaryMutations("automessage_rules");
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const firstStage = pipelines.length
    ? getPipelineStages(stages, pipelines[0].id)[0]
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} templates={templates} />
      ))}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={!templates.length || !firstStage}
          onClick={() =>
            create({
              stage_id: firstStage!.id,
              template_id: templates[0].id,
              timing: "after_stage",
              offset_minutes: 60,
              mode: "confirm",
              is_active: true,
              position: rules.length,
            })
          }
        >
          <Plus className="size-4" />
          {translate("automessages.settings.add_rule")}
        </Button>
        {!templates.length ? (
          <span className="text-sm text-muted-foreground">
            {translate("automessages.settings.no_templates")}
          </span>
        ) : null}
      </div>
    </div>
  );
};

const RuleRow = ({
  rule,
  templates,
}: {
  rule: AutomessageRule;
  templates: MessageTemplate[];
}) => {
  const translate = useTranslate();
  const { update, remove } = useDictionaryMutations("automessage_rules");
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const offset = splitOffset(rule.offset_minutes);

  return (
    <div
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-testid="automessage-rule"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(rule.stage_id)}
          onValueChange={(value) => update(rule, { stage_id: Number(value) })}
        >
          <SelectTrigger
            className="w-72 max-w-full"
            aria-label={translate("automessages.settings.stage")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pipelines.flatMap((pipeline) =>
              getPipelineStages(stages, pipeline.id).map((stage) => (
                <SelectItem key={stage.id} value={String(stage.id)}>
                  {translate("automessages.settings.on_stage", {
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
          value={String(rule.template_id)}
          onValueChange={(value) =>
            update(rule, { template_id: Number(value) })
          }
        >
          <SelectTrigger
            className="w-60 max-w-full"
            aria-label={translate("automessages.settings.template")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={String(template.id)}>
                {template.name}
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          key={`${rule.id}-${rule.offset_minutes}`}
          type="number"
          min={0}
          defaultValue={offset.amount}
          className="w-20"
          aria-label={translate("automessages.settings.offset")}
          onBlur={(event) => {
            const amount = Math.max(0, Number(event.target.value) || 0);
            const unit = UNITS.find((u) => u.key === offset.unit)!;
            if (amount * unit.minutes !== rule.offset_minutes) {
              update(rule, { offset_minutes: amount * unit.minutes });
            }
          }}
        />
        <Select
          value={offset.unit}
          onValueChange={(key) =>
            update(rule, {
              offset_minutes:
                offset.amount * UNITS.find((u) => u.key === key)!.minutes,
            })
          }
        >
          <SelectTrigger
            className="w-28"
            aria-label={translate("automessages.settings.unit")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((unit) => (
              <SelectItem key={unit.key} value={unit.key}>
                {translate(`automessages.settings.units.${unit.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={rule.timing}
          onValueChange={(timing) => update(rule, { timing })}
        >
          <SelectTrigger
            className="w-56"
            aria-label={translate("automessages.settings.timing_label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["after_stage", "before_visit"] as const).map((timing) => (
              <SelectItem key={timing} value={timing}>
                {translate(`automessages.settings.timing.${timing}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={rule.mode}
          onValueChange={(mode) => update(rule, { mode })}
        >
          <SelectTrigger
            className="w-64 max-w-full"
            aria-label={translate("automessages.settings.mode_label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["auto", "confirm"] as const).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {translate(`automessages.settings.mode.${mode}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
