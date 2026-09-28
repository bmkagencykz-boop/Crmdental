import { describe, expect, it } from "vitest";

import {
  accountTotals,
  changeDue,
  checkOperation,
  checkParts,
  itemsAmount,
  methodAmount,
  normalizeOperation,
  operationDeltas,
  parseAmount,
  partsRemainder,
  patientCharged,
  paymentRights,
  planDoneCharge,
  planPaid,
  shiftExpected,
  tillTotals,
} from "./paymentMath";
import type { AccountOperation } from "./types";

type Op = Pick<
  AccountOperation,
  "kind" | "account" | "method" | "amount" | "parts" | "deal_id" | "plan_id"
>;
const op = (data: Partial<Op> & Pick<Op, "kind" | "amount">): Op =>
  normalizeOperation({
    account: "services",
    method: "cash",
    parts: null,
    ...data,
  } as Op);

describe("operationDeltas (the generated columns)", () => {
  it("payment: paid and in the till", () => {
    expect(operationDeltas(op({ kind: "payment", amount: 5000 }))).toEqual({
      deposit: 0,
      paid: 5000,
      till: 5000,
    });
  });
  it("deposit: on the deposit and in the till", () => {
    expect(
      operationDeltas(
        op({ kind: "deposit", amount: 10000, method: "kaspi_qr" }),
      ),
    ).toEqual({ deposit: 10000, paid: 0, till: 10000 });
  });
  it("payment from the deposit: no money moves", () => {
    const row = op({ kind: "deposit_payment", amount: 4000 });
    expect(row.method).toBe("deposit");
    expect(operationDeltas(row)).toEqual({ deposit: -4000, paid: 4000, till: 0 });
  });
  it("refunds: in cash, back to the deposit, from the deposit", () => {
    expect(operationDeltas(op({ kind: "refund", amount: 1000 }))).toEqual({
      deposit: 0,
      paid: -1000,
      till: -1000,
    });
    expect(
      operationDeltas(op({ kind: "refund", amount: 1000, method: "deposit" })),
    ).toEqual({ deposit: 1000, paid: -1000, till: 0 });
    expect(
      operationDeltas(
        op({ kind: "refund", amount: 1000, account: "deposit", method: "card" }),
      ),
    ).toEqual({ deposit: -1000, paid: 0, till: -1000 });
  });
  it("correction: signed, no till", () => {
    const row = op({ kind: "correction", amount: -300, account: "deposit" });
    expect(row.method).toBe("other");
    expect(operationDeltas(row)).toEqual({ deposit: -300, paid: 0, till: 0 });
  });
});

describe("mixed payments and change", () => {
  const mixed = op({
    kind: "payment",
    amount: 70000,
    method: "mixed",
    parts: [
      { method: "card", amount: 40000 },
      { method: "kaspi_qr", amount: 20000 },
      { method: "cash", amount: 10000 },
    ],
  });
  it("splits by method", () => {
    expect(methodAmount(mixed, "card")).toBe(40000);
    expect(methodAmount(mixed, "cash")).toBe(10000);
    expect(methodAmount(mixed, "insurance")).toBe(0);
  });
  it("checks the parts", () => {
    expect(checkParts(70000, mixed.parts)).toBeNull();
    expect(checkParts(80000, mixed.parts)).toBe("payments.errors.parts_sum");
    expect(checkParts(40000, [{ method: "card", amount: 40000 }])).toBe(
      "payments.errors.parts_count",
    );
    expect(
      checkParts(2000, [
        { method: "card", amount: 1000 },
        { method: "cash", amount: 0 },
      ]),
    ).toBe("payments.errors.part_invalid");
    expect(partsRemainder(70000, [{ method: "card", amount: 50000 }])).toBe(
      20000,
    );
  });
  it("gives the change of the cash part", () => {
    expect(changeDue(mixed, 20000)).toBe(10000);
    expect(changeDue(op({ kind: "payment", amount: 12500 }), 20000)).toBe(
      7500,
    );
    expect(changeDue(op({ kind: "payment", amount: 12500 }), 10000)).toBe(
      -2500,
    );
    expect(
      changeDue(op({ kind: "payment", amount: 5000, method: "card" }), 10000),
    ).toBeNull();
    expect(changeDue(op({ kind: "payment", amount: 5000 }), null)).toBeNull();
  });
});

