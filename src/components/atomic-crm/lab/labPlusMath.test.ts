import { describe, expect, it } from "vitest";

import { applyLabStatus, labSettlement } from "./labMath";
import {
  addWorkDays,
  allocationError,
  inWarranty,
  isoWeekday,
  labPriceOn,
  labQuality,
  labReconciliation,
  orderBalances,
  proposeDates,
  qualityRange,
  remakeCosts,
  remakeIsPaid,
  warrantyUntil,
} from "./labPlusMath";
import type { LabOrder, LabOrderCost, LabOrderRemake } from "./types";

const TODAY = "2026-09-29";

describe("labPriceOn (private.lab_price_on)", () => {
  const prices = [
    {
      work_type_id: 1,
      lab_id: null,
      effective_from: "2000-01-01",
      price: 18000,
    },
    {
      work_type_id: 1,
      lab_id: null,
      effective_from: "2026-09-24",
      price: 19000,
    },
    { work_type_id: 1, lab_id: 2, effective_from: "2026-08-30", price: 20000 },
    { work_type_id: 1, lab_id: 2, effective_from: "2026-10-09", price: 22000 },
  ];
  it("takes the lab's price effective on the day, else the default", () => {
    expect(labPriceOn(prices, 1, 1, "2026-09-19")).toBe(18000);
    expect(labPriceOn(prices, 1, 1, TODAY)).toBe(19000);
    expect(labPriceOn(prices, 1, 2, "2026-08-20")).toBe(18000);
    expect(labPriceOn(prices, 1, 2, TODAY)).toBe(20000);
    expect(labPriceOn(prices, 1, 2, "2026-10-09")).toBe(22000);
    expect(labPriceOn(prices, 1, null, TODAY)).toBe(19000);
  });
  it("is 0 without a price", () => {
    expect(labPriceOn(prices, 2, 1, TODAY)).toBe(0);
  });
});

describe("terms (private.lab_add_work_days, public.lab_propose_dates)", () => {
  it("counts the working days of the lab", () => {
    expect(isoWeekday("2026-10-03")).toBe(6);
    expect(addWorkDays("2026-10-03", 1, [1, 2, 3, 4, 5, 6])).toBe("2026-10-05");
    expect(addWorkDays("2026-10-02", 0, [1, 2, 3, 4, 5])).toBe("2026-10-02");
    expect(addWorkDays("2026-10-02", 2, null)).toBe("2026-10-04");
    expect(addWorkDays("2026-10-02", null, null)).toBeNull();
  });
  it("proposes the longest terms, the lab's own first", () => {
    const workTypes = [
      { id: 1, fitting_days: 3, ready_days: 7 },
      { id: 5, fitting_days: null, ready_days: 2 },
    ];
    const lab = { id: 2, work_weekdays: [1, 2, 3, 4, 5] };
    expect(
      proposeDates({
        lab,
        workTypeIds: [1, 5],
        workTypes,
        terms: [],
        start: "2026-10-02",
      }),
    ).toEqual({
      fitting_days: 3,
      ready_days: 7,
      fitting_at: "2026-10-07",
      due_at: "2026-10-13",
    });
    expect(
      proposeDates({
        lab,
        workTypeIds: [1],
        workTypes,
        terms: [
          { lab_id: 2, work_type_id: 1, fitting_days: null, ready_days: 5 },
        ],
        start: "2026-10-02",
      }),
    ).toMatchObject({ fitting_at: "2026-10-07", due_at: "2026-10-09" });
    expect(
      proposeDates({
        lab: null,
        workTypeIds: [5],
        workTypes,
        terms: [],
        start: TODAY,
      }),
    ).toMatchObject({ fitting_at: null, due_at: "2026-10-01" });
  });
});

describe("remakes and the warranty", () => {
  it("is paid for the clinic's or the patient's fault, not under the warranty", () => {
    expect(remakeIsPaid("clinic", false)).toBe(true);
    expect(remakeIsPaid("patient", false)).toBe(true);
    expect(remakeIsPaid("lab", false)).toBe(false);
    expect(remakeIsPaid(null, false)).toBe(false);
    expect(remakeIsPaid("clinic", true)).toBe(false);
  });
  it("counts the warranty from the first delivery", () => {
    expect(warrantyUntil("2026-01-31", 1)).toBe("2026-02-28");
    expect(warrantyUntil("2026-09-29", 12)).toBe("2027-09-29");
    expect(warrantyUntil("2026-09-29", 0)).toBeNull();
    expect(warrantyUntil(null, 12)).toBeNull();
    expect(inWarranty("2025-10-01", 12, TODAY)).toBe(true);
    expect(inWarranty("2025-09-01", 12, TODAY)).toBe(false);
  });
  it("keeps the first ready and delivered days through a remake", () => {
    const base: LabOrder = {
      id: 1,
      number: 1,
      patient_id: 1,
      teeth: [],
      status: "clinic",
      remake_count: 0,
      created_at: "2026-09-01T10:00:00Z",
    };
    const ready = {
      ...base,
      ...applyLabStatus(base, { status: "ready" }, "2026-09-10"),
    };
    expect(ready.first_ready_at).toBe("2026-09-10");
    const given = {
      ...ready,
      ...applyLabStatus(ready, { status: "delivered" }, "2026-09-12"),
    };
    expect(given.first_delivered_at).toBe("2026-09-12");
    const remade = {
      ...given,
      ...applyLabStatus(given, { status: "remake" }, TODAY),
    };
    expect(remade).toMatchObject({
      ready_at: null,
      delivered_at: null,
      first_ready_at: "2026-09-10",
      first_delivered_at: "2026-09-12",
    });
    const back = applyLabStatus(remade, { status: "ready" }, "2026-10-02");
    expect(back).toMatchObject({
      ready_at: "2026-10-02",
      first_ready_at: "2026-09-10",
    });
    // Ready by mistake and undone: no first readiness
    const undone = applyLabStatus(ready, { status: "lab" }, "2026-09-11");
    expect(undone.first_ready_at).toBeNull();
  });
});

