import type { Identifier } from "ra-core";

import type { Deal, LostReason, Stage } from "../types";
import { addMonths } from "./segment";
import type { Recall, RecallRule } from "./types";

/**
 * Repeat sales: the same rules as private.recall_candidates and
 * private.process_recalls (supabase/schemas/17_repeat_mailings.sql), for the
 * demo data provider.
 */

export const RECALL_REASONS = {
  opted_out: "Пациент отказался от сообщений",
  do_not_disturb: "Отказ «Не беспокоить»",
  open_deal: "У пациента уже есть открытая сделка",
} as const;

/** Days back the daily job still picks up a missed recall */
export const RECALL_CATCH_UP_DAYS = 30;

export type RecallDeal = Pick<
  Deal,
  | "id"
  | "patient_id"
  | "stage_id"
  | "service_id"
  | "closed_at"
  | "archived_at"
  | "sales_id"
  | "lost_reason_id"
>;

const same = (a: Identifier | null | undefined, b: Identifier | null) =>
  a != null && b != null && String(a) === String(b);

const isDoNotDisturb = (name: string | null | undefined) =>
  (name ?? "").trim().toLowerCase() === "не беспокоить";

/**
 * Due recalls in ]from, to]: for each active rule, the latest won deal of
 * each patient (of the rule's service, or any), delay_months after it was
 * won, not handled yet.
 */
export const recallCandidates = ({
  rules,
  deals,
  stages,
  recalls,
  from,
  to,
}: {
  rules: RecallRule[];
  deals: RecallDeal[];
  stages: Pick<Stage, "id" | "kind">[];
  recalls: Pick<Recall, "rule_id" | "deal_id">[];
  from: Date;
  to: Date;
}) => {
  const kind = new Map(stages.map((s) => [String(s.id), s.kind]));
  const result: {
    rule: RecallRule;
    deal: RecallDeal;
    due_at: string;
  }[] = [];
  for (const rule of rules.filter((r) => r.is_active)) {
    const latest = new Map<string, RecallDeal>();
    for (const deal of deals) {
      if (
        kind.get(String(deal.stage_id)) !== "won" ||
        !deal.closed_at ||
        deal.archived_at ||
        (rule.service_id != null && !same(deal.service_id, rule.service_id))
      ) {
        continue;
      }
      const key = String(deal.patient_id);
      const current = latest.get(key);
      if (
        !current ||
        deal.closed_at > current.closed_at! ||
        (deal.closed_at === current.closed_at &&
          Number(deal.id) > Number(current.id))
      ) {
        latest.set(key, deal);
      }
    }
    for (const deal of latest.values()) {
      const due = addMonths(deal.closed_at!, rule.delay_months);
      if (due <= from || due > to) continue;
      if (
        recalls.some(
          (recall) =>
            same(recall.rule_id, rule.id) && same(recall.deal_id, deal.id),
        )
      ) {
        continue;
      }
      result.push({ rule, deal, due_at: due.toISOString() });
    }
  }
  return result.sort(
    (a, b) =>
      a.due_at.localeCompare(b.due_at) || Number(a.deal.id) - Number(b.deal.id),
  );
};

/** What the daily job does with a due recall of a patient */
export const decideRecall = ({
  patientId,
  optedOut,
  deals,
  stages,
  lostReasons,
}: {
  patientId: Identifier;
  optedOut: boolean | null | undefined;
  deals: RecallDeal[];
  stages: Pick<Stage, "id" | "kind">[];
  lostReasons: Pick<LostReason, "id" | "name">[];
}):
  | { status: "created" }
  | { status: "skipped" | "cancelled"; reason: string } => {
  const kind = new Map(stages.map((s) => [String(s.id), s.kind]));
  const own = deals.filter((deal) => same(deal.patient_id, patientId));
  if (optedOut) {
    return { status: "cancelled", reason: RECALL_REASONS.opted_out };
  }
  if (
    own.some(
      (deal) =>
        kind.get(String(deal.stage_id)) === "lost" &&
        isDoNotDisturb(
          lostReasons.find((r) => same(r.id, deal.lost_reason_id ?? null))
            ?.name,
        ),
    )
  ) {
    return { status: "cancelled", reason: RECALL_REASONS.do_not_disturb };
  }
  if (
    own.some(
      (deal) => kind.get(String(deal.stage_id)) === "open" && !deal.archived_at,
    )
  ) {
    return { status: "skipped", reason: RECALL_REASONS.open_deal };
  }
  return { status: "created" };
};

/** «Повторный визит: Гигиена» */
export const recallDealName = (
  serviceName: string | null | undefined,
  ruleName: string,
) => `Повторный визит: ${serviceName || ruleName}`;
