import { useNotify, useTranslate } from "ra-core";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  findById,
  toDoctorChoices,
  useDoctors,
} from "../dictionaries/useDictionaries";
import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import type { Deal } from "../types";
import { EstimateActions } from "./EstimateActions";
import { CellInput, MainPlanMark, PlanStatusBadge } from "./PlanBits";
import {
  lineTotal,
  moveInStage,
  nextPosition,
  parseNumber,
  planTotals,
  remainingToPay,
} from "./planMath";
import { ServiceSearch } from "./ServiceSearch";
import type { PlanStatus, TreatmentPlan, TreatmentPlanItem } from "./types";
import {
  usePlanItems,
  usePlanMutations,
  usePlanRights,
} from "./useTreatmentPlans";

const tenge = (amount: number) => `${formatTenge(amount)} ₸`;
const percentText = (value: number) =>
  Number(value) ? String(Number(value)).replace(".", ",") : "";

/** The status buttons of a plan, by its status */
const STATUS_ACTIONS: Record<
  PlanStatus,
  Array<{ status: PlanStatus; label: string; primary?: boolean }>
> = {
  draft: [
    { status: "presented", label: "present" },
    { status: "agreed", label: "agree", primary: true },
    { status: "declined", label: "decline" },
  ],
  presented: [
    { status: "agreed", label: "agree", primary: true },
    { status: "declined", label: "decline" },
    { status: "draft", label: "to_draft" },
  ],
  agreed: [{ status: "declined", label: "decline" }],
  in_progress: [{ status: "declined", label: "decline" }],
  completed: [],
  declined: [{ status: "draft", label: "to_draft" }],
};

/**
 * The plan editor: items from the price list grouped by stage (tooth,
 * quantity, price, discount, done), reordered with the arrows or moved to
 * another stage, the discounts of the plan, the totals, the status actions
 * («Показан пациенту», «Согласован», «Отказ»), «Дублировать план» and the
 * estimate. Everything is saved at once; the database keeps the totals and
 * the deal amount.
 */