const order = (patch: Partial<LabOrder>) =>
  ({
    id: 1,
    number: 1,
    patient_id: 1,
    lab_id: 1,
    status: "ready",
    ready_at: "2026-09-20",
    ...patch,
  }) as LabOrder;

describe("the paid remakes in the costs and the settlement", () => {
  const remakes: LabOrderRemake[] = [
    {
      id: 7,
      order_id: 1,
      reason: "Не сел",
      fault: "clinic",
      is_warranty: false,
      is_paid: true,
      occurred_on: "2026-09-15",
      ready_at: "2026-09-20",
    },
    {
      id: 8,
      order_id: 1,
      reason: "Скол",
      fault: "lab",
      is_warranty: false,
      is_paid: false,
      occurred_on: "2026-09-21",
      ready_at: null,
    },
  ];
  it("adds a row per paid remake: the lines' cost, billed when back", () => {
    const rows = remakeCosts(remakes, [order({})], () => 40000);
    expect(rows).toEqual([
      expect.objectContaining({
        id: -7,
        kind: "remake",
        name: "Переделка: Не сел",
        qty: 1,
        amount: 40000,
        billed_on: "2026-09-20",
        month: "2026-09-01",
      }),
    ]);
    expect(remakeCosts(remakes, [order({})], () => null)).toEqual([]);
  });
  it("bills a work on its first ready day, counts only the works", () => {
    const work: LabOrderCost = {
      id: 1,
      order_id: 1,
      order_number: 1,
      patient_id: 1,
      lab_id: 1,
      name: "Коронка",
      qty: 2,
      price: 20000,
      amount: 40000,
      status: "remake",
      ready_at: null,
      kind: "work",
      billed_on: "2026-08-28",
      month: "2026-08-01",
    };
    const costs = [work, ...remakeCosts(remakes, [order({})], () => 40000)];
    const labs = [{ id: 1, name: "Дентал-Арт", is_own: false }];
    expect(labSettlement(costs, labs, "2026-08-01")[0]).toMatchObject({
      amount: 40000,
      orders_count: 1,
      items_count: 2,
    });
    expect(labSettlement(costs, labs, "2026-09-01")[0]).toMatchObject({
      amount: 40000,
      orders_count: 0,
      items_count: 0,
      total_balance: 80000,
    });
  });
});

