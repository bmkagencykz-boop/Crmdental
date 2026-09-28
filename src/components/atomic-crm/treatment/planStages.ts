import type { Identifier } from "ra-core";

import type { ToothMark } from "../dental-chart/DentalChart";
import { areaOf, parseTeeth, type Area } from "../dental-chart/teeth";
import type { Service } from "../types";
import type {
  StageTemplateItem,
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
  TreatmentStageTemplate,
} from "./types";

/**
 * The plan editor page (stage 34), pure helpers shared by the page and the
 * demo: the extra discount in % or ₸, the lines added for the teeth picked
 * on the chart, the marks of the chart, stage templates (the twins of
 * public.save_stage_template and public.add_stage_from_template), «Оплачено».
 */

export type DiscountMode = "percent" | "amount";

/** «Дополнительная скидка» is in tenge when only the amount is set */
export const extraDiscountMode = (
  plan: Pick<TreatmentPlan, "discount_percent" | "discount_amount">,
): DiscountMode =>
  Number(plan.discount_amount) > 0 && !(Number(plan.discount_percent) > 0)
    ? "amount"
    : "percent";

/** The extra discount written in one mode: the other one is cleared */
export const extraDiscountData = (mode: DiscountMode, value: number) =>
  mode === "percent"
    ? {
        discount_percent: Math.min(100, Math.max(0, value)),
        discount_amount: 0,
      }
    : {
        discount_percent: 0,
        discount_amount: Math.max(0, Math.round(value)),
      };

/** The number of a new stage: the next one, at most 20 */
export const nextStagePosition = (stages: Pick<TreatmentStage, "position">[]) =>
  Math.max(0, ...stages.map((stage) => stage.position)) + 1;

export const MAX_STAGES = 20;

/**
 * The lines added for a service and the teeth picked on the chart: one
 * line per tooth (or one per area), or one line without a tooth. The
 * price is the price list's.
 */
export const linesForTargets = ({
  planId,
  stage,
  service,
  name,
  targets,
  startPosition,
}: {
  planId: Identifier;
  stage: Pick<TreatmentStage, "id" | "position">;
  service?: Pick<Service, "id" | "name" | "price">;
  name: string;
  targets: string[];
  startPosition: number;
}): Partial<TreatmentPlanItem>[] =>
  (targets.length ? targets : [null]).map((tooth, index) => ({
    plan_id: planId,
    stage_id: stage.id,
    stage_no: stage.position,
    service_id: service?.id ?? null,
    name: service?.name ?? name,
    tooth,
    quantity: 1,
    unit_price: Math.round(service?.price ?? 0),
    discount_percent: 0,
    done: false,
    position: startPosition + index,
  }));

/**
 * The marks of the dental chart for the items of a stage: its teeth in
 * neon (muted when every item of the tooth is done), the areas too; the
 * tooltip names the services.
 */
export const chartMarks = (
  items: Pick<TreatmentPlanItem, "tooth" | "name" | "done">[],
) => {
  const teeth = new Map<number, { names: string[]; done: boolean }>();
  const areas = new Map<Area, { names: string[]; done: boolean }>();
  const add = <K>(
    map: Map<K, { names: string[]; done: boolean }>,
    key: K,
    item: Pick<TreatmentPlanItem, "name" | "done">,
  ) => {
    const entry = map.get(key) ?? { names: [], done: true };
    entry.names.push(item.name);
    entry.done = entry.done && item.done;
    map.set(key, entry);
  };
  for (const item of items) {
    const area = areaOf(item.tooth);
    if (area) add(areas, area, item);
    for (const tooth of parseTeeth(item.tooth)) add(teeth, tooth, item);
  }
  const mark = ({ names, done }: { names: string[]; done: boolean }) =>
    ({
      tone: done ? "done" : "neon",
      title: names.join(", "),
    }) satisfies ToothMark;
  return {
    teeth: Object.fromEntries(
      [...teeth].map(([tooth, entry]) => [tooth, mark(entry)]),
    ) as Record<number, ToothMark>,
    areas: Object.fromEntries(
      [...areas].map(([area, entry]) => [area, mark(entry)]),
    ) as Partial<Record<Area, ToothMark>>,
  };
};

/**
 * «Сохранить как шаблон этапа»: the lines of a stage without teeth,
 * identical lines (service, name, price, discount) merged with their
 * quantities added up (public.save_stage_template)
 */
export const templateLines = (
  items: TreatmentPlanItem[],
): StageTemplateItem[] => {
  const lines = new Map<string, StageTemplateItem & { order: number }>();
  const sorted = [...items].sort(
    (a, b) => a.position - b.position || Number(a.id) - Number(b.id),
  );
  sorted.forEach((item, order) => {
    const key = [
      item.service_id ?? "",
      item.name,
      Math.round(item.unit_price),
      Number(item.discount_percent),
    ].join("|");
    const line = lines.get(key) ?? {
      service_id: item.service_id ?? null,
      name: item.name,
      quantity: 0,
      unit_price: Math.round(item.unit_price),
      discount_percent: Number(item.discount_percent),
      order,
    };
    line.quantity = Math.min(1000, line.quantity + item.quantity);
    lines.set(key, line);
  });
  return [...lines.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...line }) => line);
};

/**
 * «Добавить этап из шаблона»: the items of the new stage at the prices of
 * the current price list (the saved price when the service is gone,
 * archived or without a price) — public.add_stage_from_template
 */
export const itemsFromTemplate = (
  template: Pick<TreatmentStageTemplate, "items">,
  services: Pick<Service, "id" | "name" | "price" | "is_archived">[],
): Omit<StageTemplateItem, never>[] =>
  (template.items ?? []).map((line) => {
    const service =
      line.service_id != null
        ? services.find((s) => String(s.id) === String(line.service_id))
        : undefined;
    const current =
      service && !service.is_archived && service.price != null
        ? Math.round(service.price)
        : null;
    return {
      service_id: service?.id ?? null,
      name: line.name?.trim() || service?.name || "Услуга",
      quantity: Math.min(1000, Math.max(1, Math.round(line.quantity || 1))),
      unit_price: current ?? Math.round(line.unit_price ?? 0),
      discount_percent: Math.min(
        100,
        Math.max(0, Number(line.discount_percent ?? 0)),
      ),
    };
  });

/**
 * «Оплачено» of a plan: the payments of its deal today. The one place to
 * change when patient payments and deposits take over
 * (private.treatment_plan_paid in the database).
 */
export const planPaid = (source: {
  paid_amount?: number | null;
  deal_paid_amount?: number | null;
}) => Math.round(Number(source.paid_amount ?? source.deal_paid_amount ?? 0));

/** «План лечения, 28.09.2026» */
export const planDateText = (date: Date) =>
  date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