export const PlanEditor = ({
  deal,
  plan,
  onDuplicated,
  onDeleted,
}: {
  deal: Deal;
  plan: TreatmentPlan;
  onDuplicated?: () => void;
  onDeleted?: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const { data: items = [] } = usePlanItems(plan.id);
  const { data: doctors } = useDoctors();
  const { canEdit, unlimited, maxDiscount } = usePlanRights();
  const {
    updatePlan,
    deletePlan,
    duplicatePlan,
    createItem,
    updateItem,
    deleteItem,
  } = usePlanMutations();
  const totals = useMemo(() => planTotals(plan, items), [plan, items]);
  const [extraStages, setExtraStages] = useState<number[]>([]);
  const stageNumbers = useMemo(
    () =>
      [...new Set([1, ...items.map((i) => i.stage_no), ...extraStages])].sort(
        (a, b) => a - b,
      ),
    [items, extraStages],
  );
  const [target, setTarget] = useState<number | null>(null);
  const targetStage = target ?? stageNumbers.at(-1) ?? 1;
  const itemLabel = (field: string, item: TreatmentPlanItem) =>
    translate("treatment.fields.item_for", {
      field: translate(`treatment.fields.${field}`),
      name: item.name,
    });

  const savePlan = (data: Partial<TreatmentPlan>) =>
    updatePlan.mutate({ plan, data });
  const saveItem = (
    item: TreatmentPlanItem,
    data: Partial<TreatmentPlanItem>,
  ) => updateItem.mutate({ item, data });

  const setStatus = (status: PlanStatus) =>
    updatePlan.mutate(
      { plan, data: { status } },
      {
        onSuccess: () => {
          if (status === "agreed") {
            notify("treatment.notify.agreed", {
              type: "info",
              messageArgs: { amount: tenge(totals.total) },
            });
          }
        },
      },
    );

  const move = (item: TreatmentPlanItem, direction: -1 | 1) => {
    for (const change of moveInStage(items, item.id, direction)) {
      const row = items.find((i) => String(i.id) === String(change.id));
      if (row) saveItem(row, { position: change.position });
    }
  };

  const addStage = () => {
    const next = (stageNumbers.at(-1) ?? 1) + 1;
    if (next > 20) return;
    setExtraStages((stages) => [...stages, next]);
    setTarget(next);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="treatment-plan-editor">
      <div className="flex flex-wrap items-center gap-2 pr-8">
        {canEdit ? (
          <CellInput
            value={plan.name}
            label={translate("treatment.fields.name")}
            onCommit={(name) => name && savePlan({ name })}
            className="h-8 max-w-sm text-base font-semibold"
          />
        ) : (
          <span className="text-base font-semibold">{plan.name}</span>
        )}
        <PlanStatusBadge status={plan.status} />
        {plan.is_main ? <MainPlanMark /> : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {translate("treatment.totals.progress", {
            done: totals.doneCount,
            total: totals.itemsCount,
          })}
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <select
          value={plan.doctor_id == null ? "" : String(plan.doctor_id)}
          disabled={!canEdit}
          aria-label={translate("treatment.fields.doctor")}
          onChange={(event) =>
            savePlan({
              doctor_id:
                event.target.value === ""
                  ? null
                  : (findById(doctors, event.target.value)?.id ??
                    event.target.value),
            })
          }
          className="soft h-8 rounded-md border-0 px-2 text-sm"
        >
          <option value="">{translate("treatment.fields.no_doctor")}</option>
          {toDoctorChoices(doctors, plan.doctor_id).map((doctor) => (
            <option key={doctor.id} value={String(doctor.id)}>
              {doctor.name}
            </option>
          ))}
        </select>
        {canEdit ? (
          <>
            {STATUS_ACTIONS[plan.status].map((action) => (
              <Button
                key={action.status}
                size="sm"
                variant={action.primary ? "default" : "outline"}
                disabled={updatePlan.isPending}
                onClick={() => setStatus(action.status)}
              >
                {translate(`treatment.actions.${action.label}`)}
              </Button>
            ))}
            {!plan.is_main &&
            ["agreed", "in_progress", "completed"].includes(plan.status) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => savePlan({ is_main: true })}
              >
                {translate("treatment.actions.make_main")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={duplicatePlan.isPending}
              onClick={() =>
                duplicatePlan.mutate(plan, {
                  onSuccess: () => onDuplicated?.(),
                })
              }
            >
              {translate("treatment.actions.duplicate")}
            </Button>
          </>
        ) : null}
        <div className="ml-auto">
          <EstimateActions deal={deal} plan={plan} items={items} />
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[46rem] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <th
                className="w-8 px-2 py-1.5"
                title={translate("treatment.fields.done")}
              >
                ✓
              </th>
              <th className="px-1.5 py-1.5">
                {translate("treatment.fields.service")}
              </th>
              <th className="w-20 px-1.5 py-1.5">
                {translate("treatment.fields.tooth")}
              </th>
              <th className="w-14 px-1.5 py-1.5 text-right">
                {translate("treatment.fields.qty")}
              </th>
              <th className="w-24 px-1.5 py-1.5 text-right">
                {translate("treatment.fields.price")}
              </th>
              <th className="w-16 px-1.5 py-1.5 text-right">
                {translate("treatment.fields.discount")}
              </th>
              <th className="w-24 px-1.5 py-1.5 text-right">
                {translate("treatment.fields.sum")}
              </th>
              {canEdit ? <th className="w-28 px-1 py-1.5" aria-hidden /> : null}
            </tr>
          </thead>
          <tbody>
            {totals.stages.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-4 text-center text-muted-foreground"
                >
                  {translate("treatment.items.empty")}
                </td>
              </tr>
            ) : null}
            {totals.stages.map((stage) => (
              <Fragment key={stage.stage_no}>
                <tr className="border-b border-border bg-card/60">
                  <td colSpan={6} className="px-2 py-1 text-xs font-semibold">
                    {translate("treatment.stage", { n: stage.stage_no })}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {translate("treatment.totals.progress", {
                        done: stage.done,
                        total: stage.items.length,
                      })}
                    </span>
                  </td>
                  <td className="px-1.5 py-1 text-right text-xs font-semibold tabular-nums">
                    {tenge(stage.subtotal)}
                  </td>
                  {canEdit ? <td /> : null}
                </tr>
                {stage.items.map((item, index) => (
                  <tr
                    key={item.id}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      item.done && "text-muted-foreground",
                    )}
                  >
                    <td className="px-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={!canEdit}
                        aria-label={itemLabel("done", item)}
                        onChange={(event) =>
                          saveItem(item, { done: event.target.checked })
                        }
                        className="size-3.5 accent-primary"
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
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
                    <td className="px-0.5 py-0.5">
                      <CellInput
                        value={item.tooth ?? ""}
                        label={itemLabel("tooth", item)}
                        placeholder={translate(
                          "treatment.fields.tooth_placeholder",
                        )}
                        disabled={!canEdit}
                        onCommit={(tooth) =>
                          saveItem(item, { tooth: tooth || null })
                        }
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                      <CellInput
                        value={String(item.quantity)}
                        label={itemLabel("qty", item)}
                        align="right"
                        inputMode="numeric"
                        disabled={!canEdit}
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
                    <td className="px-0.5 py-0.5">
                      <CellInput
                        value={formatTenge(item.unit_price)}
                        label={itemLabel("price", item)}
                        align="right"
                        inputMode="numeric"
                        disabled={!canEdit}
                        onCommit={(raw) =>
                          saveItem(item, { unit_price: parsePrice(raw) ?? 0 })
                        }
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                      <CellInput
                        value={percentText(item.discount_percent)}
                        label={itemLabel("discount", item)}
                        align="right"
                        inputMode="decimal"
                        placeholder="0"
                        disabled={!canEdit}
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
                    <td className="px-1.5 py-0.5 text-right tabular-nums">
                      {tenge(
                        lineTotal(
                          item.quantity,
                          item.unit_price,
                          item.discount_percent,
                        ),
                      )}
                    </td>
                    {canEdit ? (
                      <td className="px-1 py-0.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <select
                            value={item.stage_no}
                            aria-label={translate("treatment.items.stage_for", {
                              name: item.name,
                            })}
                            onChange={(event) => {
                              const stageNo = Number(event.target.value);
                              saveItem(item, {
                                stage_no: stageNo,
                                position: nextPosition(items, stageNo),
                              });
                            }}
                            className="h-6 rounded-sm border border-border bg-transparent px-0.5 text-xs"
                          >
                            {stageNumbers.map((n) => (
                              <option key={n} value={n}>
                                {translate("treatment.stage", { n })}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                            disabled={index === 0}
                            onClick={() => move(item, -1)}
                            aria-label={`${translate("treatment.items.move_up")}: ${item.name}`}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                            disabled={index === stage.items.length - 1}
                            onClick={() => move(item, 1)}
                            aria-label={`${translate("treatment.items.move_down")}: ${item.name}`}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                            onClick={() => deleteItem.mutate(item)}
                            aria-label={`${translate("treatment.items.remove")}: ${item.name}`}
                          >
                            ×
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <ServiceSearch
            disabled={createItem.isPending}
            onPick={({ service, name }) =>
              createItem.mutate({
                plan_id: plan.id,
                stage_no: targetStage,
                service_id: service?.id ?? null,
                name,
                quantity: 1,
                unit_price: Math.round(service?.price ?? 0),
                discount_percent: 0,
                done: false,
                position: nextPosition(items, targetStage),
              })
            }
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {translate("treatment.items.target_stage")}
            <select
              value={targetStage}
              onChange={(event) => setTarget(Number(event.target.value))}
              className="soft h-8 rounded-md border-0 px-2 text-sm text-foreground"
            >
              {stageNumbers.map((n) => (
                <option key={n} value={n}>
                  {translate("treatment.stage", { n })}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="ghost" onClick={addStage}>
            {translate("treatment.items.add_stage")}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {translate("treatment.fields.plan_discount_percent")}
              </span>
              <CellInput
                value={percentText(plan.discount_percent)}
                label={translate("treatment.fields.plan_discount_percent")}
                align="right"
                inputMode="decimal"
                placeholder="0"
                disabled={!canEdit}
                className="w-16 border-border"
                onCommit={(raw) =>
                  savePlan({
                    discount_percent: Math.min(
                      100,
                      Math.max(0, parseNumber(raw)),
                    ),
                  })
                }
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">
                {translate("treatment.fields.plan_discount_amount")}
              </span>
              <CellInput
                value={
                  plan.discount_amount ? formatTenge(plan.discount_amount) : ""
                }
                label={translate("treatment.fields.plan_discount_amount")}
                align="right"
                inputMode="numeric"
                placeholder="0"
                disabled={!canEdit}
                className="w-24 border-border"
                onCommit={(raw) =>
                  savePlan({ discount_amount: parsePrice(raw) ?? 0 })
                }
              />
            </label>
          </div>
          {canEdit && !unlimited ? (
            <p className="text-xs text-muted-foreground">
              {translate("treatment.limits.discount", { max: maxDiscount })}
            </p>
          ) : null}
          <textarea
            key={plan.note ?? ""}
            defaultValue={plan.note ?? ""}
            disabled={!canEdit}
            rows={2}
            placeholder={translate("treatment.fields.note")}
            aria-label={translate("treatment.fields.note")}
            onBlur={(event) => {
              const note = event.target.value.trim() || null;
              if (note !== (plan.note ?? null)) savePlan({ note });
            }}
            className="field w-full rounded-md border border-input px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {canEdit ? (
            <button
              type="button"
              className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
              onClick={() => {
                if (
                  window.confirm(
                    translate("treatment.actions.delete_confirm", {
                      name: plan.name,
                    }),
                  )
                ) {
                  deletePlan.mutate(plan, { onSuccess: () => onDeleted?.() });
                }
              }}
            >
              {translate("treatment.actions.delete")}
            </button>
          ) : null}
        </div>
        <PlanTotals deal={deal} plan={plan} totals={totals} />
      </div>
    </div>
  );
};

const PlanTotals = ({
  deal,
  plan,
  totals,
}: {
  deal: Deal;
  plan: TreatmentPlan;
  totals: ReturnType<typeof planTotals>;
}) => {
  const translate = useTranslate();
  const row = (label: string, value: string, strong = false) => (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3",
        strong ? "text-base font-bold" : "text-sm text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <span className={cn("tabular-nums", !strong && "text-foreground")}>
        {value}
      </span>
    </div>
  );
  return (
    <div
      className="flex flex-col gap-1 rounded-md border border-border p-3"
      role="group"
      aria-label={translate("treatment.totals.total")}
    >
      {row(translate("treatment.totals.gross"), tenge(totals.gross))}
      {totals.itemsDiscount
        ? row(
            translate("treatment.totals.items_discount"),
            `− ${tenge(totals.itemsDiscount)}`,
          )
        : null}
      {totals.planDiscount
        ? row(
            translate("treatment.totals.plan_discount"),
            `− ${tenge(totals.planDiscount)}`,
          )
        : null}
      <div className="my-1 border-t border-border" />
      {row(translate("treatment.totals.total"), tenge(totals.total), true)}
      {plan.is_main ? (
        <>
          {row(
            translate("treatment.totals.paid"),
            tenge(deal.paid_amount ?? 0),
          )}
          {row(
            translate("treatment.totals.rest"),
            tenge(remainingToPay(totals.total, deal.paid_amount ?? 0)),
          )}
        </>
      ) : null}
    </div>
  );
};
