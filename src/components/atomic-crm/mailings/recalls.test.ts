import { describe, expect, it } from "vitest";

import { addMonths } from "./segment";
import {
  decideRecall,
  recallCandidates,
  recallDealName,
  RECALL_REASONS,
  type RecallDeal,
} from "./recalls";
import type { RecallRule } from "./types";

const now = new Date("2026-09-27T12:00:00Z");
const stages = [
  { id: 1, kind: "open" as const },
  { id: 7, kind: "won" as const },
  { id: 8, kind: "lost" as const },
];
const rule: RecallRule = {
  id: 1,
  name: "Профгигиена",
  service_id: null,
  delay_months: 6,
  pipeline_id: 1,
  stage_id: 1,
  deal_service_id: 3,
  template_id: null,
  message_mode: "confirm",
  is_active: true,
  position: 0,
};
const won = (
  id: number,
  patient_id: number,
  closed: Date,
  service_id: number | null = 2,
): RecallDeal => ({
  id,
  patient_id,
  stage_id: 7,
  service_id,
  closed_at: closed.toISOString(),
  archived_at: null,
  sales_id: 1,
  lost_reason_id: null,
});
const window = {
  from: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
  to: now,
};

describe("recallCandidates", () => {
  it("finds the won deals due in the window, once", () => {
    const deals = [
      won(1, 1, addMonths(now, -6)),
      won(2, 2, addMonths(new Date(now.getTime() - 24 * 3600 * 1000), -6)),
      // due in 10 days: not yet
      won(3, 3, addMonths(new Date(now.getTime() + 10 * 24 * 3600 * 1000), -6)),
    ];
    const due = recallCandidates({
      rules: [rule],
      deals,
      stages,
      recalls: [],
      ...window,
    });
    expect(due.map((c) => c.deal.id)).toEqual([2, 1]);
    expect(
      recallCandidates({
        rules: [rule],
        deals,
        stages,
        recalls: [{ rule_id: 1, deal_id: 1 }],
        ...window,
      }).map((c) => c.deal.id),
    ).toEqual([2]);
  });

  it("counts from the latest won deal of the patient", () => {
    const deals = [
      won(1, 1, addMonths(now, -6)),
      won(2, 1, addMonths(now, -2)),
    ];
    expect(
      recallCandidates({
        rules: [rule],
        deals,
        stages,
        recalls: [],
        ...window,
      }),
    ).toEqual([]);
  });

  it("filters by the service of the rule, skips inactive rules", () => {
    const deals = [won(1, 1, addMonths(now, -6), 5)];
    expect(
      recallCandidates({
        rules: [{ ...rule, service_id: 4 }],
        deals,
        stages,
        recalls: [],
        ...window,
      }),
    ).toEqual([]);
    expect(
      recallCandidates({
        rules: [{ ...rule, is_active: false }],
        deals,
        stages,
        recalls: [],
        ...window,
      }),
    ).toEqual([]);
  });
});

describe("decideRecall", () => {
  const lostReasons = [{ id: 9, name: "Не беспокоить" }];
  it("creates a deal when the patient can be contacted", () => {
    expect(
      decideRecall({
        patientId: 1,
        optedOut: false,
        deals: [won(1, 1, now)],
        stages,
        lostReasons,
      }),
    ).toEqual({ status: "created" });
  });
  it("skips when an open deal exists", () => {
    expect(
      decideRecall({
        patientId: 1,
        optedOut: false,
        deals: [{ ...won(2, 1, now), stage_id: 1 }],
        stages,
        lostReasons,
      }),
    ).toEqual({ status: "skipped", reason: RECALL_REASONS.open_deal });
  });
  it("cancels for an opted-out patient or a refusal «Не беспокоить»", () => {
    expect(
      decideRecall({
        patientId: 1,
        optedOut: true,
        deals: [],
        stages,
        lostReasons,
      }),
    ).toEqual({ status: "cancelled", reason: RECALL_REASONS.opted_out });
    expect(
      decideRecall({
        patientId: 1,
        optedOut: false,
        deals: [{ ...won(2, 1, now), stage_id: 8, lost_reason_id: 9 }],
        stages,
        lostReasons,
      }),
    ).toEqual({ status: "cancelled", reason: RECALL_REASONS.do_not_disturb });
  });
});

describe("recallDealName", () => {
  it("names the deal after the service, else the rule", () => {
    expect(recallDealName("Гигиена", "Профгигиена")).toBe(
      "Повторный визит: Гигиена",
    );
    expect(recallDealName(null, "Профгигиена")).toBe(
      "Повторный визит: Профгигиена",
    );
  });
});
