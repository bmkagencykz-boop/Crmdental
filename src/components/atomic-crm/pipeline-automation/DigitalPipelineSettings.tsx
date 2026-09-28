import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { formatMoney } from "../deals/kanbanFormat";
import {
  findById,
  getDefaultPipeline,
  getPipelineStages,
  useDoctors,
  usePipelines,
  useServices,
  useStages,
} from "../dictionaries/useDictionaries";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { useDictionaryMutations } from "../settings/useDictionaryMutations";
import { TASK_TYPES } from "../tasks/taskTypes";
import type {
  AutomessageRule,
  MessageTemplate,
  Sale,
  Stage,
  Tag,
  TaskRule,
} from "../types";
import {
  automationColumns,
  DELAYED_EVENTS,
  hasConditions,
  splitMinutes,
} from "./automation";
import { DelayInput, StageTriggerDialog } from "./StageTriggerDialog";
import type { StageTrigger, Webhook } from "./types";

const all = { page: 1, perPage: 500 };
const byPosition = { field: "position", order: "ASC" as const };

type Editing =
  | { kind: "trigger"; stage: Stage; trigger?: StageTrigger }
  | { kind: "task_rule"; stage: Stage | null; rule?: TaskRule }
  | { kind: "automessage"; stage: Stage; rule?: AutomessageRule }
  | null;

/**
 * «Цифровая воронка» (amoCRM): every automation of a pipeline in one grid,
 * stages as columns — the task rules (stage 5), the auto-message rules
 * (stage 6) and the triggers of stage 20, each editable in place.
 * ?pipeline=<id> opens a pipeline (link of the kanban).
 */