describe("labQuality (public.report_lab_quality)", () => {
  const base = {
    lab_id: 1,
    technician_id: 3,
    doctor_id: 2,
    branch_id: null,
    remake_count: 0,
    created_on: TODAY,
  };
  const orders = [
    {
      ...base,
      id: 1,
      status: "ready" as const,
      sent_at: "2026-09-19",
      due_at: "2026-09-26",
      first_ready_at: "2026-09-25",
    },
    {
      ...base,
      id: 2,
      status: "ready" as const,
      sent_at: "2026-09-21",
      due_at: "2026-09-27",
      first_ready_at: "2026-09-28",
    },
    {
      ...base,
      id: 3,
      status: "lab" as const,
      sent_at: "2026-09-24",
      due_at: "2026-09-28",
      first_ready_at: null,
    },
    {
      ...base,
      id: 4,
      status: "remake" as const,
      sent_at: "2026-09-23",
      due_at: "2026-10-04",
      first_ready_at: null,
      remake_count: 1,
    },
  ];
  const report = labQuality({
    orders,
    remakes: [
      {
        order_id: 4,
        reason: "Скол",
        fault: "lab",
        is_warranty: false,
        occurred_on: TODAY,
      },
    ],
    costs: [
      {
        order_id: 1,
        amount: 19000,
        billed_on: "2026-09-25",
        ready_at: "2026-09-25",
      },
      {
        order_id: 2,
        amount: 19000,
        billed_on: "2026-09-28",
        ready_at: "2026-09-28",
      },
    ],
    from: "2026-08-31",
    to: TODAY,
    today: TODAY,
    names: {
      labs: [{ id: 1, name: "Дентал-Арт" }],
      technicians: [{ id: 3, name: "Качество" }],
      doctors: [{ id: 2, name: "Сериков" }],
    },
  });
  it("counts the orders, on time, lead time, remakes, overdue, cost", () => {
    expect(report.technicians).toEqual([
      {
        id: 3,
        name: "Качество",
        orders: 4,
        remade_orders: 1,
        remake_rate: 25,
        ready: 2,
        ready_with_due: 2,
        on_time: 1,
        on_time_pct: 50,
        avg_lead_days: 6.5,
        remakes: 1,
        lab_fault: 1,
        clinic_fault: 0,
        patient_fault: 0,
        warranty: 0,
        reasons: [{ reason: "Скол", count: 1 }],
        overdue_now: 1,
        cost: 38000,
      },
    ]);
    expect(report.totals).toMatchObject({ id: null, orders: 4, remakes: 1 });
    expect(report.reasons).toEqual([{ reason: "Скол", count: 1 }]);
  });
  it("filters the branch and keeps the rows with anything to show", () => {
    const other = labQuality({
      orders,
      remakes: [],
      costs: [],
      from: "2026-01-01",
      to: "2026-01-31",
      today: TODAY,
      branchId: 5,
      names: { labs: [], technicians: [], doctors: [] },
    });
    expect(other.totals.orders).toBe(0);
    expect(other.labs).toEqual([]);
  });
  it("offers the usual periods", () => {
    expect(qualityRange("30d", TODAY)).toEqual({
      from: "2026-08-31",
      to: TODAY,
    });
    expect(qualityRange("month", TODAY)).toEqual({
      from: "2026-09-01",
      to: TODAY,
    });
    expect(qualityRange("last_month", TODAY)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});

describe("labReconciliation (public.report_lab_reconciliation)", () => {
  const cost = (patch: Partial<LabOrderCost>): LabOrderCost => ({
    id: 1,
    order_id: 11,
    order_number: 11,
    patient_id: 1,
    lab_id: 3,
    name: "Коронка",
    qty: 1,
    price: 19000,
    amount: 19000,
    status: "ready",
    kind: "work",
    ...patch,
  });
  it("balances the opening, the works, the payments and the closing", () => {
    const act = labReconciliation({
      lab: { id: 3, name: "Акт-Лаб" },
      costs: [
        cost({ billed_on: "2026-08-20" }),
        cost({
          id: 2,
          order_id: 12,
          order_number: 12,
          name: "Временная коронка",
          qty: 2,
          price: 5000,
          amount: 10000,
          billed_on: "2026-09-19",
        }),
        cost({ id: 3, lab_id: 4, billed_on: "2026-09-19" }),
      ],
      payments: [
        {
          id: 1,
          lab_id: 3,
          amount: 15000,
          method: "bank_transfer",
          comment: "аванс",
          month: "2026-08-01",
          paid_at: "2026-08-25T07:00:00Z",
        },
        {
          id: 2,
          lab_id: 3,
          amount: 12000,
          method: "kaspi_transfer",
          comment: null,
          month: "2026-09-01",
          paid_at: "2026-09-24T07:00:00Z",
        },
      ],
      allocations: [
        { payment_id: 2, order_id: 12 },
        { payment_id: 2, order_id: 11 },
      ],
      orderNumbers: (id) => Number(id),
      patientNames: () => "Нурланова Асель",
      from: "2026-08-30",
      to: TODAY,
      paidDay: (at) => at.slice(0, 10),
    });
    expect(act).toMatchObject({
      opening: 4000,
      charged: 10000,
      paid: 12000,
      closing: 2000,
    });
    expect(act.lines).toEqual([
      expect.objectContaining({
        day: "2026-09-19",
        kind: "work",
        number: 12,
        works: "Временная коронка × 2",
        debit: 10000,
        credit: 0,
      }),
      expect.objectContaining({
        day: "2026-09-24",
        kind: "payment",
        orders: "№11, №12",
        debit: 0,
        credit: 12000,
      }),
    ]);
  });
});

describe("allocations", () => {
  it("balances each order", () => {
    const balances = orderBalances(
      [
        { order_id: 1, amount: 40000 },
        { order_id: 1, amount: 40000 },
        { order_id: 2, amount: 10000 },
      ],
      [{ order_id: 2, amount: 10000 }],
    );
    expect(balances.get("1")).toEqual({
      cost: 80000,
      allocated: 0,
      due: 80000,
    });
    expect(balances.get("2")).toEqual({
      cost: 10000,
      allocated: 10000,
      due: 0,
    });
  });
  it("keeps an allocation in the lab, the payment and the order's cost", () => {
    const ok = {
      paymentLabId: 1,
      paymentAmount: 12000,
      orderLabId: 1,
      amount: 2000,
      allocatedOfPayment: 10000,
      allocatedOfOrder: 0,
      orderCost: 19000,
    };
    expect(allocationError(ok)).toBeNull();
    expect(allocationError({ ...ok, orderLabId: 2 })).toBe(
      "lab_allocation_lab",
    );
    expect(allocationError({ ...ok, amount: 5000 })).toBe(
      "lab_allocation_over_payment",
    );
    expect(allocationError({ ...ok, orderCost: 1000 })).toBe(
      "lab_allocation_over_order",
    );
  });
});