describe("balances", () => {
  it("balance = deposit + paid − services done; debt and advance", () => {
    const ops = [
      op({ kind: "payment", amount: 120000 }),
      op({ kind: "deposit", amount: 100000 }),
      op({ kind: "deposit_payment", amount: 60000 }),
      op({ kind: "refund", amount: 10000 }),
    ];
    expect(accountTotals(ops, 300000)).toEqual({
      deposit: 40000,
      paid: 170000,
      charged: 300000,
      debt: 130000,
      advance: 0,
      balance: -90000,
    });
    expect(accountTotals(ops, 0).advance).toBe(170000);
  });

  it("the done items of a plan with the plan discount pro rata", () => {
    expect(planDoneCharge(300000, 0, 0, 0)).toBe(0);
    expect(planDoneCharge(300000, 300000, 10, 0)).toBe(270000);
    expect(planDoneCharge(300000, 100000, 10, 0)).toBe(90000);
    expect(planDoneCharge(1000, 333, 0, 100)).toBe(300);
  });

  it("charges done items and completed priced visits without a plan", () => {
    const plans = [
      {
        id: 1,
        deal_id: 10,
        patient_id: 7,
        status: "in_progress" as const,
        is_main: true,
        discount_percent: 0,
        discount_amount: 0,
      },
    ];
    const items = [
      { plan_id: 1, quantity: 1, unit_price: 200000, discount_percent: 0, done: true },
      { plan_id: 1, quantity: 1, unit_price: 100000, discount_percent: 0, done: false },
    ];
    const visits = [
      { patient_id: 7, deal_id: 11, service_id: 5, status: "completed" },
      { patient_id: 7, deal_id: 10, service_id: 5, status: "completed" },
      { patient_id: 7, deal_id: 11, service_id: 5, status: "booked" },
      { patient_id: 8, deal_id: 12, service_id: 5, status: "completed" },
    ];
    expect(
      patientCharged({
        patientId: 7,
        plans,
        items,
        visits,
        services: [{ id: 5, price: 25000 }],
      }),
    ).toBe(225000);
  });

  it("the paid amount of a plan", () => {
    const ops = [
      op({ kind: "payment", amount: 1000, plan_id: 1, deal_id: 10 }),
      op({ kind: "payment", amount: 500, deal_id: 10 }),
      op({ kind: "payment", amount: 200, plan_id: 2, deal_id: 10 }),
      op({ kind: "refund", amount: 100, plan_id: 1, deal_id: 10 }),
    ];
    expect(planPaid({ id: 1, deal_id: 10, is_main: true }, ops)).toBe(1400);
    expect(planPaid({ id: 2, deal_id: 10, is_main: false }, ops)).toBe(200);
  });
});

describe("the cash desk", () => {
  const ops = [
    op({ kind: "payment", amount: 50000 }),
    op({
      kind: "payment",
      amount: 30000,
      method: "mixed",
      parts: [
        { method: "card", amount: 20000 },
        { method: "cash", amount: 10000 },
      ],
    }),
    op({ kind: "deposit", amount: 15000, method: "kaspi_qr" }),
    op({ kind: "deposit_payment", amount: 15000 }),
    op({ kind: "refund", amount: 5000 }),
    op({ kind: "correction", amount: 999, account: "services" }),
  ];
  it("expected cash of a shift", () => {
    expect(shiftExpected(10000, ops)).toBe(65000);
  });
  it("totals by method", () => {
    const { byMethod, total } = tillTotals(ops);
    expect(byMethod.cash).toEqual({
      income: 60000,
      refunds: 5000,
      net: 55000,
      count: 3,
    });
    expect(byMethod.card.income).toBe(20000);
    expect(byMethod.kaspi_qr.income).toBe(15000);
    expect(total).toEqual({
      income: 95000,
      refunds: 5000,
      net: 90000,
      count: 4,
    });
  });
});

describe("checkOperation", () => {
  const state = { deposit: 10000, paid: 20000 };
  it("accepts a regular payment", () => {
    expect(checkOperation(op({ kind: "payment", amount: 5000 }), state)).toBeNull();
  });
  it("refuses beyond the deposit or the paid amount", () => {
    expect(
      checkOperation(op({ kind: "deposit_payment", amount: 15000 }), state),
    ).toBe("payments.errors.deposit_insufficient");
    expect(checkOperation(op({ kind: "refund", amount: 25000 }), state)).toBe(
      "payments.errors.refund_exceeds_paid",
    );
    expect(
      checkOperation(
        op({ kind: "refund", amount: 15000, account: "deposit", method: "cash" }),
        state,
      ),
    ).toBe("payments.errors.deposit_insufficient");
  });
  it("refuses short cash and empty amounts", () => {
    expect(
      checkOperation(
        { ...op({ kind: "payment", amount: 5000 }), cash_received: 4000 },
        state,
      ),
    ).toBe("payments.errors.cash_short");
    expect(checkOperation(op({ kind: "payment", amount: 0 }), state)).toBe(
      "payments.errors.amount",
    );
  });
});

describe("parseAmount", () => {
  it("reads spaces and the tenge sign", () => {
    expect(parseAmount("12 500 ₸")).toBe(12500);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount(300)).toBe(300);
  });
});

describe("paymentRights", () => {
  it("cashiers accept, seniors refund, the owner corrects", () => {
    expect(paymentRights("manager")).toEqual({
      canAccept: true,
      canRefund: false,
      canEdit: false,
      canCorrect: false,
      seesAll: false,
    });
    expect(paymentRights("manager", "all").seesAll).toBe(true);
    expect(paymentRights("head").canRefund).toBe(true);
    expect(paymentRights("head").canCorrect).toBe(false);
    expect(paymentRights("owner").canCorrect).toBe(true);
    expect(paymentRights("integrator").canAccept).toBe(false);
  });
});

describe("itemsAmount", () => {
  it("proposes the chosen items with the plan discount", () => {
    const plan = { id: 1, discount_percent: 10, discount_amount: 0 };
    const items = [
      { id: 1, plan_id: 1, quantity: 1, unit_price: 200000, discount_percent: 0, done: false },
      { id: 2, plan_id: 1, quantity: 2, unit_price: 50000, discount_percent: 0, done: false },
    ];
    expect(itemsAmount(plan, items, [])).toBe(0);
    expect(itemsAmount(plan, items, [2])).toBe(90000);
    expect(itemsAmount(plan, items, [1, 2])).toBe(270000);
  });
});
