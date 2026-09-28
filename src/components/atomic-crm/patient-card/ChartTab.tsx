import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DentalChart, ToothGlyph } from "../dental-chart/DentalChart";
import { preferredDentition, type Dentition } from "../dental-chart/teeth";
import { planPath } from "../treatment/planUi";
import type {
  TreatmentPlanItem,
  TreatmentPlanSummary,
} from "../treatment/types";
import type { Sale } from "../types";
import { ruDate } from "./consents";
import {
  chartMarks,
  historyOfTooth,
  servicesByTooth,
  STATE_LOOK,
  stateCounts,
} from "./toothStates";
import { TOOTH_STATES, type PatientTooth, type ToothState } from "./types";
import {
  useMedicalRights,
  usePatientPlanItems,
  usePatientTeeth,
  useRefreshPatientCard,
  useToothHistory,
} from "./usePatientCard";

const dateTime = (value: string) => {
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ruDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * «Зубная формула» of the patient card (stage 37): the chart (permanent or
 * primary teeth) with the current state of every tooth — its colour and
 * mark — and dots for the services of the plans (neon: planned, black:
 * done); a click picks a tooth: its state, a note, the services of the
 * plans and the history of its changes (who, when).
 */
export const ChartTab = ({ patientId }: { patientId: Identifier }) => {
  const translate = useTranslate();
  const rights = useMedicalRights();
  const { data: teeth = [] } = usePatientTeeth(patientId);
  const { data: history = [] } = useToothHistory(patientId);
  const { plans, items, stages } = usePatientPlanItems(patientId);
  const [active, setActive] = useState<number | null>(null);
  const [dentition, setDentition] = useState<Dentition | null>(null);

  const services = useMemo(
    () => servicesByTooth(items, plans, stages),
    [items, plans, stages],
  );
  const marks = useMemo(
    () =>
      chartMarks(
        teeth,
        services,
        (state) => translate(`patient_card.chart.states.${state}`),
        {
          planned: translate("patient_card.chart.planned"),
          done: translate("patient_card.chart.done"),
        },
      ),
    [teeth, services, translate],
  );
  const counts = stateCounts(teeth);
  const shownDentition =
    dentition ?? preferredDentition(teeth.map((row) => row.tooth));

  return (
    <div
      className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]"
      data-testid="patient-chart"
    >
      <section className="rounded-[28px] bg-card p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
              {translate("patient_card.chart.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {rights.canEdit
                ? translate("patient_card.chart.subtitle")
                : translate("patient_card.chart.read_only")}
            </p>
          </div>
        </div>
        <DentalChart
          dentition={shownDentition}
          onDentitionChange={setDentition}
          marks={marks}
          onToothClick={(tooth) =>
            setActive((current) => (current === tooth ? null : tooth))
          }
          activeTooth={active}
        />
        <Legend counts={counts} />
      </section>
      <ToothPanel
        key={active ?? "none"}
        patientId={patientId}
        tooth={active}
        row={teeth.find((row) => row.tooth === active)}
        history={active == null ? [] : historyOfTooth(history, active)}
        services={active == null ? undefined : services[active]}
        plans={plans}
        items={items}
        canEdit={rights.canEdit}
      />
    </div>
  );
};

const Legend = ({
  counts,
}: {
  counts: Partial<Record<ToothState, number>>;
}) => {
  const translate = useTranslate();
  return (
    <div className="mt-6" aria-label={translate("patient_card.chart.legend")}>
      <p className="mb-2 text-xs text-muted-foreground">
        {translate("patient_card.chart.legend")}
      </p>
      <ul className="flex flex-wrap gap-2" data-testid="chart-legend">
        {TOOTH_STATES.map((state) => (
          <li
            key={state}
            className="flex items-center gap-2 rounded-full bg-pill py-1 pr-3 pl-1.5 text-xs"
          >
            <span
              className="flex size-7 items-center justify-center rounded-full"
              style={{ backgroundColor: STATE_LOOK[state].color }}
            >
              <ToothGlyph
                tooth={36}
                className="h-6 w-auto"
                mark={{
                  color: STATE_LOOK[state].color,
                  glyph: STATE_LOOK[state].glyph,
                }}
              />
            </span>
            {translate(`patient_card.chart.states.${state}`)}
            {counts[state] ? (
              <span className="text-muted-foreground tabular-nums">
                {counts[state]}
              </span>
            ) : null}
          </li>
        ))}
        <li className="flex items-center gap-2 rounded-full bg-pill px-3 py-1 text-xs">
          <span className="size-2 rounded-full bg-neon" />
          {translate("patient_card.chart.planned")}
        </li>
        <li className="flex items-center gap-2 rounded-full bg-pill px-3 py-1 text-xs">
          <span className="size-2 rounded-full bg-primary" />
          {translate("patient_card.chart.done")}
        </li>
      </ul>
    </div>
  );
};

const ToothPanel = ({
  patientId,
  tooth,
  row,
  history,
  services,
  plans,
  items,
  canEdit,
}: {
  patientId: Identifier;
  tooth: number | null;
  row?: PatientTooth;
  history: ReturnType<typeof historyOfTooth>;
  services?: { planned: string[]; done: string[] };
  plans: TreatmentPlanSummary[];
  items: TreatmentPlanItem[];
  canEdit: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshPatientCard();
  const [create, { isPending: creating }] = useCreate();
  const [update, { isPending: updating }] = useUpdate();
  const [remove, { isPending: removing }] = useDelete();
  const [state, setState] = useState<ToothState>(row?.state ?? "healthy");
  const [note, setNote] = useState(row?.note ?? "");
  const { data: staff = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "last_name", order: "ASC" },
  });

  if (tooth == null) {
    return (
      <aside className="flex flex-col items-center justify-center gap-3 rounded-[28px] bg-card p-6 text-center">
        <ToothGlyph tooth={36} className="h-24 w-auto opacity-70" />
        <p className="max-w-56 text-sm text-muted-foreground">
          {translate("patient_card.chart.pick")}
        </p>
      </aside>
    );
  }

  const dirty =
    state !== (row?.state ?? "healthy") ||
    (note.trim() || null) !== (row?.note ?? null);
  const done = () => {
    refresh();
    notify("patient_card.chart.saved", {
      type: "info",
      messageArgs: { n: tooth },
    });
  };
  const onError = (error: unknown) =>
    notify((error as Error)?.message || "ra.notification.http_error", {
      type: "error",
    });
  const save = () => {
    const data = { state, note: note.trim() || null };
    if (row) {
      update(
        "patient_teeth",
        { id: row.id, data, previousData: row },
        { mutationMode: "pessimistic", onSuccess: done, onError },
      );
    } else {
      create(
        "patient_teeth",
        { data: { ...data, patient_id: patientId, tooth } },
        { onSuccess: done, onError },
      );
    }
  };
  const clear = () =>
    row &&
    remove(
      "patient_teeth",
      { id: row.id, previousData: row },
      { mutationMode: "pessimistic", onSuccess: done, onError },
    );
  const who = (id: Identifier | null | undefined) => {
    const sale = staff.find((s) => id != null && String(s.id) === String(id));
    return sale
      ? `${sale.first_name} ${sale.last_name}`
      : translate("patient_card.chart.nobody");
  };
  const toothPlans = plans.filter((plan) =>
    items.some(
      (item) =>
        String(item.plan_id) === String(plan.id) &&
        (services?.planned.includes(item.name) ||
          services?.done.includes(item.name)),
    ),
  );

  return (
    <aside
      className="flex flex-col gap-5 rounded-[28px] bg-card p-6"
      aria-label={translate("patient_card.chart.tooth", { n: tooth })}
      data-testid="tooth-panel"
    >
      <div className="flex items-start gap-4">
        <span
          className="flex size-16 shrink-0 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: STATE_LOOK[row?.state ?? "healthy"].color,
          }}
        >
          <ToothGlyph
            tooth={tooth}
            className="h-14 w-auto"
            mark={{
              color: STATE_LOOK[row?.state ?? "healthy"].color,
              glyph: STATE_LOOK[row?.state ?? "healthy"].glyph,
            }}
          />
        </span>
        <div>
          <h3 className="text-[26px] leading-tight font-light tracking-[-0.02em]">
            {translate("patient_card.chart.tooth", { n: tooth })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {row
              ? translate(`patient_card.chart.states.${row.state}`)
              : translate("patient_card.chart.no_data")}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs text-muted-foreground">
          {translate("patient_card.chart.state")}
        </p>
        <div
          className="flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-label={translate("patient_card.chart.state")}
        >
          {TOOTH_STATES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={state === value}
              disabled={!canEdit}
              onClick={() => setState(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors disabled:cursor-default",
                state === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-pill text-foreground enabled:hover:bg-pill-hover",
              )}
            >
              <span
                className="size-2.5 rounded-full border border-foreground/20"
                style={{ backgroundColor: STATE_LOOK[value].color }}
              />
              {translate(`patient_card.chart.states.${value}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {translate("patient_card.chart.note")}
        </span>
        <textarea
          value={note}
          disabled={!canEdit}
          rows={2}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={translate("patient_card.chart.note_placeholder")}
          className="field rounded-2xl px-4 py-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60"
        />
      </label>

      {canEdit ? (
        <div className="flex gap-2">
          <Button onClick={save} disabled={!dirty || creating || updating}>
            {translate("patient_card.chart.save")}
          </Button>
          {row ? (
            <Button
              variant="outline"
              className="bg-background"
              onClick={clear}
              disabled={removing}
            >
              {translate("patient_card.chart.clear")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {services && (services.planned.length || services.done.length) ? (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">
            {translate("patient_card.chart.services_title")}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {services.planned.map((name, index) => (
              <li key={`p${index}`} className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-neon" />
                {name}
              </li>
            ))}
            {services.done.map((name, index) => (
              <li key={`d${index}`} className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-primary" />
                {name}
                <span className="text-xs text-muted-foreground">
                  {translate("patient_card.chart.done")}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {toothPlans.map((plan) => (
              <Link
                key={plan.id}
                to={planPath(patientId, plan.id)}
                className="rounded-full bg-pill px-3 py-1 text-xs text-foreground no-underline hover:bg-pill-hover"
              >
                {plan.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-2 text-xs text-muted-foreground">
          {translate("patient_card.chart.history")}
        </p>
        {history.length ? (
          <ol
            className="flex flex-col gap-2 text-sm"
            data-testid="tooth-history"
          >
            {history.map((change) => (
              <li
                key={change.id}
                className="rounded-2xl bg-background px-3 py-2"
              >
                <span className="block">
                  {change.state_before
                    ? translate(
                        `patient_card.chart.states.${change.state_before}`,
                      )
                    : "—"}
                  {" → "}
                  {change.state
                    ? translate(`patient_card.chart.states.${change.state}`)
                    : translate("patient_card.chart.cleared")}
                  {change.note && change.note !== change.note_before
                    ? ` · ${change.note}`
                    : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dateTime(change.created_at)} · {who(change.sales_id)}
                  {change.source === "plan"
                    ? ` · ${translate("patient_card.chart.source_plan")}`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("patient_card.chart.history_empty")}
          </p>
        )}
      </div>
    </aside>
  );
};
