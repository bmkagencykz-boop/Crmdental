import { describe, expect, it } from "vitest";

import type { AccountOperation } from "../payments/types";
import type { Visit } from "../schedule/types";
import { lineTotal } from "../treatment/planMath";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../treatment/types";
import type { Doctor, Sale, Service } from "../types";
import {
  buildPayrollMonth,
  computePayrollLines,
  heatLevel,
  isDayOff,
  lineMoney,
  monthDays,
  monthLabel,
  mulDiv,
  nextMonth,
  percentFor,
  previousMonth,
  roundDiv,
  schemeAt,
  schemeError,
  topLines,
  type PayrollInput,
} from "./payrollMath";
import type { PayrollAdjustment, PayrollScheme } from "./types";

// The same clinic as supabase/tests/039_payroll.test.sql (August 2026)
const doctors: Doctor[] = [
  {
    id: 1,
    name: "Терапевт",
    specialty: "терапевт",
    is_active: true,
    position: 0,
    working_hours: {
      "1": { start: "09:00", end: "18:00" },
      "2": { start: "09:00", end: "18:00" },
      "3": { start: "09:00", end: "18:00" },
      "4": { start: "09:00", end: "18:00" },
      "5": { start: "09:00", end: "18:00" },
    },
  },
  {
    id: 2,
    name: "Ортопед",
    specialty: "ортопед",
    is_active: true,
    position: 1,
  },
  {
    id: 3,
    name: "Гигиенист",
    specialty: "гигиенист",
    is_active: true,
    position: 2,
  },
];
const sales = [
  { id: 10, first_name: "m1", last_name: "Test", role: "manager" },
  { id: 11, first_name: "head", last_name: "Test", role: "head" },
] as Sale[];
const categories = [
  { id: 100, parent_id: null, name: "Терапия", position: 0 },
  { id: 101, parent_id: null, name: "Ортопедия", position: 1 },
  { id: 102, parent_id: 100, name: "Лечение кариеса", position: 0 },
];
const services = [
  { id: 200, name: "Пломба", price: 30000, category_id: 102 },
  { id: 201, name: "Коронка", price: 100000, category_id: 101 },
  { id: 202, name: "Консультация", price: 10000, category_id: null },
] as Service[];
const costs = [
  { service_id: 200, cost_price: 5000 },
  { service_id: 201, cost_price: 20000 },
];
const plan = (
  id: number,
  deal: number,
  patient: number,
  extra: Partial<TreatmentPlan> = {},
): TreatmentPlan => ({
  id,
  deal_id: deal,
  patient_id: patient,
  name: `plan${id}`,
  status: "draft",
  is_main: false,
  discount_percent: 0,
  discount_amount: 0,
  doctor_id: 1,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
  ...extra,
});
const stage = (
  id: number,
  planId: number,
  position: number,
  extra: Partial<TreatmentStage> = {},
): TreatmentStage => ({
  id,
  plan_id: planId,
  position,
  name: `Этап ${position}`,
  status: "in_progress",
  discount_percent: 0,
  doctor_id: null,
  ...extra,
});
let itemId = 300;
const item = (
  planId: number,
  stageId: number,
  serviceId: number,
  name: string,
  quantity: number,
  price: number,
  doneAt: string | null,
  extra: Partial<TreatmentPlanItem & { doctor_id: number }> = {},
): TreatmentPlanItem => ({
  id: itemId++,
  plan_id: planId,
  stage_id: stageId,
  stage_no: 1,
  service_id: serviceId,
  name,
  quantity,
  unit_price: price,
  discount_percent: 0,
  done: doneAt != null,
  done_at: doneAt,
  position: 0,
  line_total: lineTotal(quantity, price, 0),
  ...extra,
});
const op = (
  id: number,
  extra: Partial<AccountOperation> & {
    paid_delta: number;
    occurred_at: string;
  },
): AccountOperation => ({
  id,
  patient_id: 2,
  kind: extra.paid_delta > 0 ? "payment" : "refund",
  account: "services",
  amount: Math.abs(extra.paid_delta),
  method: "card",
  ...extra,
});
const visit = (
  id: number,
  doctor: number,
  start: string,
  status: Visit["status"],
  service: number | null = null,
): Visit => ({
  id,
  patient_id: 3,
  doctor_id: doctor,
  service_id: service,
  starts_at: start,
  ends_at: start,
  status,
  source: "crm",
});

