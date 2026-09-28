import { describe, expect, it } from "vitest";

import type { TreatmentPlan, TreatmentPlanItem } from "../treatment/types";
import {
  actLines,
  actTotal,
  documentFileName,
  receiptTitleKey,
} from "./documents";

const plan = (patch: Partial<TreatmentPlan>): TreatmentPlan => ({
  id: 1,
  deal_id: 10,
  patient_id: 7,
  name: "План",
  status: "in_progress",
  is_main: true,
  discount_percent: 0,
  discount_amount: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...patch,
});
const item = (patch: Partial<TreatmentPlanItem>): TreatmentPlanItem => ({
  id: 1,
  plan_id: 1,
  stage_no: 1,
  name: "Имплант",
  quantity: 1,
  unit_price: 200000,
  discount_percent: 0,
  done: true,
  position: 0,
  ...patch,
});

describe("actLines", () => {
  it("lists done items, the plan discount and priced visits without a plan", () => {
    const lines = actLines({
      patientId: 7,
      plans: [plan({ discount_percent: 10 })],
      items: [
        item({ id: 1 }),
        item({ id: 2, name: "Коронка", unit_price: 100000, done: false }),
      ],
      visits: [
        {
          id: 5,
          patient_id: 7,
          deal_id: 11,
          service_id: 3,
          status: "completed",
          starts_at: "2026-02-01T10:00:00Z",
        },
        {
          id: 6,
          patient_id: 7,
          deal_id: 10,
          service_id: 3,
          status: "completed",
          starts_at: "2026-02-02T10:00:00Z",
        },
      ],
      services: [{ id: 3, name: "Гигиена", price: 25000 }],
    });
    expect(lines.map((line) => [line.name, line.amount])).toEqual([
      ["Имплант", 200000],
      ["План", -20000],
      ["Гигиена", 25000],
    ]);
    expect(actTotal(lines)).toBe(205000);
  });

  it("keeps to one deal when asked", () => {
    const lines = actLines({
      patientId: 7,
      dealId: 99,
      plans: [plan({})],
      items: [item({})],
      visits: [],
      services: [],
    });
    expect(lines).toEqual([]);
  });
});

describe("documents", () => {
  it("titles a receipt by its kind", () => {
    expect(
      receiptTitleKey({ kind: "payment", account: "services", method: "cash" }),
    ).toBe("payments.receipt.title_payment");
    expect(
      receiptTitleKey({ kind: "refund", account: "services", method: "deposit" }),
    ).toBe("payments.receipt.title_refund_deposit");
  });
  it("names the file safely", () => {
    expect(documentFileName("Квитанция", 12, "Нурланова / Асель")).toBe(
      "Квитанция — 12 — Нурланова Асель.pdf",
    );
  });
});
