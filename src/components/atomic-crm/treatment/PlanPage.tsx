import {
  useCanAccess,
  useGetList,
  useGetOne,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { toDoctorChoices, useDoctors } from "../dictionaries/useDictionaries";
import { Molar3D } from "../misc/Dental3D";
import { formatTenge, parsePrice } from "../onboarding/servicePresets";
import { patientDisplayName } from "../patients/parsePatientText";
import type { Deal, Patient } from "../types";
import { EstimateActions } from "./EstimateActions";
import { MainPlanMark, PlanStatusBadge } from "./PlanBits";
import { Field, PillSelect, pillInput } from "./PlanFields";
import { activeChoices, pickId, planPath } from "./planUi";
import { parseNumber, planTotals, remainingToPay } from "./planMath";
import {
  extraDiscountData,
  extraDiscountMode,
  planDateText,
  planPaid,
  type DiscountMode,
} from "./planStages";
import { PlanStages } from "./PlanStages";
import {
  AGREED_STATUSES,
  PLAN_STATUSES,
  type TreatmentPlan,
  type TreatmentPlanSummary,
  type TreatmentStage,
} from "./types";
import {
  usePlanItems,
  usePlanMutations,
  usePlanRights,
  usePlanStages,
  usePlanTypes,
  usePlan,
} from "./useTreatmentPlans";

const tenge = (amount: number) => `${formatTenge(amount)} ₸`;

type HeaderDraft = Partial<
  Pick<
    TreatmentPlan,
    | "name"
    | "doctor_id"
    | "plan_type_id"
    | "status"
    | "complaints"
    | "insurance_policy"
    | "discount_percent"
    | "discount_amount"
    | "deal_id"
  >
>;

/**
 * «План лечения» as a full page (stage 34), like the plan screen of a
 * dental MIS: breadcrumbs, the header of the plan with its totals, the
 * stages as tabs with the dental chart and the services of every stage,
 * and a bar with «Сохранить», «Сохранить как шаблон этапа», «Удалить
 * этап». /patients/:patientId/plans/new?deal_id=… creates a plan.
 */
export const PlanPage = () => {
  const { patientId = "", planId = "new" } = useParams();
  const translate = useTranslate();
  const { canAccess: canSeePlans, isPending: rightsPending } = useCanAccess({
    resource: "treatment_plans",
    action: "list",
  });
  const isNew = planId === "new";
  const { data: plan, isPending } = usePlan(isNew ? undefined : planId);
  // The patient of the plan (an old link may name another one)
  const ownerId = plan?.patient_id ?? patientId;
  const { data: patient } = useGetOne<Patient>(
    "patients",
    { id: ownerId },
    { enabled: !!ownerId },
  );

  const patientName =
    patientDisplayName(patient) || translate("crm.deals.untitled");

  if (rightsPending) return null;
  if (!canSeePlans || (!isNew && !isPending && !plan)) {
    return (
      <EmptyCard
        text={translate("plan_editor.not_found")}
        patientId={patientId}
      />
    );
  }

  return (
    <div
      className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 pb-24"
      data-testid="plan-page"
    >
      <nav
        aria-label={translate("plan_editor.breadcrumbs")}
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          to="/patients"
          className="text-muted-foreground no-underline hover:text-foreground"
        >
          {translate("plan_editor.patients")}
        </Link>
        <span aria-hidden>/</span>
        <Link
          to={`/patients/${ownerId}/show`}
          className="text-muted-foreground no-underline hover:text-foreground"
        >
          {patientName}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-foreground" aria-current="page">
          {isNew ? translate("plan_editor.new_title") : (plan?.name ?? "…")}
        </span>
      </nav>
      {isNew ? (
        <PlanEditorBody key="new" patientId={patientId} />
      ) : plan ? (
        <PlanEditorBody
          key={String(plan.id)}
          patientId={String(ownerId)}
          plan={plan}
        />
      ) : null}
    </div>
  );
};

PlanPage.path = "/patients/:patientId/plans/:planId";

const EmptyCard = ({
  text,
  patientId,
}: {
  text: string;
  patientId?: string;
}) => {
  const translate = useTranslate();
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-[28px] bg-card p-10 text-center">
      <Molar3D tone="soft" className="h-28 w-24" />
      <p className="text-sm text-muted-foreground">{text}</p>
      {patientId ? (
        <Button variant="outline" asChild>
          <Link to={`/patients/${patientId}/show`}>
            {translate("plan_editor.patients")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
};

const PlanEditorBody = ({
  patientId,
  plan,
}: {
  patientId: string;
  plan?: TreatmentPlanSummary;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { canEdit, unlimited, maxDiscount } = usePlanRights();
  const { data: doctors } = useDoctors();
  const { data: planTypes } = usePlanTypes();
  const { data: items = [] } = usePlanItems(plan?.id);
  const { data: stages = [] } = usePlanStages(plan?.id);
  const { data: deals = [] } = useGetList<Deal>(
    "deals",
    {
      filter: { patient_id: patientId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 100 },
    },
    { enabled: !plan },
  );
  const { data: planDeal } = useGetOne<Deal>(
    "deals",
    { id: plan?.deal_id as Identifier },
    { enabled: plan?.deal_id != null },
  );
  const { createPlan, updatePlan, updateStage, deletePlan, duplicatePlan } =
    usePlanMutations();

  const requestedDeal = searchParams.get("deal_id");
  const newDeal =
    deals.find((deal) => String(deal.id) === requestedDeal) ??
    deals.find((deal) => !deal.archived_at) ??
    deals[0];

  const [header, setHeader] = useState<HeaderDraft>({});
  const [stageDrafts, setStageDrafts] = useState<
    Record<string, Partial<TreatmentStage>>
  >({});
  const [mode, setMode] = useState<DiscountMode>(() =>
    plan ? extraDiscountMode(plan) : "percent",
  );
  const [saving, setSaving] = useState(false);

  // A new plan: «План лечения, 28.09.2026», the deal and its doctor
  const base: HeaderDraft = plan ?? {
    name: translate("plan_editor.default_name", {
      date: planDateText(new Date()),
    }),
    deal_id: newDeal?.id,
    doctor_id: newDeal?.doctor_id ?? null,
    plan_type_id: planTypes?.find((type) => !type.is_archived)?.id ?? null,
    status: "draft",
    discount_percent: 0,
    discount_amount: 0,
    complaints: null,
    insurance_policy: null,
  };
  const values = { ...base, ...header } as TreatmentPlan;
  const set = (patch: HeaderDraft) =>
    setHeader((current) => ({ ...current, ...patch }));
  const deal =
    planDeal ?? deals.find((d) => String(d.id) === String(values.deal_id));

  const stagesView = useMemo(
    () =>
      stages.map((stage) => ({
        ...stage,
        ...stageDrafts[String(stage.id)],
      })) as TreatmentStage[],
    [stages, stageDrafts],
  );
  const totals = useMemo(
    () => planTotals(values, items, stagesView),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [values.discount_percent, values.discount_amount, items, stagesView],
  );
  const paid = plan ? planPaid(plan) : Number(deal?.paid_amount ?? 0);
  const dirty =
    Object.keys(header).length > 0 ||
    Object.values(stageDrafts).some((draft) => Object.keys(draft).length > 0);

  // Leaving with unsaved changes asks first (the browser's own dialog)
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    if (!values.name?.trim()) {
      notify("plan_editor.notify.name_required", { type: "warning" });
      return;
    }
    const emptyStage = stagesView.find((stage) => !stage.name?.trim());
    if (emptyStage) {
      notify("plan_editor.notify.stage_name_required", { type: "warning" });
      return;
    }
    setSaving(true);
    try {
      if (!plan) {
        const created = await createPlan.mutateAsync({
          ...values,
          name: values.name.trim(),
        });
        notify("plan_editor.notify.created", { type: "info" });
        navigate(planPath(patientId, created.id), { replace: true });
        return;
      }
      if (Object.keys(header).length) {
        await updatePlan.mutateAsync({
          plan,
          data: { ...header, name: values.name.trim() },
        });
      }
      for (const stage of stages) {
        const draft = stageDrafts[String(stage.id)];
        if (draft && Object.keys(draft).length) {
          await updateStage.mutateAsync({ stage, data: draft });
        }
      }
      setHeader({});
      setStageDrafts({});
      notify(
        header.status === "agreed"
          ? "treatment.notify.agreed"
          : "plan_editor.notify.saved",
        {
          type: "info",
          messageArgs: { amount: tenge(totals.total) },
        },
      );
    } catch {
      // The error is shown by the mutation
    } finally {
      setSaving(false);
    }
  };

  const discountValue =
    mode === "percent"
      ? Number(values.discount_percent ?? 0)
      : Number(values.discount_amount ?? 0);
  const readOnly = !canEdit;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[30px] leading-tight font-light tracking-[-0.03em]">
            {values.name || translate("plan_editor.title")}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {plan ? <PlanStatusBadge status={plan.status} /> : null}
            {plan?.is_main ? <MainPlanMark /> : null}
            {deal ? (
              <Link
                to={`/deals/${deal.id}/show`}
                className="rounded-full bg-pill px-3 py-1 text-xs text-foreground no-underline hover:bg-pill-hover"
              >
                {translate("plan_editor.to_deal", {
                  name: deal.name || translate("crm.deals.untitled"),
                })}
              </Link>
            ) : null}
            {plan ? (
              <span>
                {translate("treatment.totals.progress", {
                  done: totals.doneCount,
                  total: totals.itemsCount,
                })}
              </span>
            ) : null}
          </div>
        </div>
        {plan ? (
          <div className="flex flex-wrap items-start gap-2">
            {canEdit &&
            !plan.is_main &&
            AGREED_STATUSES.includes(plan.status) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  updatePlan.mutate({ plan, data: { is_main: true } })
                }
              >
                {translate("treatment.actions.make_main")}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                disabled={duplicatePlan.isPending}
                onClick={() =>
                  duplicatePlan.mutate(plan, {
                    onSuccess: (id) => navigate(planPath(patientId, id)),
                  })
                }
              >
                {translate("treatment.actions.duplicate")}
              </Button>
            ) : null}
            {deal ? (
              <EstimateActions
                deal={deal}
                plan={values}
                items={items}
                stages={stagesView}
              />
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (
                    window.confirm(
                      translate("treatment.actions.delete_confirm", {
                        name: plan.name,
                      }),
                    )
                  ) {
                    deletePlan.mutate(plan, {
                      onSuccess: () =>
                        navigate(
                          deal
                            ? `/deals/${deal.id}/show`
                            : `/patients/${patientId}/show`,
                        ),
                    });
                  }
                }}
              >
                {translate("treatment.actions.delete")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The header of the plan and its totals */}
      <section
        className="grid gap-5 rounded-[28px] bg-card p-6 xl:grid-cols-[1fr_22rem]"
        aria-label={translate("plan_editor.title")}
      >
        <div className="grid content-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <Field
            label={translate("plan_editor.fields.name")}
            required
            className="md:col-span-2 2xl:col-span-1"
          >
            <input
              value={values.name ?? ""}
              disabled={readOnly}
              maxLength={200}
              onChange={(event) => set({ name: event.target.value })}
              className={pillInput}
            />
          </Field>
          <Field label={translate("plan_editor.fields.doctor")}>
            <PillSelect
              label={translate("plan_editor.fields.doctor")}
              value={values.doctor_id}
              disabled={readOnly}
              empty={translate("plan_editor.fields.not_set")}
              options={toDoctorChoices(doctors, values.doctor_id)}
              onChange={(value) => set({ doctor_id: pickId(doctors, value) })}
            />
          </Field>
          <Field label={translate("plan_editor.fields.plan_type")}>
            <PillSelect
              label={translate("plan_editor.fields.plan_type")}
              value={values.plan_type_id}
              disabled={readOnly}
              empty={translate("plan_editor.fields.not_set")}
              options={activeChoices(planTypes, values.plan_type_id)}
              onChange={(value) =>
                set({ plan_type_id: pickId(planTypes, value) })
              }
            />
          </Field>
          <Field label={translate("plan_editor.fields.status")}>
            <PillSelect
              label={translate("plan_editor.fields.status")}
              value={values.status}
              disabled={readOnly}
              options={PLAN_STATUSES.map((status) => ({
                id: status,
                name: translate(`treatment.statuses.${status}`),
              }))}
              onChange={(value) =>
                set({ status: (value ?? "draft") as TreatmentPlan["status"] })
              }
            />
          </Field>
          {!plan ? (
            <Field
              label={translate("plan_editor.fields.deal")}
              required
              hint={translate("plan_editor.new_plan.deal_hint")}
            >
              <PillSelect
                label={translate("plan_editor.fields.deal")}
                value={values.deal_id}
                disabled={readOnly}
                options={deals.map((d) => ({
                  id: d.id,
                  name: d.name || translate("crm.deals.untitled"),
                }))}
                onChange={(value) => {
                  const next = deals.find((d) => String(d.id) === value);
                  set({
                    deal_id: next?.id,
                    doctor_id: next?.doctor_id ?? values.doctor_id ?? null,
                  });
                }}
              />
            </Field>
          ) : null}
          <Field label={translate("plan_editor.fields.insurance_policy")}>
            <input
              value={values.insurance_policy ?? ""}
              disabled={readOnly}
              maxLength={100}
              onChange={(event) =>
                set({ insurance_policy: event.target.value || null })
              }
              className={pillInput}
            />
          </Field>
          <Field
            label={translate("plan_editor.fields.extra_discount")}
            hint={
              canEdit && !unlimited
                ? translate("plan_editor.limits.discount", { max: maxDiscount })
                : undefined
            }
          >
            <span className="flex gap-2">
              <input
                key={`${mode}-${discountValue}`}
                defaultValue={
                  discountValue
                    ? mode === "percent"
                      ? String(discountValue).replace(".", ",")
                      : formatTenge(discountValue)
                    : ""
                }
                placeholder="0"
                inputMode="decimal"
                disabled={readOnly}
                aria-label={translate("plan_editor.fields.extra_discount")}
                onBlur={(event) => {
                  const raw = event.target.value;
                  const value =
                    mode === "percent"
                      ? parseNumber(raw)
                      : (parsePrice(raw) ?? 0);
                  set(extraDiscountData(mode, value));
                }}
                className={cn(pillInput, "text-right tabular-nums")}
              />
              <span
                className="flex shrink-0 rounded-full bg-muted p-1"
                role="radiogroup"
                aria-label={translate("plan_editor.fields.discount_mode")}
              >
                {(["percent", "amount"] as DiscountMode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    disabled={readOnly}
                    onClick={() => {
                      if (value === mode) return;
                      setMode(value);
                      set(extraDiscountData(value, discountValue));
                    }}
                    className={cn(
                      "min-w-9 rounded-full px-2.5 text-sm transition-colors",
                      mode === value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {translate(`plan_editor.fields.${value}`)}
                  </button>
                ))}
              </span>
            </span>
          </Field>
          <Field
            label={translate("plan_editor.fields.complaints")}
            className="md:col-span-2 2xl:col-span-3"
          >
            <textarea
              value={values.complaints ?? ""}
              disabled={readOnly}
              rows={2}
              onChange={(event) =>
                set({ complaints: event.target.value || null })
              }
              className="field min-h-16 w-full rounded-2xl px-4 py-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
            />
          </Field>
        </div>
        <PlanTotalsPanel
          gross={totals.gross}
          stagesDiscount={totals.stagesDiscount}
          extraDiscount={totals.planDiscount}
          total={totals.total}
          paid={paid}
        />
      </section>

      {plan ? (
        <PlanStages
          plan={values}
          stages={stagesView}
          savedStages={stages}
          items={items}
          totals={totals}
          canEdit={canEdit}
          onStageChange={(stage, patch) =>
            setStageDrafts((drafts) => ({
              ...drafts,
              [String(stage.id)]: { ...drafts[String(stage.id)], ...patch },
            }))
          }
          onSave={save}
          saving={saving}
          dirty={dirty}
        />
      ) : (
        <>
          <div className="flex items-center gap-6 rounded-[28px] bg-card p-6">
            <Molar3D className="h-24 w-20 shrink-0" />
            <p className="text-sm text-muted-foreground">
              {translate(
                deals.length
                  ? "plan_editor.new_plan.save_first"
                  : "plan_editor.new_plan.no_deals",
              )}
            </p>
          </div>
          {canEdit && deals.length ? (
            <div className="sticky bottom-4 z-20 flex items-center gap-2 self-start rounded-full bg-card/90 p-2 backdrop-blur">
              <Button onClick={save} disabled={saving || !values.deal_id}>
                {translate(
                  saving
                    ? "plan_editor.actions.saving"
                    : "plan_editor.actions.create",
                )}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
};

/** «Итого», «Скидка в этапах», «Дополнительная скидка», «Итого со скидкой», «Оплачено» */
const PlanTotalsPanel = ({
  gross,
  stagesDiscount,
  extraDiscount,
  total,
  paid,
}: {
  gross: number;
  stagesDiscount: number;
  extraDiscount: number;
  total: number;
  paid: number;
}) => {
  const translate = useTranslate();
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[24px] bg-background/70 p-5"
      role="group"
      aria-label={translate("plan_editor.totals.title")}
      data-testid="plan-totals"
    >
      {row(translate("plan_editor.totals.gross"), tenge(gross))}
      {row(
        translate("plan_editor.totals.stages_discount"),
        stagesDiscount ? `− ${tenge(stagesDiscount)}` : tenge(0),
      )}
      {row(
        translate("plan_editor.totals.extra_discount"),
        extraDiscount ? `− ${tenge(extraDiscount)}` : tenge(0),
      )}
      <div className="mt-1 flex flex-col gap-1 rounded-[20px] bg-neon px-4 py-3 text-neon-ink">
        <span className="text-xs">
          {translate("plan_editor.totals.total_with_discount")}
        </span>
        <span
          className="text-[30px] leading-none font-light tracking-[-0.03em] tabular-nums"
          data-testid="plan-total"
        >
          <b className="font-semibold">{formatTenge(total)}</b> ₸
        </span>
      </div>
      {row(translate("plan_editor.totals.paid"), tenge(paid))}
      {row(
        translate("plan_editor.totals.rest"),
        tenge(remainingToPay(total, paid)),
      )}
    </div>
  );
};
