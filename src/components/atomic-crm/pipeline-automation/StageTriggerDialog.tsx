import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

import {
  useDoctors,
  useLeadSources,
  useServices,
} from "../dictionaries/useDictionaries";
import { useDictionaryMutations } from "../settings/useDictionaryMutations";
import { TASK_TYPES } from "../tasks/taskTypes";
import type { MessageTemplate, Sale, Stage, Tag } from "../types";
import {
  cleanTrigger,
  DELAY_UNITS,
  DELAYED_EVENTS,
  missingTriggerFields,
  splitMinutes,
  STAGE_TRIGGER_ACTIONS,
  STAGE_TRIGGER_EVENTS,
  toMinutes,
  type DelayUnit,
} from "./automation";
import type { StageTrigger, StageTriggerField, Webhook } from "./types";

const ROUND_ROBIN = "round_robin";

const newTrigger = (stage: Stage, position: number): Partial<StageTrigger> => ({
  stage_id: stage.id,
  name: "",
  event: "message_in",
  delay_minutes: 0,
  source_ids: [],
  service_ids: [],
  doctor_ids: [],
  sales_ids: [],
  tags_present: [],
  tags_absent: [],
  action: "move_stage",
  is_active: true,
  position,
});

/**
 * A trigger of the digital pipeline: when (event, delay), for which deals
 * (conditions), what to do (action and its parameters). The database checks
 * the same rules (constraints of public.stage_triggers).
 */
