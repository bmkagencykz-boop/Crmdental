import { useNotify, useTranslate, type Identifier } from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { DentalChart } from "../dental-chart/DentalChart";
import {
  parseTeeth,
  preferredDentition,
  selectionTargets,
  type Area,
  type Dentition,
} from "../dental-chart/teeth";
import {
  toDoctorChoices,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import { CellInput } from "./PlanBits";
import { Field, PillSelect, pillInput } from "./PlanFields";
import { activeChoices, pickId, STAGE_TONE } from "./planUi";
import {
  lineTotal,
  moveInStage,
  nextPosition,
  parseNumber,
  type PlanTotals,
} from "./planMath";
import {
  chartMarks,
  linesForTargets,
  MAX_STAGES,
  nextStagePosition,
} from "./planStages";
import { ServiceSearch } from "./ServiceSearch";
import {
  STAGE_STATUSES,
  type TreatmentPlan,
  type TreatmentPlanItem,
  type TreatmentStage,
} from "./types";
import {
  useDirections,
  usePlanMutations,
  useStageTemplates,
} from "./useTreatmentPlans";

const tenge = (amount: number) => `${formatTenge(amount)} ₸`;
const percentText = (value: number) =>
  Number(value) ? String(Number(value)).replace(".", ",") : "";

/**
 * The stages of a plan (stage 34): tabs «Этап 1», «Этап 2», «+»; the
 * fields of the stage, the dental chart and the services of the stage.
 * The fields of a stage are drafts saved with «Сохранить»; the services
 * are saved at once, like in a table.
 */
export const PlanStages = ({
  plan,
  stages,
  savedStages,
  items,
  totals,
  canEdit,
  onStageChange,
  onSave,
  saving,
  dirty,
}: {
  plan: TreatmentPlan;
  /** The stages with their unsaved drafts */
  stages: TreatmentStage[];
  savedStages: TreatmentStage[];
  items: TreatmentPlanItem[];
  totals: PlanTotals;
  canEdit: boolean;
  onStageChange: (
    stage: TreatmentStage,
    patch: Partial<TreatmentStage>,
  ) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data: templates = [] } = useStageTemplates(canEdit);
  const { createStage, deleteStage, saveTemplate, addFromTemplate } =
    usePlanMutations();
  const [activeId, setActiveId] = useState<Identifier | null>(null);
  const active =
    stages.find((stage) => String(stage.id) === String(activeId)) ?? stages[0];
  const saved = savedStages.find(
    (stage) => String(stage.id) === String(active?.id),
  );

  const statusLabel = (status: string) =>
    translate(`plan_editor.stages.statuses.${status}`);

  const addStage = () => {
    if (nextStagePosition(stages) > MAX_STAGES) {
      notify("plan_editor.stages.max", { type: "warning" });
      return;
    }
    createStage.mutate(
      { plan_id: plan.id, doctor_id: plan.doctor_id ?? null },
      { onSuccess: (stage) => setActiveId(stage.id) },
    );
  };

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label={translate("plan_editor.stages.tabs")}
      >
        {stages.map((stage) => {
          const selected = String(stage.id) === String(active?.id);
          const title = translate("treatment.stage", { n: stage.position });
          return (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={stage.name}
              onClick={() => setActiveId(stage.id)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-full pr-2 pl-5 text-sm transition-colors",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-pill",
              )}
            >
              <span>{title}</span>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px]",
                  selected
                    ? stage.status === "new"
                      ? "bg-white/15 text-primary-foreground"
                      : stage.status === "cancelled"
                        ? "bg-white/15 text-primary-foreground line-through"
                        : "bg-neon text-neon-ink"
                    : STAGE_TONE[stage.status],
                )}
              >
                {statusLabel(stage.status)}
              </span>
            </button>
          );
        })}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={translate("plan_editor.stages.add")}
                title={translate("plan_editor.stages.add")}
                className="flex size-11 items-center justify-center rounded-full bg-card text-xl font-light transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                +
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem onSelect={addStage}>
                {translate("plan_editor.stages.new_stage")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {translate("plan_editor.stages.from_template")}
              </DropdownMenuLabel>
              {templates.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {translate("plan_editor.stages.no_templates")}
                </p>
              ) : (
                templates.map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    onSelect={() =>
                      addFromTemplate.mutate(
                        { plan, template },
                        {
                          onSuccess: (id) => {
                            setActiveId(id);
                            notify("plan_editor.notify.template_added", {
                              type: "info",
                            });
                          },
                        },
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {template.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {template.items?.length ?? 0}
                    </span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {active ? (
        <StageEditor
          key={String(active.id)}
          plan={plan}
          stage={active}
          items={items}
          totals={totals}
          canEdit={canEdit}
          onChange={(patch) => onStageChange(active, patch)}
        />
      ) : null}

      {canEdit ? (
        <div
          className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 self-start rounded-full bg-card/90 p-2 shadow-[0_18px_40px_-24px_rgba(18,18,20,0.45)] backdrop-blur"
          role="toolbar"
          aria-label={translate("plan_editor.title")}
        >
          <Button onClick={onSave} disabled={saving}>
            {translate(
              saving
                ? "plan_editor.actions.saving"
                : "plan_editor.actions.save",
            )}
          </Button>
          <Button
            variant="outline"
            disabled={!saved || saveTemplate.isPending}
            onClick={() => {
              if (!saved) return;
              const name = window.prompt(
                translate("plan_editor.actions.template_name"),
                active?.name ?? saved.name,
              );
              if (name == null) return;
              saveTemplate.mutate({ stage: saved, name: name.trim() });
            }}
          >
            {translate("plan_editor.actions.save_template")}
          </Button>
          <Button
            variant="outline"
            disabled={!saved || deleteStage.isPending}
            onClick={() => {
              if (!saved) return;
              if (
                window.confirm(
                  translate("plan_editor.actions.delete_stage_confirm", {
                    name: saved.name,
                  }),
                )
              ) {
                deleteStage.mutate(saved, {
                  onSuccess: () => setActiveId(null),
                });
              }
            }}
          >
            {translate("plan_editor.actions.delete_stage")}
          </Button>
          {dirty ? (
            <span className="px-3 text-xs text-muted-foreground">
              {translate("plan_editor.actions.unsaved")}
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
};

/** The fields of a stage, its dental chart and its services */
const StageEditor = ({
  plan,
  stage,
  items,
  totals,
  canEdit,
  onChange,
}: {
  plan: TreatmentPlan;
  stage: TreatmentStage;
  items: TreatmentPlanItem[];
  totals: PlanTotals;
  canEdit: boolean;
  onChange: (patch: Partial<TreatmentStage>) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data: doctors } = useDoctors();
  const { data: directions } = useDirections();
  const { data: services } = useServices();
  const { createItem, updateItem, deleteItem } = usePlanMutations();
  const group = totals.stages.find(
    (g) => String(g.stage?.id) === String(stage.id),
  );
  const stageItems = useMemo(() => group?.items ?? [], [group]);
  const marks = useMemo(() => chartMarks(stageItems), [stageItems]);
  const [teeth, setTeeth] = useState<number[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [dentition, setDentition] = useState<Dentition>(() =>
    preferredDentition(stageItems.flatMap((item) => parseTeeth(item.tooth))),
  );
  const [adding, setAdding] = useState(false);
  const readOnly = !canEdit;

  const itemLabel = (field: string, item: TreatmentPlanItem) =>
    translate("treatment.fields.item_for", {
      field: translate(`treatment.fields.${field}`),
      name: item.name,
    });
  const saveItem = (
    item: TreatmentPlanItem,
    data: Partial<TreatmentPlanItem>,
  ) => updateItem.mutate({ item, data });
  const move = (item: TreatmentPlanItem, direction: -1 | 1) => {
    for (const change of moveInStage(stageItems, item.id, direction)) {
      const row = stageItems.find((i) => String(i.id) === String(change.id));
      if (row) saveItem(row, { position: change.position });
    }
  };

  const addService = async ({
    service,
    name,
  }: {
    service?: { id: Identifier; name: string; price?: number | null };
    name: string;
  }) => {
    const lines = linesForTargets({
      planId: plan.id,
      stage,
      service: service
        ? { id: service.id, name: service.name, price: service.price ?? 0 }
        : undefined,
      name,
      targets: selectionTargets(teeth, areas),
      startPosition: nextPosition(items, stage.position),
    });
    setAdding(true);
    try {
      for (const line of lines) {
        await createItem.mutateAsync(line);
      }
      notify("plan_editor.items.added", {
        type: "info",
        messageArgs: { smart_count: lines.length },
      });
      setTeeth([]);
      setAreas([]);
    } catch {
      // Shown by the mutation
    } finally {
      setAdding(false);
    }
  };

  const serviceCode = (item: TreatmentPlanItem) =>
    services.find((s) => String(s.id) === String(item.service_id))?.code ?? "";
  const targets = selectionTargets(teeth, areas);

  return (
    <div className="flex flex-col gap-5" role="tabpanel">
      {/* The stage: a table of one row, like the MIS */}
      <section
        className="rounded-[28px] bg-card p-6"
        aria-label={translate("plan_editor.stages.tabs")}
      >
        <div className="grid gap-4 md:grid-cols-3 2xl:grid-cols-[1.4fr_1fr_1fr_0.8fr_0.8fr_0.7fr]">
          <Field label={translate("plan_editor.stages.fields.name")} required>
            <input
              value={stage.name ?? ""}
              disabled={readOnly}
              maxLength={200}
              onChange={(event) => onChange({ name: event.target.value })}
              className={pillInput}
            />
          </Field>
          <Field label={translate("plan_editor.stages.fields.doctor")}>
            <PillSelect
              label={translate("plan_editor.stages.fields.doctor")}
              value={stage.doctor_id}
              disabled={readOnly}
              empty={translate("plan_editor.fields.not_set")}
              options={toDoctorChoices(doctors, stage.doctor_id)}
              onChange={(value) =>
                onChange({ doctor_id: pickId(doctors, value) })
              }
            />
          </Field>
          <Field label={translate("plan_editor.stages.fields.direction")}>
            <PillSelect
              label={translate("plan_editor.stages.fields.direction")}
              value={stage.direction_id}
              disabled={readOnly}
              empty={translate("plan_editor.fields.not_set")}
              options={activeChoices(directions, stage.direction_id)}
              onChange={(value) =>
                onChange({ direction_id: pickId(directions, value) })
              }
            />
          </Field>
          <Field label={translate("plan_editor.stages.fields.deadline")}>
            <input
              type="date"
              value={stage.deadline ?? ""}
              disabled={readOnly}
              aria-label={translate("plan_editor.stages.fields.deadline")}
              onChange={(event) =>
                onChange({ deadline: event.target.value || null })
              }
              className={pillInput}
            />
          </Field>
          <Field label={translate("plan_editor.stages.fields.status")}>
            <PillSelect
              label={translate("plan_editor.stages.fields.status")}
              value={stage.status}
              disabled={readOnly}
              options={STAGE_STATUSES.map((status) => ({
                id: status,
                name: translate(`plan_editor.stages.statuses.${status}`),
              }))}
              onChange={(value) =>
                onChange({
                  status: (value ?? "new") as TreatmentStage["status"],
                })
              }
            />
          </Field>
          <Field label={translate("plan_editor.stages.fields.discount")}>
            <input
              key={String(stage.discount_percent)}
              defaultValue={percentText(stage.discount_percent)}
              placeholder="0"
              inputMode="decimal"
              disabled={readOnly}
              aria-label={translate("plan_editor.stages.fields.discount")}
              onBlur={(event) => {
                const value = Math.min(
                  100,
                  Math.max(0, parseNumber(event.target.value)),
                );
                if (value !== Number(stage.discount_percent)) {
                  onChange({ discount_percent: value });
                }
              }}
              className={cn(pillInput, "text-right tabular-nums")}
            />
          </Field>
          <Field
            label={translate("plan_editor.stages.fields.description")}
            className="md:col-span-3 2xl:col-span-6"
          >
            <textarea
              value={stage.description ?? ""}
              disabled={readOnly}
              rows={2}
              onChange={(event) =>
                onChange({ description: event.target.value || null })
              }
              className="field min-h-12 w-full rounded-2xl px-4 py-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          </Field>
        </div>
        {stage.status === "cancelled" ? (
          <p className="mt-3 px-1 text-xs text-tone-red">
            {translate("plan_editor.stages.cancelled_hint")}
          </p>
        ) : null}
      </section>

      {/* The dental chart: pick teeth, then a service of the price list */}
      <section
        className="flex flex-col gap-5 rounded-[28px] bg-card p-6"
        aria-label={translate("plan_editor.chart.title")}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
              {translate("plan_editor.chart.title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {translate("plan_editor.chart.hint")}
            </p>
          </div>
        </div>
        <DentalChart
          dentition={dentition}
          onDentitionChange={setDentition}
          selected={teeth}
          onSelectedChange={canEdit ? setTeeth : undefined}
          areas={areas}
          onAreasChange={canEdit ? setAreas : undefined}
          marks={marks.teeth}
          areaMarks={marks.areas}
          disabled={!canEdit}
        />
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[22px] bg-background/70 p-3">
            <span
              className={cn(
                "rounded-full px-4 py-2 text-sm",
                targets.length
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
              data-testid="chart-selection"
            >
              {targets.length
                ? translate("plan_editor.chart.selected", {
                    list: targets.join(", "),
                  })
                : translate("plan_editor.chart.none")}
            </span>
            {targets.length ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTeeth([]);
                  setAreas([]);
                }}
              >
                {translate("plan_editor.chart.clear")}
              </Button>
            ) : null}
            <div className="min-w-[18rem] flex-1">
              <ServiceSearch disabled={adding} onPick={addService} />
            </div>
          </div>
        ) : null}
      </section>

      {/* The services of the stage */}
      <section
        className="rounded-[28px] bg-card p-6"
        aria-label={translate("plan_editor.items.title")}
      >
        <h2 className="mb-4 text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("plan_editor.items.title")}
        </h2>
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[56rem] border-separate border-spacing-y-1 text-[13px]"
            data-testid="stage-items"
          >
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="w-8 px-2 py-1.5 font-medium">
                  {translate("plan_editor.items.no")}
                </th>
                <th className="w-28 px-1.5 py-1.5 font-medium">
                  {translate("plan_editor.items.tooth")}
                </th>
                <th className="w-16 px-1.5 py-1.5 font-medium">
                  {translate("plan_editor.items.code")}
                </th>
                <th className="px-1.5 py-1.5 font-medium">
                  {translate("plan_editor.items.service")}
                </th>
                <th className="w-16 px-1.5 py-1.5 text-right font-medium">
                  {translate("plan_editor.items.qty")}
                </th>
                <th className="w-28 px-1.5 py-1.5 text-right font-medium">
                  {translate("plan_editor.items.price")}
                </th>
                <th className="w-20 px-1.5 py-1.5 text-right font-medium">
                  {translate("plan_editor.items.discount")}
                </th>
                <th className="w-28 px-1.5 py-1.5 text-right font-medium">
                  {translate("plan_editor.items.sum")}
                </th>
                <th className="w-20 px-1.5 py-1.5 text-center font-medium">
                  {translate("plan_editor.items.done")}
                </th>
                {canEdit ? <th className="w-24" aria-hidden /> : null}
              </tr>
            </thead>
            <tbody>
              {stageItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="rounded-2xl bg-background/60 px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    {translate("plan_editor.items.empty")}
                  </td>
                </tr>
              ) : null}
              {stageItems.map((item, index) => (
                <tr
                  key={item.id}
                  className={cn(
                    "bg-background/60 [&>td:first-child]:rounded-l-2xl [&>td:last-child]:rounded-r-2xl",
                    item.done && "text-muted-foreground",
                  )}
                >
                  <td className="px-2 py-1 tabular-nums">{index + 1}</td>
                  <td className="px-0.5 py-1">
                    <CellInput
                      value={item.tooth ?? ""}
                      label={itemLabel("tooth", item)}
                      placeholder="—"
                      disabled={readOnly}
                      onCommit={(tooth) =>
                        saveItem(item, { tooth: tooth || null })
                      }
                    />
                  </td>
                  <td className="px-1.5 py-1 text-xs text-muted-foreground tabular-nums">
                    {serviceCode(item)}
                  </td>
                  <td className="px-0.5 py-1">
                    {canEdit ? (
                      <CellInput
                        value={item.name}
                        label={itemLabel("service", item)}
                        onCommit={(name) => name && saveItem(item, { name })}
                        className={cn(item.done && "line-through")}
                      />
                    ) : (
                      <span className="px-1.5">{item.name}</span>
                    )}
                  </td>
                  <td className="px-0.5 py-1">
                    <CellInput
                      value={String(item.quantity)}
                      label={itemLabel("qty", item)}
                      align="right"
                      inputMode="numeric"
                      disabled={readOnly}
                      onCommit={(raw) =>
                        saveItem(item, {
                          quantity: Math.min(
                            1000,
                            Math.max(1, Math.round(parseNumber(raw, 1))),
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="px-0.5 py-1">
                    <CellInput
                      value={formatTenge(item.unit_price)}
                      label={itemLabel("price", item)}
                      align="right"
                      inputMode="numeric"
                      disabled={readOnly}
                      onCommit={(raw) =>
                        saveItem(item, { unit_price: parsePrice(raw) ?? 0 })
                      }
                    />
                  </td>
                  <td className="px-0.5 py-1">
                    <CellInput
                      value={percentText(item.discount_percent)}
                      label={itemLabel("discount", item)}
                      align="right"
                      inputMode="decimal"
                      placeholder="0"
                      disabled={readOnly}
                      onCommit={(raw) =>
                        saveItem(item, {
                          discount_percent: Math.min(
                            100,
                            Math.max(0, parseNumber(raw)),
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums">
                    {tenge(
                      lineTotal(
                        item.quantity,
                        item.unit_price,
                        item.discount_percent,
                      ),
                    )}
                  </td>
                  <td className="px-1.5 py-1 text-center">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={readOnly}
                      aria-label={itemLabel("done", item)}
                      onChange={(event) =>
                        saveItem(item, { done: event.target.checked })
                      }
                      className="size-4 accent-primary"
                    />
                  </td>
                  {canEdit ? (
                    <td className="px-1 py-1">
                      <div className="flex items-center justify-end gap-0.5">
                        <RowButton
                          label={`${translate("plan_editor.items.move_up")}: ${item.name}`}
                          disabled={index === 0}
                          onClick={() => move(item, -1)}
                        >
                          ↑
                        </RowButton>
                        <RowButton
                          label={`${translate("plan_editor.items.move_down")}: ${item.name}`}
                          disabled={index === stageItems.length - 1}
                          onClick={() => move(item, 1)}
                        >
                          ↓
                        </RowButton>
                        <RowButton
                          label={`${translate("plan_editor.items.remove")}: ${item.name}`}
                          onClick={() => deleteItem.mutate(item)}
                        >
                          ×
                        </RowButton>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="mt-4 ml-auto flex max-w-sm flex-col gap-1.5 text-sm"
          role="group"
          aria-label={translate("plan_editor.items.stage_total")}
          data-testid="stage-totals"
        >
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {translate("plan_editor.items.subtotal")}
            </span>
            <span className="tabular-nums">{tenge(group?.subtotal ?? 0)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">
              {translate("plan_editor.items.stage_discount")}
              {Number(stage.discount_percent)
                ? ` (${percentText(stage.discount_percent)} %)`
                : ""}
            </span>
            <span className="tabular-nums">
              {group?.discount ? `− ${tenge(group.discount)}` : tenge(0)}
            </span>
          </div>
          <div className="flex justify-between gap-3 text-base font-semibold">
            <span>{translate("plan_editor.items.stage_total")}</span>
            <span className="tabular-nums">{tenge(group?.total ?? 0)}</span>
          </div>
        </div>
      </section>
    </div>
  );
};

const RowButton = ({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: string;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
  >
    {children}
  </button>
);
