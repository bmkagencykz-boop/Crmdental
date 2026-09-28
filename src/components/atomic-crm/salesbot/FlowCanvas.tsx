import { useTranslate } from "ra-core";
import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { ValidationError } from "./engine";
import { slotLabel, STEP_BORDER, stepSummary } from "./labels";
import {
  buildFlow,
  type Anchor,
  type FlowColumn,
  type FlowItem,
} from "./scenarioEdit";
import { STEP_TYPES, type Scenario, type Step, type StepType } from "./types";
import type { BotLookups } from "./useBotDictionaries";

type CanvasProps = {
  scenario: Scenario;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onInsert: (anchor: Anchor, type: StepType) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  errors: ValidationError[];
  lookups: BotLookups;
};

/**
 * The scenario as a vertical flow: cards connected top to bottom, the
 * branches of a wait or a condition side by side as indented columns, a
 * «+» between any two steps. Text-first: a type label and a colored left
 * border per type.
 */
export const FlowCanvas = (props: CanvasProps) => {
  const translate = useTranslate();
  const { items, orphans } = buildFlow(props.scenario);
  return (
    <div
      className="flex flex-col items-stretch gap-0"
      data-testid="salesbot-flow"
    >
      <div className="mx-auto rounded-md border border-dashed px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {translate("salesbot.editor.start")}
      </div>
      <Insert anchor={{ kind: "start" }} onInsert={props.onInsert} />
      <Chain items={items} {...props} />
      {orphans.length ? (
        <section className="mt-8 rounded-lg border border-dashed p-4">
          <h3 className="text-sm font-semibold">
            {translate("salesbot.editor.orphans")}
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {translate("salesbot.editor.orphans_hint")}
          </p>
          <div className="flex flex-col gap-2">
            {orphans.map((step) => (
              <StepCard key={step.id} step={step} {...props} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

const Chain = ({ items, ...props }: CanvasProps & { items: FlowItem[] }) => {
  const translate = useTranslate();
  const byId = (id: string) =>
    props.scenario.steps.find((step) => step.id === id);
  return (
    <>
      {items.map((item, index) => {
        switch (item.kind) {
          case "step":
            return (
              <Fragment key={item.step.id}>
                <StepCard step={item.step} {...props} />
                {item.columns.length ? (
                  <Columns step={item.step} columns={item.columns} {...props} />
                ) : item.step.type === "handoff" ||
                  item.step.type === "stop" ? null : (
                  <Insert
                    anchor={{
                      kind: "slot",
                      stepId: item.step.id,
                      slot: { kind: "next" },
                    }}
                    onInsert={props.onInsert}
                  />
                )}
              </Fragment>
            );
          case "jump": {
            const target = byId(item.target);
            return (
              <button
                key={`jump-${index}`}
                type="button"
                onClick={() => props.onSelect(item.target)}
                className="mx-auto rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {translate("salesbot.editor.jump", {
                  name: target
                    ? `${translate(`salesbot.types.${target.type}`)} ${target.id}`
                    : item.target,
                })}
              </button>
            );
          }
          case "missing":
            return (
              <p
                key={`missing-${index}`}
                className="mx-auto text-xs text-destructive"
              >
                {translate("salesbot.editor.missing", { id: item.target })}
              </p>
            );
          case "end":
            return (
              <div
                key={`end-${index}`}
                className="mx-auto text-xs uppercase tracking-wide text-muted-foreground"
              >
                {translate("salesbot.editor.end")}
              </div>
            );
        }
      })}
    </>
  );
};

const Columns = ({
  step,
  columns,
  ...props
}: CanvasProps & { step: Step; columns: FlowColumn[] }) => {
  const translate = useTranslate();
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 pl-4">
      {columns.map((column) => (
        <div
          key={JSON.stringify(column.slot)}
          className="flex min-w-[15rem] flex-1 flex-col rounded-lg border-l-2 border-dashed border-border bg-muted/30 px-2 pt-2 pb-3"
          data-testid="salesbot-column"
        >
          <p className="px-1 text-xs font-semibold text-muted-foreground">
            {slotLabel(step, column.slot, translate, props.lookups)}
          </p>
          <Insert
            anchor={{ kind: "slot", stepId: step.id, slot: column.slot }}
            onInsert={props.onInsert}
          />
          <Chain items={column.items} {...props} />
        </div>
      ))}
    </div>
  );
};

const StepCard = ({
  step,
  selected,
  onSelect,
  onDuplicate,
  onDelete,
  errors,
  lookups,
  scenario,
}: CanvasProps & { step: Step }) => {
  const translate = useTranslate();
  const stepErrors = errors.filter((error) => error.step === step.id);
  const isSelected = selected === step.id;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(step.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect(step.id);
      }}
      data-testid="salesbot-step"
      data-step-type={step.type}
      aria-pressed={isSelected}
      className={cn(
        "group relative w-full cursor-pointer rounded-md border border-l-4 bg-card px-3 py-2 text-left text-sm shadow-card transition-colors",
        STEP_BORDER[step.type],
        isSelected ? "ring-2 ring-ring" : "hover:bg-[var(--surface-strong)]",
        stepErrors.length ? "border-destructive/60" : null,
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide">
          {translate(`salesbot.types.${step.type}`)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {step.id}
          {scenario.start === step.id
            ? ` · ${translate("salesbot.editor.start")}`
            : ""}
        </span>
        <span className="ml-auto hidden gap-1 group-hover:flex group-focus-within:flex">
          <button
            type="button"
            className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate(step.id);
            }}
          >
            {translate("salesbot.editor.duplicate")}
          </button>
          <button
            type="button"
            className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(step.id);
            }}
          >
            {translate("salesbot.editor.delete")}
          </button>
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-line break-words text-[13px] text-foreground/85">
        {stepSummary(step, translate, lookups)}
      </p>
      {stepErrors.length ? (
        <p className="mt-1 text-[11px] text-destructive">
          {[...new Set(stepErrors.map((e) => e.code))]
            .map((code) => translate(`salesbot.validation.codes.${code}`))
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
};

/** The «+» between two steps: a connector with a menu of step types */
const Insert = ({
  anchor,
  onInsert,
}: {
  anchor: Anchor;
  onInsert: (anchor: Anchor, type: StepType) => void;
}) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col items-center py-0.5">
      <span className="h-2 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-5 min-w-5 items-center justify-center rounded-full border bg-background px-1.5 text-xs leading-none text-muted-foreground hover:border-foreground hover:text-foreground"
          aria-label={translate("salesbot.editor.add_step")}
          title={translate("salesbot.editor.add_step")}
        >
          +
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72">
          {STEP_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => onInsert(anchor, type)}
              className="flex flex-col items-start gap-0"
            >
              <span
                className={cn(
                  "border-l-4 pl-2 text-sm font-medium",
                  STEP_BORDER[type],
                )}
              >
                {translate(`salesbot.types.${type}`)}
              </span>
              <span className="pl-3 text-xs text-muted-foreground">
                {translate(`salesbot.type_hints.${type}`)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="h-2 w-px bg-border" />
    </div>
  );
};
