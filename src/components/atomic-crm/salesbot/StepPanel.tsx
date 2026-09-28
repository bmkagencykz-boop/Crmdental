import { useTranslate, type Identifier } from "ra-core";
import type { ReactNode } from "react";
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
import { cn } from "@/lib/utils";

import { TASK_TYPES } from "../tasks/taskTypes";
import type { TaskType } from "../types";
import { STEP_BORDER, stepOptionLabel } from "./labels";
import {
  DEAL_FIELDS,
  DEAL_MATCHES,
  PATIENT_FIELDS,
  REPLY_MATCHES,
  SET_KINDS,
  type Branch,
  type BranchMatch,
  type Scenario,
  type SetAction,
  type SetKind,
  type Step,
} from "./types";
import type { BotLookups } from "./useBotDictionaries";

const NONE = "__none__";

/**
 * The side panel of the editor: the parameters of the selected step and
 * where it goes next (any step of the scenario, or the end).
 */
export const StepPanel = ({
  step,
  scenario,
  lookups,
  onChange,
  onMakeStart,
  onDelete,
}: {
  step: Step;
  scenario: Scenario;
  lookups: BotLookups;
  onChange: (step: Step) => void;
  onMakeStart: () => void;
  onDelete: () => void;
}) => {
  const translate = useTranslate();
  const patch = (data: Partial<Step>) => onChange({ ...step, ...data });
  const targets = scenario.steps;
  const target = (
    label: string,
    value: string | null | undefined,
    change: (value: string | null) => void,
  ) => (
    <Field label={label}>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => change(next === NONE ? null : next)}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>
            {translate("salesbot.panel.end_option")}
          </SelectItem>
          {targets.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {stepOptionLabel(s, translate)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="salesbot-step-panel">
      <div className={cn("border-l-4 pl-3", STEP_BORDER[step.type])}>
        <h3 className="text-base font-semibold">
          {translate(`salesbot.types.${step.type}`)}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate("salesbot.panel.step", { id: step.id })} ·{" "}
          {translate(`salesbot.type_hints.${step.type}`)}
        </p>
      </div>

      {step.type === "send_message" ? (
        <>
          <Field label={translate("salesbot.panel.text")}>
            <Textarea
              value={step.text ?? ""}
              onChange={(event) => patch({ text: event.target.value })}
              rows={5}
              aria-label={translate("salesbot.panel.text")}
            />
            <p className="text-xs text-muted-foreground">
              {translate("salesbot.panel.variables")}
            </p>
          </Field>
          <Field label={translate("salesbot.panel.template")}>
            <IdSelect
              value={step.template_id}
              items={lookups.templates}
              allowNone={translate("salesbot.panel.no_template")}
              label={translate("salesbot.panel.template")}
              onChange={(template_id) => patch({ template_id })}
            />
          </Field>
          <Field label={translate("salesbot.panel.buttons")}>
            <div className="flex flex-col gap-1.5">
              {(step.buttons ?? []).map((button, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <span className="w-5 text-right text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <Input
                    value={button}
                    aria-label={translate("salesbot.panel.button", {
                      n: index + 1,
                    })}
                    onChange={(event) =>
                      patch({
                        buttons: (step.buttons ?? []).map((b, i) =>
                          i === index ? event.target.value : b,
                        ),
                      })
                    }
                  />
                  <SmallButton
                    onClick={() =>
                      patch({
                        buttons: (step.buttons ?? []).filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    {translate("salesbot.panel.remove")}
                  </SmallButton>
                </div>
              ))}
              <SmallButton
                onClick={() =>
                  patch({ buttons: [...(step.buttons ?? []), ""] })
                }
              >
                + {translate("salesbot.panel.add_button")}
              </SmallButton>
              <p className="text-xs text-muted-foreground">
                {translate("salesbot.panel.buttons_hint")}
              </p>
            </div>
          </Field>
          {target(translate("salesbot.panel.next"), step.next, (next) =>
            patch({ next }),
          )}
        </>
      ) : null}

      {step.type === "wait_reply" ? (
        <>
          <Field label={translate("salesbot.panel.timeout")}>
            <NumberInput
              value={step.timeout_minutes}
              label={translate("salesbot.panel.timeout")}
              onChange={(timeout_minutes) => patch({ timeout_minutes })}
            />
          </Field>
          {target(translate("salesbot.panel.next_reply"), step.next, (next) =>
            patch({ next }),
          )}
          {target(
            translate("salesbot.panel.next_timeout"),
            step.timeout_next,
            (timeout_next) => patch({ timeout_next }),
          )}
        </>
      ) : null}

      {step.type === "delay" ? (
        <>
          <Field label={translate("salesbot.panel.minutes")}>
            <NumberInput
              value={step.minutes}
              label={translate("salesbot.panel.minutes")}
              onChange={(minutes) => patch({ minutes })}
            />
          </Field>
          {target(translate("salesbot.panel.next"), step.next, (next) =>
            patch({ next }),
          )}
        </>
      ) : null}

      {step.type === "condition" ? (
        <>
          <Field label={translate("salesbot.panel.branches")}>
            <div className="flex flex-col gap-3">
              {(step.branches ?? []).map((branch, index) => (
                <BranchEditor
                  key={index}
                  index={index}
                  branch={branch}
                  lookups={lookups}
                  count={step.branches?.length ?? 0}
                  onChange={(next) =>
                    patch({
                      branches: (step.branches ?? []).map((b, i) =>
                        i === index ? next : b,
                      ),
                    })
                  }
                  onMove={(delta) => {
                    const branches = [...(step.branches ?? [])];
                    const [moved] = branches.splice(index, 1);
                    branches.splice(index + delta, 0, moved);
                    patch({ branches });
                  }}
                  onRemove={() =>
                    patch({
                      branches: (step.branches ?? []).filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                  target={target}
                />
              ))}
              <SmallButton
                onClick={() =>
                  patch({
                    branches: [
                      ...(step.branches ?? []),
                      { match: "keywords", value: "", next: null },
                    ],
                  })
                }
              >
                + {translate("salesbot.panel.add_branch")}
              </SmallButton>
            </div>
          </Field>
          {target(
            translate("salesbot.panel.else"),
            step.else_next,
            (else_next) => patch({ else_next }),
          )}
        </>
      ) : null}

      {step.type === "set" ? (
        <>
          <Field label={translate("salesbot.panel.actions")}>
            <div className="flex flex-col gap-3">
              {(step.actions ?? []).map((action, index) => (
                <ActionEditor
                  key={index}
                  action={action}
                  lookups={lookups}
                  onChange={(next) =>
                    patch({
                      actions: (step.actions ?? []).map((a, i) =>
                        i === index ? next : a,
                      ),
                    })
                  }
                  onRemove={() =>
                    patch({
                      actions: (step.actions ?? []).filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                />
              ))}
              <SmallButton
                onClick={() =>
                  patch({
                    actions: [
                      ...(step.actions ?? []),
                      { kind: "tag_add", tag_id: null },
                    ],
                  })
                }
              >
                + {translate("salesbot.panel.add_action")}
              </SmallButton>
            </div>
          </Field>
          {target(translate("salesbot.panel.next"), step.next, (next) =>
            patch({ next }),
          )}
        </>
      ) : null}

      {step.type === "create_task" ? (
        <>
          <Field label={translate("salesbot.panel.task_type")}>
            <Select
              value={step.task_type ?? "call"}
              onValueChange={(task_type) =>
                patch({ task_type: task_type as TaskType })
              }
            >
              <SelectTrigger
                className="w-full"
                aria-label={translate("salesbot.panel.task_type")}
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
          </Field>
          <Field label={translate("salesbot.panel.task_text")}>
            <Input
              value={step.text ?? ""}
              aria-label={translate("salesbot.panel.task_text")}
              onChange={(event) => patch({ text: event.target.value })}
            />
          </Field>
          <Field label={translate("salesbot.panel.due")}>
            <NumberInput
              value={step.due_minutes}
              label={translate("salesbot.panel.due")}
              onChange={(due_minutes) => patch({ due_minutes })}
            />
          </Field>
          {target(translate("salesbot.panel.next"), step.next, (next) =>
            patch({ next }),
          )}
        </>
      ) : null}

      {step.type === "handoff" ? (
        <>
          <Field label={translate("salesbot.panel.handoff_note")}>
            <Input
              value={step.text ?? ""}
              aria-label={translate("salesbot.panel.handoff_note")}
              onChange={(event) => patch({ text: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={!!step.create_task}
              onCheckedChange={(create_task) => patch({ create_task })}
            />
            {translate("salesbot.panel.handoff_task")}
          </label>
          {step.create_task ? (
            <Field label={translate("salesbot.panel.handoff_task_text")}>
              <Input
                value={step.task_text ?? ""}
                aria-label={translate("salesbot.panel.handoff_task_text")}
                onChange={(event) => patch({ task_text: event.target.value })}
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {step.type === "webhook" ? (
        <>
          {lookups.webhooks.length ? (
            <Field label={translate("salesbot.panel.webhook")}>
              <IdSelect
                value={step.webhook_id}
                items={lookups.webhooks}
                label={translate("salesbot.panel.webhook")}
                onChange={(webhook_id) => patch({ webhook_id })}
              />
            </Field>
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate("salesbot.panel.no_webhooks")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {translate("salesbot.panel.webhook_hint")}
          </p>
          {target(translate("salesbot.panel.next"), step.next, (next) =>
            patch({ next }),
          )}
        </>
      ) : null}

      {step.type === "stop" ? (
        <p className="text-sm text-muted-foreground">
          {translate("salesbot.panel.stop_hint")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t pt-3">
        {scenario.start !== step.id ? (
          <Button variant="outline" size="sm" onClick={onMakeStart}>
            {translate("salesbot.editor.make_start")}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onDelete}>
          {translate("salesbot.editor.delete")}
        </Button>
      </div>
    </div>
  );
};

const BranchEditor = ({
  index,
  branch,
  count,
  lookups,
  onChange,
  onMove,
  onRemove,
  target,
}: {
  index: number;
  branch: Branch;
  count: number;
  lookups: BotLookups;
  onChange: (branch: Branch) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
  target: (
    label: string,
    value: string | null | undefined,
    change: (value: string | null) => void,
  ) => ReactNode;
}) => {
  const translate = useTranslate();
  const patch = (data: Partial<Branch>) => onChange({ ...branch, ...data });
  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-card p-2.5"
      data-testid="salesbot-branch"
    >
      <div className="flex items-center gap-1">
        <span className="text-xs font-semibold">
          {translate("salesbot.panel.branch", { n: index + 1 })}
        </span>
        <span className="ml-auto flex gap-1">
          {index > 0 ? (
            <SmallButton onClick={() => onMove(-1)}>
              {translate("salesbot.panel.up")}
            </SmallButton>
          ) : null}
          {index < count - 1 ? (
            <SmallButton onClick={() => onMove(1)}>
              {translate("salesbot.panel.down")}
            </SmallButton>
          ) : null}
          <SmallButton onClick={onRemove}>
            {translate("salesbot.panel.remove")}
          </SmallButton>
        </span>
      </div>
      <Select
        value={branch.match}
        onValueChange={(match) =>
          onChange({ match: match as BranchMatch, next: branch.next })
        }
      >
        <SelectTrigger
          className="w-full"
          aria-label={translate("salesbot.panel.branch", { n: index + 1 })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...REPLY_MATCHES, ...DEAL_MATCHES].map((match) => (
            <SelectItem key={match} value={match}>
              {translate(`salesbot.match.${match}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {branch.match === "keywords" ||
      branch.match === "regex" ||
      branch.match === "option" ? (
        <Input
          value={branch.value ?? ""}
          inputMode={branch.match === "option" ? "numeric" : undefined}
          placeholder={
            branch.match === "keywords"
              ? translate("salesbot.panel.keywords_hint")
              : undefined
          }
          aria-label={translate("salesbot.panel.branch_value")}
          onChange={(event) => patch({ value: event.target.value })}
        />
      ) : null}
      {branch.match === "stage" ? (
        <IdSelect
          value={branch.stage_id}
          items={lookups.stageOptions}
          label={translate("salesbot.match.stage")}
          onChange={(stage_id) => patch({ stage_id })}
        />
      ) : null}
      {branch.match === "tag" ? (
        <IdSelect
          value={branch.tag_id}
          items={lookups.tags}
          label={translate("salesbot.match.tag")}
          onChange={(tag_id) => patch({ tag_id })}
        />
      ) : null}
      {branch.match === "source" ? (
        <IdSelect
          value={branch.source_id}
          items={lookups.sources}
          label={translate("salesbot.match.source")}
          onChange={(source_id) => patch({ source_id })}
        />
      ) : null}
      {branch.match === "field" ? (
        <>
          <IdSelect
            value={branch.field_id}
            items={lookups.fields}
            label={translate("salesbot.match.field")}
            onChange={(field_id) => patch({ field_id })}
          />
          <Input
            value={branch.value ?? ""}
            aria-label={translate("salesbot.panel.branch_value")}
            onChange={(event) => patch({ value: event.target.value })}
          />
        </>
      ) : null}
      {target(translate("salesbot.panel.next"), branch.next, (next) =>
        patch({ next }),
      )}
    </div>
  );
};

const ActionEditor = ({
  action,
  lookups,
  onChange,
  onRemove,
}: {
  action: SetAction;
  lookups: BotLookups;
  onChange: (action: SetAction) => void;
  onRemove: () => void;
}) => {
  const translate = useTranslate();
  const patch = (data: Partial<SetAction>) => onChange({ ...action, ...data });
  const referenceList =
    action.kind === "deal_field"
      ? action.field === "service_id"
        ? lookups.services
        : action.field === "doctor_id"
          ? lookups.doctors
          : action.field === "source_id"
            ? lookups.sources
            : null
      : null;
  return (
    <div
      className="flex flex-col gap-2 rounded-md border bg-card p-2.5"
      data-testid="salesbot-action"
    >
      <div className="flex items-center gap-1">
        <Select
          value={action.kind}
          onValueChange={(kind) => onChange({ kind: kind as SetKind })}
        >
          <SelectTrigger
            className="w-full"
            aria-label={translate("salesbot.panel.actions")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SET_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {translate(`salesbot.set.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SmallButton onClick={onRemove}>
          {translate("salesbot.panel.remove")}
        </SmallButton>
      </div>
      {action.kind === "stage" ? (
        <IdSelect
          value={action.stage_id}
          items={lookups.stageOptions}
          label={translate("salesbot.set.stage")}
          onChange={(stage_id) => patch({ stage_id })}
        />
      ) : null}
      {action.kind === "responsible" ? (
        <IdSelect
          value={action.sales_id}
          items={lookups.sales}
          allowNone={translate("salesbot.set.round_robin")}
          label={translate("salesbot.set.responsible")}
          onChange={(sales_id) => patch({ sales_id })}
        />
      ) : null}
      {action.kind === "tag_add" || action.kind === "tag_remove" ? (
        <IdSelect
          value={action.tag_id}
          items={lookups.tags}
          label={translate(`salesbot.set.${action.kind}`)}
          onChange={(tag_id) => patch({ tag_id })}
        />
      ) : null}
      {action.kind === "field" ? (
        <IdSelect
          value={action.field_id}
          items={lookups.fields}
          label={translate("salesbot.set.field")}
          onChange={(field_id) => patch({ field_id })}
        />
      ) : null}
      {action.kind === "deal_field" || action.kind === "patient_field" ? (
        <Select
          value={action.field ?? ""}
          onValueChange={(field) => onChange({ kind: action.kind, field })}
        >
          <SelectTrigger
            className="w-full"
            aria-label={translate(`salesbot.set.${action.kind}`)}
          >
            <SelectValue placeholder={translate("salesbot.panel.choose")} />
          </SelectTrigger>
          <SelectContent>
            {(action.kind === "deal_field" ? DEAL_FIELDS : PATIENT_FIELDS).map(
              (field) => (
                <SelectItem key={field} value={field}>
                  {translate(
                    `salesbot.${action.kind === "deal_field" ? "deal_fields" : "patient_fields"}.${field}`,
                  )}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      ) : null}
      {referenceList ? (
        <IdSelect
          value={action.value}
          items={referenceList}
          label={translate("salesbot.set.value")}
          onChange={(value) =>
            patch({ value: value == null ? null : String(value) })
          }
        />
      ) : action.kind === "field" ||
        action.kind === "patient_field" ||
        (action.kind === "deal_field" && action.field) ? (
        <>
          <Input
            value={action.value ?? ""}
            aria-label={translate("salesbot.set.value")}
            placeholder={translate("salesbot.set.value")}
            onChange={(event) => patch({ value: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            {translate("salesbot.panel.value_hint")}
          </p>
        </>
      ) : null}
    </div>
  );
};

export const Field = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    {children}
  </div>
);

export const SmallButton = ({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-fit shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
  >
    {children}
  </button>
);

const NumberInput = ({
  value,
  label,
  onChange,
}: {
  value: number | undefined;
  label: string;
  onChange: (value: number) => void;
}) => (
  <Input
    type="number"
    min={0}
    value={value ?? ""}
    aria-label={label}
    className="w-32"
    onChange={(event) => onChange(Number(event.target.value))}
  />
);

export const IdSelect = ({
  value,
  items,
  label,
  allowNone,
  onChange,
}: {
  value: Identifier | string | null | undefined;
  items: { id: Identifier; name: string }[];
  label: string;
  allowNone?: string;
  onChange: (value: number | null) => void;
}) => (
  <Select
    value={
      value != null && value !== "" ? String(value) : allowNone ? NONE : ""
    }
    onValueChange={(next) => onChange(next === NONE ? null : Number(next))}
  >
    <SelectTrigger className="w-full" aria-label={label}>
      <SelectValue placeholder={label} />
    </SelectTrigger>
    <SelectContent>
      {allowNone ? <SelectItem value={NONE}>{allowNone}</SelectItem> : null}
      {items.map((item) => (
        <SelectItem key={item.id} value={String(item.id)}>
          {item.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
