/**
 * Business rules of the database (supabase/schemas/02_functions.sql)
 * mirrored for the in-browser demo provider. Keep both in sync.
 */
import type { Identifier } from "ra-core";
import type {
  Deal,
  DealChecklistCheck,
  OrganizationSettings,
  Patient,
  Stage,
  StageChecklistItem,
  TaskRule,
} from "../../types";

/** Same as private.normalize_phone: Kazakh numbers to +7XXXXXXXXXX */
export const normalizePhone = (raw?: string | null): string | null => {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && /^[78]/.test(digits))
    return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
};

/** Same as handle_patient_saved: normalized phones, clean handles */
export const normalizePatient = <T extends Partial<Patient>>(patient: T): T => {
  const phone_jsonb = (patient.phone_jsonb ?? [])
    .map((phone) => ({ ...phone, number: normalizePhone(phone?.number) }))
    .filter(
      (phone): phone is { number: string; type?: string } => !!phone.number,
    );
  const whatsapp = normalizePhone(patient.whatsapp);
  const clean = (handle?: string | null) =>
    handle?.trim().replace(/^@+/, "") || null;
  const phones = [
    ...new Set([...phone_jsonb.map((p) => p.number), whatsapp].filter(Boolean)),
  ].sort() as string[];
  return {
    ...patient,
    phone_jsonb,
    whatsapp,
    instagram: clean(patient.instagram)?.toLowerCase() ?? null,
    telegram: clean(patient.telegram),
    phones,
  };
};

export class DealRuleError extends Error {}

/** Same as handle_deal_before_write: stage rules of a deal */
export const checkDealStageChange = ({
  previous,
  next,
  stages,
}: {
  previous?: Pick<Deal, "stage_id" | "pipeline_id">;
  next: Pick<Deal, "stage_id" | "pipeline_id" | "lost_reason_id">;
  stages: Stage[];
}) => {
  const stageOf = (id: Deal["stage_id"]) =>
    stages.find((stage) => String(stage.id) === String(id));
  const newStage = stageOf(next.stage_id);
  if (!newStage || String(newStage.pipeline_id) !== String(next.pipeline_id)) {
    throw new DealRuleError("Стадия не принадлежит воронке сделки");
  }
  const changed =
    !previous ||
    String(previous.stage_id) !== String(next.stage_id) ||
    String(previous.pipeline_id) !== String(next.pipeline_id);
  if (previous && changed && stageOf(previous.stage_id)?.kind === "lost") {
    throw new DealRuleError(
      "Сделка в отказе не возвращается в работу. Для повторного обращения создайте новую сделку.",
    );
  }
  if (newStage.kind === "lost" && next.lost_reason_id == null) {
    throw new DealRuleError("Укажите причину отказа");
  }
  return { changed, kind: newStage.kind };
};

/** Fields logged in deal_events (same list as handle_deal_after_write) */
export const TRACKED_DEAL_FIELDS = [
  "name",
  "patient_id",
  "pipeline_id",
  "sales_id",
  "source_id",
  "service_id",
  "plan_amount",
  "paid_amount",
  "lost_reason_id",
  "lost_comment",
  "appointment_at",
  "visit_at",
  "tags",
  "archived_at",
  "doctor_id",
  "consultation_amount",
] as const;

export const dealChanges = (
  previous: Partial<Deal>,
  next: Partial<Deal>,
): Record<string, [unknown, unknown]> =>
  Object.fromEntries(
    TRACKED_DEAL_FIELDS.filter(
      (field) =>
        JSON.stringify(previous[field] ?? null) !==
        JSON.stringify(next[field] ?? null),
    ).map((field) => [field, [previous[field] ?? null, next[field] ?? null]]),
  );

/** Every pipeline keeps at least one won and one lost stage */
export const pipelineHasClosingStages = (stages: Pick<Stage, "kind">[]) =>
  stages.some((stage) => stage.kind === "won") &&
  stages.some((stage) => stage.kind === "lost");

/**
 * Same as handle_deal_before_write: a deal moved to another pipeline lands on
 * its first stage, unless the clinic lets employees choose the stage.
 */
export const applyPipelineMove = <
  T extends Pick<Deal, "pipeline_id" | "stage_id">,
>({
  previous,
  next,
  stages,
  mode = "first_stage",
}: {
  previous: Pick<Deal, "pipeline_id">;
  next: T;
  stages: Stage[];
  mode?: OrganizationSettings["pipeline_move_mode"];
}): T => {
  if (
    String(previous.pipeline_id) === String(next.pipeline_id) ||
    mode !== "first_stage"
  ) {
    return next;
  }
  const [first] = stages
    .filter((stage) => String(stage.pipeline_id) === String(next.pipeline_id))
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));
  return first ? { ...next, stage_id: first.id } : next;
};

/**
 * Same as handle_deal_before_write: the checklist of the current stage must
 * be done before the deal moves forward in its pipeline (refusing is always
 * possible, and so is going back).
 */
export const checkStageChecklist = ({
  previous,
  next,
  stages,
  items,
  checks,
}: {
  previous: Pick<Deal, "id" | "stage_id" | "pipeline_id">;
  next: Pick<Deal, "stage_id" | "pipeline_id">;
  stages: Stage[];
  items: StageChecklistItem[];
  checks: DealChecklistCheck[];
}) => {
  if (
    String(previous.stage_id) === String(next.stage_id) ||
    String(previous.pipeline_id) !== String(next.pipeline_id)
  ) {
    return;
  }
  const from = stages.find((s) => String(s.id) === String(previous.stage_id));
  const to = stages.find((s) => String(s.id) === String(next.stage_id));
  if (!from || !to || to.kind === "lost" || to.position <= from.position) {
    return;
  }
  const undone = items.filter(
    (item) =>
      String(item.stage_id) === String(from.id) &&
      !checks.some(
        (check) =>
          String(check.deal_id) === String(previous.id) &&
          String(check.item_id) === String(item.id),
      ),
  );
  if (undone.length) {
    throw new DealRuleError(`Выполните чек-лист этапа «${from.name}»`);
  }
};

/** Same as private.create_rule_tasks: the tasks an event of a deal creates */
export const ruleTasks = ({
  deal,
  rules,
  event,
  stageId = null,
  now = new Date(),
}: {
  deal: Pick<Deal, "id" | "sales_id">;
  rules: TaskRule[];
  event: TaskRule["event"];
  stageId?: Identifier | null;
  now?: Date;
}) =>
  rules
    .filter(
      (rule) =>
        rule.is_active &&
        rule.event === event &&
        String(rule.stage_id ?? "") === String(stageId ?? ""),
    )
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))
    .map((rule) => ({
      deal_id: deal.id,
      type: rule.type,
      text: rule.text,
      due_date: new Date(
        now.getTime() + rule.due_in_minutes * 60 * 1000,
      ).toISOString(),
      done_date: null,
      sales_id: deal.sales_id ?? undefined,
    }));