const schemes: PayrollScheme[] = [
  {
    id: 1,
    doctor_id: 1,
    effective_from: "2026-01-01",
    fixed_salary: 0,
    percent: 20,
    percent_base: "price",
    deduct_materials: false,
    category_rates: [{ category_id: 100, percent: 30 }],
    visit_rate: 0,
    min_guaranteed: 0,
  },
  {
    id: 2,
    doctor_id: 1,
    effective_from: "2026-08-15",
    fixed_salary: 0,
    percent: 20,
    percent_base: "price",
    deduct_materials: false,
    category_rates: [
      { category_id: 100, percent: 30 },
      { category_id: 102, percent: 35 },
    ],
    visit_rate: 0,
    min_guaranteed: 0,
  },
  {
    id: 3,
    doctor_id: 2,
    effective_from: "2026-01-01",
    fixed_salary: 0,
    percent: 25,
    percent_base: "paid",
    deduct_materials: true,
    category_rates: [],
    visit_rate: 0,
    min_guaranteed: 0,
  },
  {
    id: 4,
    doctor_id: 3,
    effective_from: "2026-01-01",
    fixed_salary: 150000,
    percent: 0,
    percent_base: "price",
    deduct_materials: false,
    category_rates: [],
    visit_rate: 2000,
    min_guaranteed: 200000,
  },
  {
    id: 5,
    sales_id: 10,
    effective_from: "2026-07-01",
    fixed_salary: 100000,
    percent: 5,
    percent_base: "price",
    deduct_materials: false,
    category_rates: [],
    visit_rate: 0,
    min_guaranteed: 0,
  },
];

const input = (extra: Partial<PayrollInput> = {}): PayrollInput => ({
  month: "2026-08-01",
  timeZone: "Asia/Almaty",
  today: "2026-09-29",
  doctors,
  sales,
  schemes,
  adjustments: [],
  plans: [
    plan(1, 1, 1, { discount_percent: 10 }),
    plan(2, 2, 2),
    plan(3, 1, 1),
  ],
  stages: [
    stage(11, 1, 1),
    stage(12, 1, 2, { status: "new", deadline: "2026-08-14" }),
    stage(21, 2, 1, { doctor_id: 2 }),
    stage(31, 3, 1),
  ],
  items: [
    item(1, 11, 200, "Пломба 2", 2, 30000, "2026-08-10T06:00:00Z"),
    item(1, 11, 200, "Пломба 1", 1, 30000, "2026-08-20T06:00:00Z"),
    // 1 September 00:30 in Almaty: not August
    item(1, 11, 200, "Пломба сентябрь", 1, 30000, "2026-08-31T19:30:00Z"),
    item(2, 21, 201, "Коронка 2", 1, 100000, "2026-08-12T06:00:00Z"),
    item(3, 31, 201, "Коронка 3", 1, 100000, "2026-08-25T06:00:00Z", {
      doctor_id: 2,
    }),
  ],
  services,
  categories,
  costs,
  visits: [
    visit(1, 1, "2026-08-11T05:00:00Z", "completed", 202),
    visit(2, 3, "2026-08-03T05:00:00Z", "completed"),
    visit(3, 3, "2026-08-04T05:00:00Z", "completed"),
    visit(4, 3, "2026-08-05T05:00:00Z", "completed"),
    visit(5, 3, "2026-08-06T05:00:00Z", "cancelled"),
  ],
  operations: [
    op(1, {
      deal_id: 2,
      plan_id: 2,
      paid_delta: 60000,
      occurred_at: "2026-08-12T07:00:00Z",
    }),
    op(2, {
      deal_id: 2,
      plan_id: 2,
      paid_delta: -10000,
      occurred_at: "2026-08-20T07:00:00Z",
    }),
  ],
  deals: [
    { id: 1, name: "d1", sales_id: 10 },
    { id: 2, name: "d2", sales_id: 10 },
  ],
  patients: [
    { id: 1, first_name: "Асель", last_name: "Нурланова" },
    { id: 2, first_name: "Ерлан", last_name: "Омаров" },
    { id: 3, first_name: "Дана", last_name: "Ким" },
  ],
  exceptions: [
    {
      id: 1,
      doctor_id: 1,
      day: "2026-08-05",
      start_time: null,
      end_time: null,
    },
    {
      id: 2,
      doctor_id: 1,
      day: "2026-08-08",
      start_time: "10:00",
      end_time: "14:00",
    },
  ],
  ...extra,
});

const employee = (month: ReturnType<typeof buildPayrollMonth>, name: string) =>
  month.employees.find((row) => row.name === name)!;
const line = (
  month: ReturnType<typeof buildPayrollMonth>,
  name: string,
  service: string,
) => employee(month, name).lines.find((row) => row.service_name === service);

