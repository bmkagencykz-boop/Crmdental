import type { Identifier } from "ra-core";

import type { ToothGlyphKind, ToothMark } from "../dental-chart/DentalChart";
import { parseTeeth } from "../dental-chart/teeth";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../treatment/types";
import type { PatientTooth, ToothHistoryRow, ToothState } from "./types";

/**
 * The dental chart of the patient card (stage 37): the look of every state
 * (colour of the tooth and its mark), the state a done service gives a
 * tooth (twin of private.service_tooth_state), the marks of the chart
 * (state + services planned or done), the history of a tooth.
 */

export const STATE_LOOK: Record<
  ToothState,
  { color: string; glyph?: ToothGlyphKind }
> = {
  healthy: { color: "#fbfbfc" },
  caries: { color: "#ffd9b8", glyph: "caries" },
  endo: { color: "#ffc9cc", glyph: "endo" },
  treatment: { color: "#ffc2e0" },
  filling: { color: "#cfdcff", glyph: "filling" },
  crown: { color: "#e6dbff", glyph: "crown" },
  implant: { color: "#d7dde3", glyph: "implant" },
  root: { color: "#f3e6c8", glyph: "root" },
  missing: { color: "#e4e4e6", glyph: "missing" },
};

/**
 * The state of a tooth after a service done, from the service name; null:
 * the service does not change the chart. Same order and words as
 * private.service_tooth_state.
 */
export const toothStateForService = (
  serviceName: string | null | undefined,
): ToothState | null => {
  const v = (serviceName ?? "").toLowerCase();
  if (
    /(снятие|демонтаж|консультац|осмотр|снимок|рентген|диагност|отбелив|гигиен)/.test(
      v,
    )
  )
    return null;
  if (/(удален|экстракц)/.test(v)) return "missing";
  if (/имплант/.test(v)) return "implant";
  if (/коронк/.test(v)) return "crown";
  if (/(пломб|реставрац|кариес|пульпит|периодонтит|канал|эндодонт)/.test(v))
    return "filling";
  return null;
};

/** The services of the plans on a tooth */
export type ToothServices = { planned: string[]; done: string[] };

/**
 * The services of the plans per tooth: every item of a plan that is not
 * declined, in a stage that is not cancelled; «11-13» marks three teeth.
 */
export const servicesByTooth = (
  items: TreatmentPlanItem[],
  plans: Pick<TreatmentPlan, "id" | "status">[] = [],
  stages: Pick<TreatmentStage, "id" | "status">[] = [],
): Record<number, ToothServices> => {
  const declined = new Set(
    plans
      .filter((plan) => plan.status === "declined")
      .map((plan) => String(plan.id)),
  );
  const cancelled = new Set(
    stages
      .filter((stage) => stage.status === "cancelled")
      .map((stage) => String(stage.id)),
  );
  const result: Record<number, ToothServices> = {};
  for (const item of items) {
    if (declined.has(String(item.plan_id))) continue;
    if (item.stage_id != null && cancelled.has(String(item.stage_id))) continue;
    for (const tooth of parseTeeth(item.tooth)) {
      const entry = (result[tooth] ??= { planned: [], done: [] });
      (item.done ? entry.done : entry.planned).push(item.name);
    }
  }
  return result;
};

/**
 * The marks of the chart: the colour and the mark of the state, a neon dot
 * for a planned service, a black one when everything on the tooth is done;
 * the tooltip names the state, the note and the services.
 */
export const chartMarks = (
  teeth: Pick<PatientTooth, "tooth" | "state" | "note">[],
  services: Record<number, ToothServices>,
  label: (state: ToothState) => string,
  serviceLabels: { planned: string; done: string },
): Record<number, ToothMark> => {
  const marks: Record<number, ToothMark> = {};
  const numbers = new Set<number>([
    ...teeth.map((t) => t.tooth),
    ...Object.keys(services).map(Number),
  ]);
  for (const number of numbers) {
    const row = teeth.find((t) => t.tooth === number);
    const own = services[number];
    const look = row ? STATE_LOOK[row.state] : undefined;
    const title = [
      row ? label(row.state) : null,
      row?.note || null,
      own?.planned.length
        ? `${serviceLabels.planned}: ${own.planned.join(", ")}`
        : null,
      own?.done.length ? `${serviceLabels.done}: ${own.done.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    marks[number] = {
      color: look && row?.state !== "healthy" ? look.color : undefined,
      glyph: look?.glyph,
      badge: own?.planned.length
        ? "planned"
        : own?.done.length
          ? "done"
          : undefined,
      title: title || undefined,
    };
  }
  return marks;
};

/** Counts per state, for the legend: «Кариес 2» */
export const stateCounts = (teeth: Pick<PatientTooth, "state">[]) => {
  const counts: Partial<Record<ToothState, number>> = {};
  for (const tooth of teeth)
    counts[tooth.state] = (counts[tooth.state] ?? 0) + 1;
  return counts;
};

/** The changes of one tooth, newest first */
export const historyOfTooth = (
  history: ToothHistoryRow[],
  tooth: number,
): ToothHistoryRow[] =>
  history
    .filter((row) => row.tooth === tooth)
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || Number(b.id) - Number(a.id),
    );

/**
 * A change of a tooth as the database writes it (the demo twin of
 * private.handle_patient_tooth_after_write): null when nothing changed.
 */
export const toothChange = (
  before: Pick<PatientTooth, "state" | "note"> | null | undefined,
  after: Pick<PatientTooth, "state" | "note"> | null | undefined,
): Pick<
  ToothHistoryRow,
  "state_before" | "state" | "note_before" | "note"
> | null => {
  const noteBefore = before?.note?.trim() || null;
  const noteAfter = after?.note?.trim() || null;
  if (
    before &&
    after &&
    before.state === after.state &&
    noteBefore === noteAfter
  )
    return null;
  if (!before && !after) return null;
  return {
    state_before: before?.state ?? null,
    state: after?.state ?? null,
    note_before: before ? noteBefore : null,
    note: after ? noteAfter : null,
  };
};

/** The tooth rows a done plan item writes (the demo twin of the trigger) */
export const plannedToothStates = (
  item: Pick<TreatmentPlanItem, "name" | "tooth" | "done">,
  wasDone: boolean,
): { tooth: number; state: ToothState }[] => {
  if (!item.done || wasDone) return [];
  const state = toothStateForService(item.name);
  if (!state) return [];
  return parseTeeth(item.tooth).map((tooth) => ({ tooth, state }));
};

export const sameId = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);