export const StageTriggerDialog = ({
  open,
  onClose,
  trigger,
  stage,
  stages,
  position = 0,
}: {
  open: boolean;
  onClose: () => void;
  trigger?: StageTrigger;
  stage: Stage;
  /** Stages of the pipeline (targets of a move) */
  stages: Stage[];
  position?: number;
}) => {
  const translate = useTranslate();
  const [draft, setDraft] = useState<Partial<StageTrigger>>(
    () => trigger ?? newTrigger(stage, position),
  );
  const [showMissing, setShowMissing] = useState(false);
  const { create, update, remove } = useDictionaryMutations("stage_triggers");
  const patch = (data: Partial<StageTrigger>) =>
    setDraft((current) => ({ ...current, ...data }));
  const missing = missingTriggerFields(draft);

  const save = () => {
    if (missing.length) {
      setShowMissing(true);
      return;
    }
    const {
      id: _id,
      pipeline_id: _pipeline,
      created_at: _created,
      ...data
    } = cleanTrigger(draft);
    if (trigger) {
      update(trigger, data);
    } else {
      create(data);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? null : onClose())}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-testid="stage-trigger-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {translate(
              trigger
                ? "pipeline_automation.dialog.edit"
                : "pipeline_automation.dialog.new",
            )}
          </DialogTitle>
          <DialogDescription>
            {translate("pipeline_automation.dialog.hint", {
              stage: stages.find((s) => String(s.id) === String(draft.stage_id))
                ?.name,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Row label={translate("pipeline_automation.dialog.name")}>
            <Input
              value={draft.name ?? ""}
              placeholder={translate(
                "pipeline_automation.dialog.name_placeholder",
              )}
              onChange={(event) => patch({ name: event.target.value })}
              aria-label={translate("pipeline_automation.dialog.name")}
            />
          </Row>

          <Row label={translate("pipeline_automation.dialog.stage")}>
            <Select
              value={String(draft.stage_id)}
              onValueChange={(value) => patch({ stage_id: Number(value) })}
            >
              <SelectTrigger
                className="w-full"
                aria-label={translate("pipeline_automation.dialog.stage")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>

          <Row label={translate("pipeline_automation.dialog.event")}>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={draft.event}
                onValueChange={(event) =>
                  patch({
                    event: event as StageTrigger["event"],
                    delay_minutes: DELAYED_EVENTS.includes(
                      event as StageTrigger["event"],
                    )
                      ? draft.delay_minutes || 120
                      : 0,
                  })
                }
              >
                <SelectTrigger
                  className="w-72"
                  aria-label={translate("pipeline_automation.dialog.event")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_TRIGGER_EVENTS.map((event) => (
                    <SelectItem key={event} value={event}>
                      {translate(`pipeline_automation.events.${event}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {DELAYED_EVENTS.includes(draft.event!) ? (
                <DelayInput
                  minutes={draft.delay_minutes ?? 0}
                  onChange={(delay_minutes) => patch({ delay_minutes })}
                  label={translate(
                    draft.event === "idle"
                      ? "pipeline_automation.dialog.delay_idle"
                      : "pipeline_automation.dialog.delay_visit",
                  )}
                />
              ) : null}
            </div>
          </Row>

          <Conditions draft={draft} patch={patch} />

          <Row label={translate("pipeline_automation.dialog.action")}>
            <Select
              value={draft.action}
              onValueChange={(action) =>
                patch({ action: action as StageTrigger["action"] })
              }
            >
              <SelectTrigger
                className="w-72"
                aria-label={translate("pipeline_automation.dialog.action")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_TRIGGER_ACTIONS.map((action) => (
                  <SelectItem key={action} value={action}>
                    {translate(`pipeline_automation.actions.${action}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <ActionParams draft={draft} patch={patch} stages={stages} />

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={draft.is_active ?? true}
              onCheckedChange={(is_active) => patch({ is_active })}
            />
            {translate("pipeline_automation.dialog.active")}
          </label>

          {showMissing && missing.length ? (
            <p className="text-sm text-destructive" role="alert">
              {missing
                .map((field) =>
                  translate(`pipeline_automation.missing.${field}`),
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {trigger ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                remove(trigger);
                onClose();
              }}
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
            <Button onClick={save}>{translate("ra.action.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    {children}
  </div>
);

export const DelayInput = ({
  minutes,
  onChange,
  label,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  label: string;
}) => {
  const translate = useTranslate();
  const delay = splitMinutes(minutes);
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Input
        key={`${minutes}`}
        type="number"
        min={0}
        defaultValue={delay.amount}
        className="w-20"
        aria-label={label}
        onBlur={(event) =>
          onChange(toMinutes(Number(event.target.value) || 0, delay.unit))
        }
      />
      <Select
        value={delay.unit}
        onValueChange={(unit) =>
          onChange(toMinutes(delay.amount, unit as DelayUnit))
        }
      >
        <SelectTrigger
          className="w-24"
          aria-label={translate("pipeline_automation.dialog.unit")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DELAY_UNITS.map((unit) => (
            <SelectItem key={unit.key} value={unit.key}>
              {translate(`pipeline_automation.units.${unit.key}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const Conditions = ({
  draft,
  patch,
}: {
  draft: Partial<StageTrigger>;
  patch: (data: Partial<StageTrigger>) => void;
}) => {
  const translate = useTranslate();
  const { data: sources } = useLeadSources();
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
  const count = [
    draft.source_ids,
    draft.service_ids,
    draft.doctor_ids,
    draft.sales_ids,
    draft.tags_present,
    draft.tags_absent,
  ].filter((ids) => ids?.length).length;
  const tagItems = tags.map((tag) => ({ id: tag.id, name: tag.name }));

  return (
    <details
      className="rounded-md border bg-muted/40 px-3 py-2"
      open={count > 0}
      data-testid="trigger-conditions"
    >
      <summary className="cursor-pointer text-sm font-medium">
        {translate("pipeline_automation.conditions.title")}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {count
            ? translate("pipeline_automation.conditions.count", {
                smart_count: count,
              })
            : translate("pipeline_automation.conditions.any")}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <Row label={translate("pipeline_automation.conditions.sources")}>
          <Chips
            items={sources.filter((s) => !s.is_archived)}
            value={draft.source_ids ?? []}
            onChange={(source_ids) => patch({ source_ids })}
          />
        </Row>
        <Row label={translate("pipeline_automation.conditions.services")}>
          <Chips
            items={services.filter((s) => !s.is_archived)}
            value={draft.service_ids ?? []}
            onChange={(service_ids) => patch({ service_ids })}
          />
        </Row>
        <Row label={translate("pipeline_automation.conditions.doctors")}>
          <Chips
            items={doctors.filter(
              (d) =>
                d.is_active ||
                draft.doctor_ids?.some((id) => String(id) === String(d.id)),
            )}
            value={draft.doctor_ids ?? []}
            onChange={(doctor_ids) => patch({ doctor_ids })}
          />
        </Row>
        <Row label={translate("pipeline_automation.conditions.sales")}>
          <Chips
            items={sales
              .filter((s) => !s.disabled)
              .map((s) => ({
                id: s.id,
                name: `${s.first_name} ${s.last_name}`,
              }))}
            value={draft.sales_ids ?? []}
            onChange={(sales_ids) => patch({ sales_ids })}
          />
        </Row>
        <Row label={translate("pipeline_automation.conditions.tags_present")}>
          <Chips
            items={tagItems}
            value={draft.tags_present ?? []}
            onChange={(tags_present) => patch({ tags_present })}
          />
        </Row>
        <Row label={translate("pipeline_automation.conditions.tags_absent")}>
          <Chips
            items={tagItems}
            value={draft.tags_absent ?? []}
            onChange={(tags_absent) => patch({ tags_absent })}
          />
        </Row>
      </div>
    </details>
  );
};

const ActionParams = ({
  draft,
  patch,
  stages,
}: {
  draft: Partial<StageTrigger>;
  patch: (data: Partial<StageTrigger>) => void;
  stages: Stage[];
}) => {
  const translate = useTranslate();
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
    {
      pagination: { page: 1, perPage: 200 },
      sort: { field: "position", order: "ASC" },
    },
  );
  const { data: webhooks = [] } = useGetList<Webhook>("webhooks", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });

  switch (draft.action) {
    case "move_stage":
      return (
        <Row label={translate("pipeline_automation.dialog.target_stage")}>
          <IdSelect
            value={draft.target_stage_id}
            onChange={(target_stage_id) => patch({ target_stage_id })}
            // Refusing needs a reason: not an automatic move
            items={stages.filter(
              (s) =>
                s.kind !== "lost" && String(s.id) !== String(draft.stage_id),
            )}
            label={translate("pipeline_automation.dialog.target_stage")}
          />
        </Row>
      );
    case "set_responsible":
      return (
        <Row label={translate("pipeline_automation.dialog.target_sales")}>
          <Select
            value={
              draft.target_sales_id != null
                ? String(draft.target_sales_id)
                : ROUND_ROBIN
            }
            onValueChange={(value) =>
              patch({
                target_sales_id: value === ROUND_ROBIN ? null : Number(value),
              })
            }
          >
            <SelectTrigger
              className="w-72"
              aria-label={translate("pipeline_automation.dialog.target_sales")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROUND_ROBIN}>
                {translate("pipeline_automation.dialog.round_robin")}
              </SelectItem>
              {sales
                .filter((s) => !s.disabled)
                .map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.first_name} {s.last_name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Row>
      );
    case "add_tag":
    case "remove_tag":
      return (
        <Row label={translate("pipeline_automation.dialog.tag")}>
          <IdSelect
            value={draft.tag_id}
            onChange={(tag_id) => patch({ tag_id })}
            items={tags.map((t) => ({ id: t.id, name: t.name }))}
            label={translate("pipeline_automation.dialog.tag")}
          />
        </Row>
      );
    case "create_task":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={draft.task_type ?? "call"}
              onValueChange={(task_type) =>
                patch({ task_type: task_type as StageTrigger["task_type"] })
              }
            >
              <SelectTrigger
                className="w-40"
                aria-label={translate("pipeline_automation.dialog.task_type")}
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
            <DelayInput
              minutes={draft.task_due_minutes ?? 0}
              onChange={(task_due_minutes) => patch({ task_due_minutes })}
              label={translate("pipeline_automation.dialog.task_due")}
            />
          </div>
          <Input
            value={draft.task_text ?? ""}
            onChange={(event) => patch({ task_text: event.target.value })}
            placeholder={translate("pipeline_automation.dialog.task_text")}
            aria-label={translate("pipeline_automation.dialog.task_text")}
          />
        </div>
      );
    case "send_template":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <IdSelect
            value={draft.template_id}
            onChange={(template_id) => patch({ template_id })}
            items={templates.map((t) => ({ id: t.id, name: t.name }))}
            label={translate("pipeline_automation.dialog.template")}
          />
          <Select
            value={draft.message_mode ?? "auto"}
            onValueChange={(message_mode) =>
              patch({
                message_mode: message_mode as StageTrigger["message_mode"],
              })
            }
          >
            <SelectTrigger
              className="w-64"
              aria-label={translate("pipeline_automation.dialog.mode")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["auto", "confirm"] as const).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {translate(`pipeline_automation.modes.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "send_webhook":
      return webhooks.length ? (
        <Row label={translate("pipeline_automation.dialog.webhook")}>
          <IdSelect
            value={draft.webhook_id}
            onChange={(webhook_id) => patch({ webhook_id })}
            items={webhooks.map((w) => ({ id: w.id, name: w.name || w.url }))}
            label={translate("pipeline_automation.dialog.webhook")}
          />
        </Row>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("pipeline_automation.dialog.no_webhooks")}
        </p>
      );
    case "set_field":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={draft.field_name ?? ""}
            onValueChange={(field_name) =>
              patch({ field_name: field_name as StageTriggerField })
            }
          >
            <SelectTrigger
              className="w-48"
              aria-label={translate("pipeline_automation.dialog.field")}
            >
              <SelectValue
                placeholder={translate("pipeline_automation.dialog.field")}
              />
            </SelectTrigger>
            <SelectContent>
              {(["plan_amount", "doctor_id", "service_id"] as const).map(
                (field) => (
                  <SelectItem key={field} value={field}>
                    {translate(`pipeline_automation.fields.${field}`)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          {draft.field_name === "plan_amount" ? (
            <Input
              type="number"
              min={0}
              className="w-40"
              value={draft.plan_amount ?? ""}
              onChange={(event) =>
                patch({
                  plan_amount:
                    event.target.value === ""
                      ? null
                      : Math.max(0, Number(event.target.value)),
                })
              }
              aria-label={translate("pipeline_automation.fields.plan_amount")}
            />
          ) : null}
          {draft.field_name === "doctor_id" ? (
            <IdSelect
              value={draft.doctor_id}
              onChange={(doctor_id) => patch({ doctor_id })}
              items={doctors.filter((d) => d.is_active)}
              label={translate("pipeline_automation.fields.doctor_id")}
            />
          ) : null}
          {draft.field_name === "service_id" ? (
            <IdSelect
              value={draft.service_id}
              onChange={(service_id) => patch({ service_id })}
              items={services.filter((s) => !s.is_archived)}
              label={translate("pipeline_automation.fields.service_id")}
            />
          ) : null}
        </div>
      );
    default:
      return null;
  }
};

const IdSelect = ({
  value,
  onChange,
  items,
  label,
}: {
  value: Identifier | null | undefined;
  onChange: (value: number) => void;
  items: { id: Identifier; name: string }[];
  label: string;
}) => (
  <Select
    value={value != null ? String(value) : ""}
    onValueChange={(next) => onChange(Number(next))}
  >
    <SelectTrigger className="w-72 max-w-full" aria-label={label}>
      <SelectValue placeholder={label} />
    </SelectTrigger>
    <SelectContent>
      {items.map((item) => (
        <SelectItem key={item.id} value={String(item.id)}>
          {item.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** Toggle buttons for a multiple choice */
const Chips = ({
  items,
  value,
  onChange,
}: {
  items: { id: Identifier; name: string }[];
  value: Identifier[];
  onChange: (value: Identifier[]) => void;
}) => {
  const translate = useTranslate();
  if (!items.length) {
    return (
      <span className="text-sm text-muted-foreground">
        {translate("pipeline_automation.conditions.nothing")}
      </span>
    );
  }
  const selected = new Set(value.map(String));
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const active = selected.has(String(item.id));
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? value.filter((id) => String(id) !== String(item.id))
                  : [...value, item.id],
              )
            }
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-accent",
            )}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
};