describe("rounding", () => {
  it("rounds half away from zero like PostgreSQL", () => {
    expect(roundDiv(5n, 2n)).toBe(3);
    expect(roundDiv(-5n, 2n)).toBe(-3);
    expect(roundDiv(4n, 3n)).toBe(1);
    expect(roundDiv(1n, 0n)).toBe(0);
    expect(mulDiv(-10000, 5, 100)).toBe(-500);
    expect(mulDiv(333, 12.5, 100)).toBe(42);
  });
});

describe("schemes", () => {
  it("takes the scheme effective on the day", () => {
    expect(schemeAt(schemes, { doctor_id: 1 }, "2026-08-14")?.id).toBe(1);
    expect(schemeAt(schemes, { doctor_id: 1 }, "2026-08-15")?.id).toBe(2);
    expect(schemeAt(schemes, { doctor_id: 1 }, "2025-12-31")).toBeNull();
    expect(schemeAt(schemes, { sales_id: 10 }, "2026-08-01")?.id).toBe(5);
  });
  it("prefers the subsection's rate, then the section's, then the default", () => {
    expect(percentFor(schemes[1], 102, 100)).toBe(35);
    expect(percentFor(schemes[0], 102, 100)).toBe(30);
    expect(percentFor(schemes[0], 101, null)).toBe(20);
    expect(percentFor(schemes[0], null, null)).toBe(20);
  });
  it("checks a scheme like the database", () => {
    const ok = { ...schemes[0] };
    expect(schemeError(ok)).toBeNull();
    expect(schemeError({ ...ok, percent: 120 })).toBe("percent");
    expect(schemeError({ ...ok, fixed_salary: -1 })).toBe("fixed_salary");
    expect(
      schemeError({
        ...ok,
        category_rates: [
          { category_id: 1, percent: 10 },
          { category_id: 1, percent: 20 },
        ],
      }),
    ).toBe("duplicate");
    expect(
      schemeError({
        ...ok,
        category_rates: [{ category_id: 1, percent: 101 }],
      }),
    ).toBe("rate");
  });
});

describe("line money", () => {
  it("deducts the materials and takes the paid share", () => {
    expect(
      lineMoney({
        amount: 100000,
        cost: 20000,
        percent: 25,
        deductMaterials: true,
        paidMode: true,
        paid: 50000,
        due: 100000,
      }),
    ).toEqual({ materials: 20000, base: 40000, accrued: 10000 });
    expect(
      lineMoney({
        amount: 10000,
        cost: 20000,
        percent: 25,
        deductMaterials: true,
        paidMode: false,
        paid: 0,
        due: 0,
      }),
    ).toEqual({ materials: 20000, base: 0, accrued: 0 });
    // Overpaid: the whole net amount
    expect(
      lineMoney({
        amount: 100000,
        cost: 0,
        percent: 10,
        deductMaterials: false,
        paidMode: true,
        paid: 150000,
        due: 100000,
      }).base,
    ).toBe(100000);
  });
});

