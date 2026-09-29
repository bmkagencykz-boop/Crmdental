import { describe, expect, it } from "vitest";

import {
  addDays,
  applyLabStatus,
  courierDays,
  courierEvents,
  doctorLabCost,
  dueReminders,
  filterOrders,
  EMPTY_FILTERS,
  initials,
  labKpis,
  labSettlement,
  nextEvent,
  orderCost,
  overdueDays,
  shiftMonth,
  sortForBoard,
  teethText,
} from "./labMath";
import type { LabOrder, LabOrderCost } from "./types";

const TODAY = "2026-09-29";

const order = (patch: Partial<LabOrder>): LabOrder => ({
  id: 1,
  number: 1,
  patient_id: 1,
  teeth: [],
  status: "lab",
  remake_count: 0,
  created_at: "2026-09-01T10:00:00Z",
  ...patch,
});

describe("dates", () => {
  it("adds days across months and shifts months", () => {
    expect(addDays("2026-09-29", 3)).toBe("2026-10-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
  });
});

describe("overdueDays (private.lab_overdue_days)", () => {
  it("counts the days after the due date of an active order", () => {
    expect(overdueDays("lab", "2026-09-27", TODAY)).toBe(2);
    expect(overdueDays("fitting", "2026-01-01", "2026-01-10")).toBe(9);
  });
  it("is 0 on the due day, without a date, and for a work back", () => {
    expect(overdueDays("lab", TODAY, TODAY)).toBe(0);
    expect(overdueDays("lab", null, TODAY)).toBe(0);
    expect(overdueDays("ready", "2026-01-01", TODAY)).toBe(0);
    expect(overdueDays("delivered", "2026-01-01", TODAY)).toBe(0);
  });
});

describe("applyLabStatus (handle_lab_order_before_write)", () => {
  it("stamps the date sent to the lab", () => {
    expect(applyLabStatus(null, { status: "lab" }, TODAY)).toMatchObject({
      sent_at: TODAY,
      ready_at: null,
      remake_count: 0,
    });
    expect(
      applyLabStatus(null, { status: "courier", sent_at: "2026-09-20" }, TODAY)
        .sent_at,
    ).toBe("2026-09-20");
  });
  it("stamps ready and given, clears them when reopened", () => {
    const ready = applyLabStatus(order({}), { status: "ready" }, TODAY);
    expect(ready).toMatchObject({ ready_at: TODAY, delivered_at: null });
    const given = applyLabStatus(
      order({ ...ready, status: "ready" }),
      { status: "delivered" },
      TODAY,
    );
    expect(given).toMatchObject({ ready_at: TODAY, delivered_at: TODAY });
    const remake = applyLabStatus(
      order({ ...given, status: "delivered" }),
      { status: "remake" },
      TODAY,
    );
    expect(remake).toMatchObject({
      remake_count: 1,
      ready_at: null,
      delivered_at: null,
    });
    // Still a remake: counted once
    expect(
      applyLabStatus(order({ status: "remake", remake_count: 1 }), {}, TODAY)
        .remake_count,
    ).toBe(1);
  });
  it("closes the order given a date to the patient", () => {
    expect(
      applyLabStatus(order({}), { delivered_at: "2026-09-28" }, TODAY),
    ).toMatchObject({
      status: "delivered",
      delivered_at: "2026-09-28",
      ready_at: TODAY,
    });
  });
});

describe("events and reminders", () => {
  const o = order({
    fitting1_at: "2026-09-25",
    fitting2_at: "2026-09-30",
    due_at: "2026-10-05",
  });
  it("gives the next date, today included", () => {
    expect(nextEvent(o, TODAY)).toEqual({
      kind: "fitting2",
      day: "2026-09-30",
    });
    expect(nextEvent({ ...o, status: "ready" }, TODAY)).toBeNull();
  });
  it("reminds the day before and the day of, and when overdue (lab_orders_tick)", () => {
    expect(dueReminders(o, TODAY)).toEqual([
      { kind: "fitting2", day: "2026-09-30" },
    ]);
    expect(
      dueReminders(order({ fitting1_at: TODAY, due_at: "2026-09-20" }), TODAY),
    ).toEqual([
      { kind: "fitting1", day: TODAY },
      { kind: "overdue", day: "2026-09-20" },
    ]);
    expect(dueReminders({ ...o, status: "delivered" }, TODAY)).toEqual([]);
  });
});

describe("labKpis", () => {
  it("counts in work, done this month, overdue", () => {
    const orders = [
      order({
        status: "lab",
        due_at: "2026-09-27",
        created_at: "2026-09-20T09:00:00Z",
      }),
      order({
        status: "fitting",
        due_at: "2026-10-03",
        created_at: "2026-07-01T09:00:00Z",
      }),
      order({ status: "ready", ready_at: "2026-09-10" }),
      order({ status: "delivered", ready_at: "2026-09-02" }),
      order({ status: "delivered", ready_at: "2026-08-05" }),
      order({ status: "delivered", ready_at: "2026-08-30" }),
    ];
    expect(labKpis(orders, TODAY)).toEqual({
      inWork: 2,
      newInWork: 1,
      done: 2,
      // Last month up to the 29th: one
      doneChange: 1,
      overdue: 1,
      dueThisWeek: 1,
    });
  });
});

const cost = (patch: Partial<LabOrderCost>): LabOrderCost => ({
  id: 1,
  order_id: 1,
  order_number: 1,
  patient_id: 1,
  name: "Коронка",
  qty: 1,
  price: 18000,
  amount: 18000,
  status: "ready",
  lab_id: 1,
  doctor_id: 1,
  ready_at: "2026-09-10",
  ...patch,
});

describe("money", () => {
  it("sums the lines of an order", () => {
    expect(
      orderCost([
        { qty: 2, price: 20000 },
        { qty: 2, price: 6000 },
      ]),
    ).toBe(52000);
    expect(orderCost([{ qty: 1, price: null }])).toBe(0);
  });
  it("settles the labs of the month (report_lab_settlement)", () => {
    const labs = [
      { id: 1, name: "Дентал-Арт", is_own: false },
      { id: 2, name: "Своя", is_own: true },
    ];
    const rows = labSettlement(
      [
        cost({ id: 1, order_id: 1, qty: 2, price: 20000 }),
        cost({ id: 2, order_id: 1, qty: 2, price: 6000 }),
        cost({ id: 3, order_id: 2, lab_id: 2, price: 5000 }),
        cost({ id: 4, order_id: 3, ready_at: "2026-08-31" }),
        cost({ id: 5, order_id: 4, ready_at: null }),
      ],
      labs,
      "2026-09-01",
    );
    expect(rows).toEqual([
      {
        lab_id: 1,
        lab_name: "Дентал-Арт",
        is_own: false,
        orders_count: 1,
        items_count: 4,
        amount: 52000,
      },
      {
        lab_id: 2,
        lab_name: "Своя",
        is_own: true,
        orders_count: 1,
        items_count: 1,
        amount: 5000,
      },
    ]);
  });
  it("gives the lab cost of a doctor in a month (payroll)", () => {
    const costs = [
      cost({ qty: 2, price: 20000 }),
      cost({ doctor_id: 2 }),
      cost({ ready_at: "2026-08-01" }),
    ];
    expect(doctorLabCost(costs, 1, "2026-09-01")).toBe(40000);
  });
});

describe("couriers", () => {
  it("gives the days of a day, a week and a month", () => {
    expect(courierDays("day", TODAY)).toEqual([TODAY]);
    const week = courierDays("week", TODAY);
    expect(week[0]).toBe("2026-09-28");
    expect(week).toHaveLength(7);
    expect(courierDays("month", TODAY)).toHaveLength(30);
  });
  it("gives the trips of the external labs", () => {
    const labs = [
      { id: 1, is_own: false },
      { id: 2, is_own: true },
    ];
    const events = courierEvents(
      [
        order({ id: 1, lab_id: 1, sent_at: TODAY, fitting1_at: "2026-10-01" }),
        order({ id: 2, lab_id: 1, status: "clinic" }),
        order({ id: 3, lab_id: 1, due_at: TODAY }),
        order({ id: 4, lab_id: 2, sent_at: TODAY }),
        order({
          id: 5,
          lab_id: 1,
          status: "ready",
          ready_at: TODAY,
          due_at: "2026-10-02",
        }),
      ],
      labs,
      courierDays("week", TODAY),
      TODAY,
    );
    expect(
      events.map((e) => [e.day, e.direction, e.kind, e.orderId, e.done]),
    ).toEqual([
      [TODAY, "dropoff", "send", 1, true],
      [TODAY, "dropoff", "send", 2, false],
      [TODAY, "pickup", "due", 3, false],
      [TODAY, "pickup", "due", 5, true],
      ["2026-10-01", "dropoff", "fitting1", 1, false],
      ["2026-10-01", "pickup", "fitting1", 1, false],
    ]);
  });
});

describe("board", () => {
  const orders = [
    order({
      id: 1,
      number: 1,
      doctor_id: 1,
      technician_id: 5,
      due_at: "2026-10-10",
    }),
    order({
      id: 2,
      number: 2,
      doctor_id: 2,
      technician_id: 5,
      due_at: "2026-09-20",
    }),
    order({
      id: 3,
      number: 3,
      doctor_id: 1,
      technician_id: 6,
      due_at: "2026-10-01",
    }),
    order({ id: 4, number: 4, doctor_id: 1, status: "delivered" }),
  ];
  it("filters by doctors, technicians and the scope", () => {
    expect(
      filterOrders(orders, { ...EMPTY_FILTERS, doctorIds: ["1"] }).map(
        (o) => o.id,
      ),
    ).toEqual([1, 3]);
    expect(
      filterOrders(orders, {
        ...EMPTY_FILTERS,
        doctorIds: ["1"],
        technicianIds: ["5"],
      }).map((o) => o.id),
    ).toEqual([1]);
    expect(
      filterOrders(orders, { ...EMPTY_FILTERS, scope: "done" }).map(
        (o) => o.id,
      ),
    ).toEqual([4]);
    expect(
      filterOrders(orders, { ...EMPTY_FILTERS, scope: "all", q: "3" }).map(
        (o) => o.id,
      ),
    ).toEqual([3]);
  });
  it("puts the overdue first, then the nearest date", () => {
    expect(sortForBoard(orders, TODAY).map((o) => o.id)).toEqual([2, 3, 1, 4]);
  });
  it("formats initials and teeth", () => {
    expect(initials("Ахметова Айгуль Серикқызы")).toBe("АА");
    expect(initials(null)).toBe("—");
    expect(teethText([36, 11, 21])).toBe("11, 21, 36");
  });
});