export const DigitalPipelineSettings = () => {
  const translate = useTranslate();
  const [searchParams] = useSearchParams();
  const { data: pipelines } = usePipelines();
  const { data: stages } = useStages();
  const [chosen, setChosen] = useState<Identifier | null>(
    searchParams.get("pipeline"),
  );
  const pipeline =
    findById(pipelines, chosen) ?? getDefaultPipeline(pipelines) ?? null;
  const [editing, setEditing] = useState<Editing>(null);

  const { data: taskRules = [] } = useGetList<TaskRule>("task_rules", {
    pagination: all,
    sort: byPosition,
  });
  const { data: automessageRules = [] } = useGetList<AutomessageRule>(
    "automessage_rules",
    { pagination: all, sort: byPosition },
  );
  const { data: triggers = [] } = useGetList<StageTrigger>("stage_triggers", {
    pagination: all,
    sort: byPosition,
  });

  if (!pipeline) return null;
  const pipelineStages = getPipelineStages(stages, pipeline.id);
  const columns = automationColumns({
    stages,
    pipelineId: pipeline.id,
    taskRules,
    automessageRules,
    triggers,
  });
  const onCreate = taskRules.filter((rule) => rule.event === "deal_created");

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="digital-pipeline">
      {pipelines.length > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="pipelines">
          {pipelines.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === pipeline.id}
              onClick={() => setChosen(item.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition-all",
                item.id === pipeline.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-[var(--surface-strong)] hover:text-foreground",
              )}
            >
              {item.name}
            </button>
          ))}
        </nav>
      ) : null}

      <section
        className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2"
        aria-label={translate("pipeline_automation.on_create")}
      >
        <span className="text-sm font-semibold">
          {translate("pipeline_automation.on_create")}
        </span>
        {onCreate.map((rule) => (
          <TaskRuleCard
            key={rule.id}
            rule={rule}
            compact
            onOpen={() => setEditing({ kind: "task_rule", stage: null, rule })}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing({ kind: "task_rule", stage: null })}
        >
          {translate("pipeline_automation.kinds.task_rule")}
        </Button>
      </section>

      <div className="flex gap-3 overflow-x-auto pb-3" role="list">
        {columns.map((column) => (
          <section
            key={column.stage.id}
            role="listitem"
            aria-label={column.stage.name}
            data-testid="automation-column"
            className="flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2"
          >
            <header
              className="rounded-md border-t-4 bg-card px-3 py-2"
              style={{ borderTopColor: column.stage.color }}
            >
              <h3 className="truncate text-sm font-semibold">
                {column.stage.name}
              </h3>
              <p className="text-xs text-muted-foreground">
                {translate("pipeline_automation.column_count", {
                  smart_count:
                    column.taskRules.length +
                    column.automessageRules.length +
                    column.triggers.length,
                })}
              </p>
            </header>
            {column.taskRules.map((rule) => (
              <TaskRuleCard
                key={`task-${rule.id}`}
                rule={rule}
                onOpen={() =>
                  setEditing({ kind: "task_rule", stage: column.stage, rule })
                }
              />
            ))}
            {column.automessageRules.map((rule) => (
              <AutomessageRuleCard
                key={`am-${rule.id}`}
                rule={rule}
                onOpen={() =>
                  setEditing({ kind: "automessage", stage: column.stage, rule })
                }
              />
            ))}
            {column.triggers.map((trigger) => (
              <TriggerCard
                key={`trigger-${trigger.id}`}
                trigger={trigger}
                onOpen={() =>
                  setEditing({ kind: "trigger", stage: column.stage, trigger })
                }
              />
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start text-muted-foreground"
                >
                  {translate("pipeline_automation.add")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() =>
                    setEditing({ kind: "trigger", stage: column.stage })
                  }
                >
                  {translate("pipeline_automation.kinds.trigger")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setEditing({ kind: "task_rule", stage: column.stage })
                  }
                >
                  {translate("pipeline_automation.kinds.task_rule")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setEditing({ kind: "automessage", stage: column.stage })
                  }
                >
                  {translate("pipeline_automation.kinds.automessage")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </section>
        ))}
      </div>

      {editing?.kind === "trigger" ? (
        <StageTriggerDialog
          open
          onClose={() => setEditing(null)}
          trigger={editing.trigger}
          stage={editing.stage}
          stages={pipelineStages}
          position={triggers.length}
        />
      ) : null}
      {editing?.kind === "task_rule" ? (
        <TaskRuleDialog
          onClose={() => setEditing(null)}
          stage={editing.stage}
          rule={editing.rule}
          position={taskRules.length}
        />
      ) : null}
      {editing?.kind === "automessage" ? (
        <AutomessageRuleDialog
          onClose={() => setEditing(null)}
          stage={editing.stage}
          rule={editing.rule}
          position={automessageRules.length}
        />
      ) : null}
    </div>
  );
};

/** «через 2 ч», «сразу» */
const useDelayText = () => {
  const translate = useTranslate();
  return (minutes: number) => {
    if (!minutes) return translate("pipeline_automation.summary.now");
    const delay = splitMinutes(minutes);
    return `${delay.amount} ${translate(`pipeline_automation.units.${delay.unit}`)}`;
  };
};

const Card = ({
  kind,
  title,
  subtitle,
  active,
  onToggle,
  onOpen,
  compact,
  badge,
  testId,
}: {
  kind: string;
  title: string;
  subtitle?: string;
  active: boolean;
  onToggle: (active: boolean) => void;
  onOpen: () => void;
  compact?: boolean;
  badge?: ReactNode;
  testId: string;
}) => (
  <div
    data-testid={testId}
    className={cn(
      "group flex items-start gap-2 rounded-md border bg-card px-2.5 py-2 text-left shadow-card",
      !active && "opacity-60",
      compact && "py-1.5",
    )}
  >
    <button
      type="button"
      onClick={onOpen}
      className="min-w-0 flex-1 text-left"
      aria-label={`${kind}: ${title}`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {kind}
      </span>
      <span className="block truncate text-[13px] font-medium">{title}</span>
      {subtitle ? (
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
      {badge}
    </button>
    <Switch
      checked={active}
      onCheckedChange={onToggle}
      className="mt-0.5 scale-75"
      aria-label={`${kind}: ${title}`}
    />
  </div>
);

const TaskRuleCard = ({
  rule,
  onOpen,
  compact,
}: {
  rule: TaskRule;
  onOpen: () => void;
  compact?: boolean;
}) => {
  const translate = useTranslate();
  const delayText = useDelayText();
  const { update } = useDictionaryMutations("task_rules");
  return (
    <Card
      testId="automation-task-rule"
      kind={translate("pipeline_automation.kinds.task_rule")}
      title={rule.text}
      subtitle={`${translate(`crm.tasks.types.${rule.type}`)} · ${translate(
        "pipeline_automation.summary.due",
        { delay: delayText(rule.due_in_minutes) },
      )}`}
      active={rule.is_active}
      onToggle={(is_active) => update(rule, { is_active })}
      onOpen={onOpen}
      compact={compact}
    />
  );
};

const AutomessageRuleCard = ({
  rule,
  onOpen,
}: {
  rule: AutomessageRule;
  onOpen: () => void;
}) => {
  const translate = useTranslate();
  const delayText = useDelayText();
  const { update } = useDictionaryMutations("automessage_rules");
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    { pagination: all, sort: byPosition },
  );
  const template = findById(templates, rule.template_id);
  return (
    <Card
      testId="automation-automessage"
      kind={translate("pipeline_automation.kinds.automessage")}
      title={template?.name ?? "—"}
      subtitle={`${translate(`pipeline_automation.timing.${rule.timing}`, {
        delay: delayText(rule.offset_minutes),
      })} · ${translate(`pipeline_automation.modes.${rule.mode}`)}`}
      active={rule.is_active}
      onToggle={(is_active) => update(rule, { is_active })}
      onOpen={onOpen}
    />
  );
};

const TriggerCard = ({
  trigger,
  onOpen,
}: {
  trigger: StageTrigger;
  onOpen: () => void;
}) => {
  const translate = useTranslate();
  const { update } = useDictionaryMutations("stage_triggers");
  const summary = useTriggerSummary();
  const event = translate(`pipeline_automation.events.${trigger.event}`);
  return (
    <Card
      testId="automation-trigger"
      kind={translate("pipeline_automation.kinds.trigger")}
      title={trigger.name || event}
      subtitle={summary(trigger)}
      active={trigger.is_active}
      onToggle={(is_active) => update(trigger, { is_active })}
      onOpen={onOpen}
      badge={
        hasConditions(trigger) ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {translate("pipeline_automation.conditions.title")}
          </span>
        ) : null
      }
    />
  );
};

/** «Входящее сообщение → этап «В работе»» */
const useTriggerSummary = () => {
  const translate = useTranslate();
  const delayText = useDelayText();
  const { currency } = useConfigurationContext();
  const { data: stages } = useStages();
  const { data: services } = useServices();
  const { data: doctors } = useDoctors();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "last_name", order: "ASC" },
  });
  const { data: tags = [] } = useGetList<Tag>("tags", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    { pagination: all, sort: byPosition },
  );
  const { data: webhooks = [] } = useGetList<Webhook>("webhooks", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const { data: salesbots = [] } = useGetList<{ id: Identifier; name: string }>(
    "salesbots",
    {
      pagination: { page: 1, perPage: 200 },
      sort: { field: "position", order: "ASC" },
    },
  );
  return (trigger: StageTrigger) => {
    const event = DELAYED_EVENTS.includes(trigger.event)
      ? translate(`pipeline_automation.summary.${trigger.event}`, {
          delay: delayText(trigger.delay_minutes),
        })
      : translate(`pipeline_automation.events.${trigger.event}`);
    const name = (
      items: { id: Identifier; name: string }[],
      id?: Identifier | null,
    ) => findById(items, id)?.name ?? "—";
    let action: string;
    switch (trigger.action) {
      case "move_stage":
        action = translate("pipeline_automation.summary.move_stage", {
          stage: name(stages, trigger.target_stage_id),
        });
        break;
      case "set_responsible": {
        const sale = findById(sales, trigger.target_sales_id);
        action = translate("pipeline_automation.summary.set_responsible", {
          name: sale
            ? `${sale.first_name} ${sale.last_name}`
            : translate("pipeline_automation.dialog.round_robin"),
        });
        break;
      }
      case "add_tag":
      case "remove_tag":
        action = translate(`pipeline_automation.summary.${trigger.action}`, {
          tag: findById(tags, trigger.tag_id)?.name ?? "—",
        });
        break;
      case "create_task":
        action = translate("pipeline_automation.summary.create_task", {
          text: trigger.task_text ?? "",
        });
        break;
      case "send_template":
        action = translate("pipeline_automation.summary.send_template", {
          template: name(templates, trigger.template_id),
        });
        break;
      case "send_webhook": {
        const webhook = findById(webhooks, trigger.webhook_id);
        action = translate("pipeline_automation.summary.send_webhook", {
          webhook: webhook?.name || webhook?.url || "—",
        });
        break;
      }
      case "start_salesbot":
        action = translate("salesbot.pipeline.summary", {
          name: name(salesbots, trigger.salesbot_id),
        });
        break;
      case "set_field":
        action = translate("pipeline_automation.summary.set_field", {
          field: translate(`pipeline_automation.fields.${trigger.field_name}`),
          value:
            trigger.field_name === "plan_amount"
              ? formatMoney(Number(trigger.plan_amount ?? 0), currency)
              : trigger.field_name === "doctor_id"
                ? name(doctors, trigger.doctor_id)
                : name(services, trigger.service_id),
        });
        break;
    }
    return `${event} → ${action}`;
  };
};

/** A task rule (stage 5): on deal creation (stage null) or entering a stage */
const TaskRuleDialog = ({
  onClose,
  stage,
  rule,
  position,
}: {
  onClose: () => void;
  stage: Stage | null;
  rule?: TaskRule;
  position: number;
}) => {
  const translate = useTranslate();
  const { create, update, remove } = useDictionaryMutations("task_rules");
  const [type, setType] = useState<TaskRule["type"]>(rule?.type ?? "call");
  const [text, setText] = useState(
    rule?.text ?? translate("crm.settings.automations.default_text"),
  );
  const [due, setDue] = useState(rule?.due_in_minutes ?? 60);
  const [active, setActive] = useState(rule?.is_active ?? true);

  const save = () => {
    const data = {
      type,
      text: text.trim(),
      due_in_minutes: due,
      is_active: active,
    };
    if (rule) update(rule, data);
    else
      create({
        ...data,
        event: stage ? "stage_entered" : "deal_created",
        stage_id: stage?.id ?? null,
        position,
      });
    onClose();
  };

  return (
    <SimpleDialog
      title={translate(
        stage
          ? "pipeline_automation.task_rule.title_stage"
          : "pipeline_automation.task_rule.title_created",
        { stage: stage?.name },
      )}
      onClose={onClose}
      onSave={save}
      canSave={!!text.trim()}
      onDelete={
        rule
          ? () => {
              remove(rule);
              onClose();
            }
          : undefined
      }
      testId="task-rule-dialog"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={type}
          onValueChange={(value) => setType(value as TaskRule["type"])}
        >
          <SelectTrigger
            className="w-40"
            aria-label={translate("resources.tasks.fields.type")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_TYPES.map((item) => (
              <SelectItem key={item} value={item}>
                {translate(`crm.tasks.types.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DelayInput
          minutes={due}
          onChange={setDue}
          label={translate("crm.settings.automations.due_in")}
        />
      </div>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-label={translate("crm.settings.automations.text")}
      />
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={active} onCheckedChange={setActive} />
        {translate("crm.settings.active")}
      </label>
    </SimpleDialog>
  );
};

/** An auto-message rule (stage 6) of a stage */
const AutomessageRuleDialog = ({
  onClose,
  stage,
  rule,
  position,
}: {
  onClose: () => void;
  stage: Stage;
  rule?: AutomessageRule;
  position: number;
}) => {
  const translate = useTranslate();
  const { create, update, remove } =
    useDictionaryMutations("automessage_rules");
  const { data: templates = [] } = useGetList<MessageTemplate>(
    "message_templates",
    { pagination: all, sort: byPosition },
  );
  const [templateId, setTemplateId] = useState<Identifier | undefined>(
    rule?.template_id,
  );
  const [timing, setTiming] = useState<AutomessageRule["timing"]>(
    rule?.timing ?? "after_stage",
  );
  const [offset, setOffset] = useState(rule?.offset_minutes ?? 60);
  const [mode, setMode] = useState<AutomessageRule["mode"]>(
    rule?.mode ?? "confirm",
  );
  const [active, setActive] = useState(rule?.is_active ?? true);
  const template = templateId ?? templates[0]?.id;

  const save = () => {
    const data = {
      template_id: template,
      timing,
      offset_minutes: offset,
      mode,
      is_active: active,
    };
    if (rule) update(rule, data);
    else create({ ...data, stage_id: stage.id, position });
    onClose();
  };

  return (
    <SimpleDialog
      title={translate("pipeline_automation.automessage.title", {
        stage: stage.name,
      })}
      onClose={onClose}
      onSave={save}
      canSave={template != null}
      onDelete={
        rule
          ? () => {
              remove(rule);
              onClose();
            }
          : undefined
      }
      testId="automessage-rule-dialog"
    >
      {templates.length ? (
        <Select
          value={template != null ? String(template) : ""}
          onValueChange={(value) => setTemplateId(Number(value))}
        >
          <SelectTrigger
            className="w-full"
            aria-label={translate("automessages.settings.template")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {templates.map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("automessages.settings.no_templates")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DelayInput
          minutes={offset}
          onChange={setOffset}
          label={translate("automessages.settings.offset")}
        />
        <Select
          value={timing}
          onValueChange={(value) =>
            setTiming(value as AutomessageRule["timing"])
          }
        >
          <SelectTrigger
            className="w-56"
            aria-label={translate("automessages.settings.timing_label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["after_stage", "before_visit"] as const).map((item) => (
              <SelectItem key={item} value={item}>
                {translate(`automessages.settings.timing.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Select
        value={mode}
        onValueChange={(value) => setMode(value as AutomessageRule["mode"])}
      >
        <SelectTrigger
          className="w-72"
          aria-label={translate("automessages.settings.mode_label")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["auto", "confirm"] as const).map((item) => (
            <SelectItem key={item} value={item}>
              {translate(`automessages.settings.mode.${item}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={active} onCheckedChange={setActive} />
        {translate("crm.settings.active")}
      </label>
    </SimpleDialog>
  );
};

const SimpleDialog = ({
  title,
  onClose,
  onSave,
  canSave,
  onDelete,
  testId,
  children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  canSave: boolean;
  onDelete?: () => void;
  testId: string;
  children: ReactNode;
}) => {
  const translate = useTranslate();
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-xl" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">{children}</div>
        <DialogFooter className="gap-2 sm:justify-between">
          {onDelete ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={onDelete}
            >
              {translate("ra.action.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {translate("ra.action.cancel")}
            </Button>
            <Button onClick={onSave} disabled={!canSave}>
              {translate("ra.action.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