describe("a month of payroll (the numbers of the SQL test)", () => {
  const month = buildPayrollMonth(input());

  it("accrues the therapist: section rate, then the new scheme, the visit", () => {
    expect(line(month, "Терапевт", "Пломба 2")).toMatchObject({
      amount: 54000,
      base: 54000,
      percent: 30,
      accrued: 16200,
      work_day: "2026-08-10",
      category_name: "Терапия",
      patient_name: "Нурланова Асель",
    });
    expect(line(month, "Терапевт", "Пломба 1")).toMatchObject({
      amount: 27000,
      percent: 35,
      accrued: 9450,
    });
    expect(line(month, "Терапевт", "Консультация")).toMatchObject({
      source: "visit",
      amount: 10000,
      percent: 20,
      accrued: 2000,
    });
    expect(line(month, "Терапевт", "Пломба сентябрь")).toBeUndefined();
    expect(employee(month, "Терапевт")).toMatchObject({
      works_count: 3,
      work_amount: 91000,
      work_accrued: 27650,
      accrued: 27650,
      balance: 27650,
    });
    expect(employee(month, "Терапевт").scheme?.id).toBe(2);
  });

  it("pays the orthopedist of the paid part minus materials; the item's doctor wins", () => {
    expect(line(month, "Ортопед", "Коронка 2")).toMatchObject({
      amount: 100000,
      materials: 20000,
      base: 40000,
      accrued: 10000,
    });
    expect(line(month, "Ортопед", "Коронка 3")).toMatchObject({
      base: 0,
      accrued: 0,
    });
    expect(employee(month, "Ортопед")).toMatchObject({
      works_count: 2,
      materials: 40000,
      accrued: 10000,
    });
  });

  it("tops the hygienist up to the minimum", () => {
    expect(employee(month, "Гигиенист")).toMatchObject({
      visits_count: 3,
      visits_accrued: 6000,
      fixed: 150000,
      minimum: 44000,
      accrued: 200000,
    });
  });

  it("gives the administrator her salary and 5 % of the payments", () => {
    const admin = employee(month, "m1 Test");
    expect(admin).toMatchObject({
      kind: "sales",
      work_amount: 50000,
      work_accrued: 2500,
      fixed: 100000,
      accrued: 102500,
    });
    expect(admin.lines.filter((row) => row.source === "payment")).toHaveLength(
      2,
    );
    expect(month.employees.find((row) => row.name === "head Test")).toBeFalsy();
  });

  it("draws the calendar: days off, overdue deadlines, works per day", () => {
    const therapist = employee(month, "Терапевт");
    expect(therapist.days).toHaveLength(31);
    expect(therapist.days_off).toBe(10);
    expect(therapist.overdue_count).toBe(1);
    const day = (key: string) => therapist.days.find((row) => row.day === key)!;
    expect(day("2026-08-10")).toMatchObject({
      works: 1,
      amount: 16200,
      off: false,
    });
    expect(day("2026-08-05").off).toBe(true);
    expect(day("2026-08-08").off).toBe(false);
    expect(day("2026-08-14").overdue).toBe(1);
    expect(employee(month, "Ортопед").days_off).toBe(0);
  });

  it("adds bonuses, penalties and payouts", () => {
    const adjustments: PayrollAdjustment[] = [
      {
        id: 1,
        doctor_id: 1,
        month: "2026-08-01",
        kind: "bonus",
        amount: 5000,
        occurred_on: "2026-08-17",
      },
      {
        id: 2,
        doctor_id: 1,
        month: "2026-08-01",
        kind: "penalty",
        amount: 1000,
        occurred_on: "2026-08-17",
      },
      {
        id: 3,
        doctor_id: 1,
        month: "2026-08-01",
        kind: "payout",
        amount: 20000,
        occurred_on: "2026-08-20",
      },
      {
        id: 4,
        doctor_id: 1,
        month: "2026-07-01",
        kind: "payout",
        amount: 99000,
        occurred_on: "2026-07-20",
      },
    ];
    const therapist = employee(
      buildPayrollMonth(input({ adjustments })),
      "Терапевт",
    );
    expect(therapist).toMatchObject({
      bonuses: 5000,
      penalties: 1000,
      paid_out: 20000,
      accrued: 31650,
      balance: 11650,
    });
    expect(therapist.adjustments).toHaveLength(3);
  });

  it("keeps the frozen lines of a closed month", () => {
    const closedLines = computePayrollLines(input());
    const later = input({
      closing: {
        id: 1,
        month: "2026-08-01",
        closed_at: "2026-09-01T00:00:00Z",
      },
      closedLines,
      operations: [
        ...input().operations,
        op(3, {
          deal_id: 1,
          plan_id: 3,
          paid_delta: 100000,
          occurred_at: "2026-08-26T07:00:00Z",
        }),
      ],
    });
    const frozen = buildPayrollMonth(later);
    expect(frozen.closed).toBe(true);
    expect(line(frozen, "Ортопед", "Коронка 3")?.accrued).toBe(0);
    const reopened = buildPayrollMonth({ ...later, closing: null });
    expect(line(reopened, "Ортопед", "Коронка 3")?.accrued).toBe(20000);
    expect(line(reopened, "Ортопед", "Коронка 2")?.accrued).toBe(10000);
  });
});

describe("the page", () => {
  it("knows the days of a month", () => {
    expect(monthDays("2026-02-10")).toHaveLength(28);
    expect(nextMonth("2026-12-01")).toBe("2027-01-01");
    expect(previousMonth("2026-01-01")).toBe("2025-12-01");
    expect(monthLabel("2026-09-01")).toBe("Сентябрь 2026");
  });
  it("colours the busiest days pinker", () => {
    expect(heatLevel(0, 5)).toBe(0);
    expect(heatLevel(1, 5)).toBe(1);
    expect(heatLevel(5, 5)).toBe(4);
    expect(heatLevel(3, 4)).toBe(3);
  });
  it("lists the largest works first", () => {
    const month = buildPayrollMonth(input());
    expect(
      topLines(employee(month, "Терапевт").lines, 2).map(
        (row) => row.service_name,
      ),
    ).toEqual(["Пломба 2", "Пломба 1"]);
  });
  it("tells a day off", () => {
    expect(isDayOff(doctors[0], "2026-08-01", [])).toBe(true);
    expect(isDayOff(doctors[0], "2026-08-03", [])).toBe(false);
    expect(isDayOff(doctors[1], "2026-08-01", [])).toBe(false);
  });
});
