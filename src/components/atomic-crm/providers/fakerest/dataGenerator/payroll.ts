import type { Identifier } from "ra-core";

import {
  computePayrollLines,
  monthStart,
  previousMonth,
  type PayrollInput,
} from "../../../payroll/payrollMath";
import type {
  CategoryRate,
  PayrollAdjustment,
  PayrollScheme,
} from "../../../payroll/types";
import { addDays, dayKeyOf, zonedMoment } from "../../../tasks/calendarLayout";
import type { Db } from "./types";

const TZ = "Asia/Almaty";

/**
 * Payroll of the demo clinic (stage 39): a scheme per doctor (the history of
 * the therapist: 22 %, then 25 % with «Терапия» 30 %), the implantologist
 * and the orthopedist minus materials, the orthodontist with a salary and a
 * percent of the paid part, the children's doctor with a rate per visit and
 * a minimum; the administrator with a salary and 1 % of her deals'
 * payments. This month: a bonus, a penalty and advances; last month closed
 * and paid out. Runs last: the plans, visits and payments are there.
 */
export const generatePayroll = (db: Db) => {
  const today = dayKeyOf(new Date(), TZ);
  const thisMonth = monthStart(today);
  const lastMonth = previousMonth(thisMonth);

  // Done items dated after today (plans of the last weeks): done this month
  const now = Date.now();
  let shift = 0;
  for (const item of db.treatment_plan_items) {
    if (item.done && item.done_at && new Date(item.done_at).getTime() > now) {
      const day = addDays(today, -(shift++ % 5));
      const moment = zonedMoment(
        day < thisMonth ? thisMonth : day,
        9 * 60 + (shift % 4) * 45,
        TZ,
      ).getTime();
      // Earlier today when that hour is still to come
      item.done_at = new Date(
        Math.min(moment, now - shift * 10 * 60 * 1000),
      ).toISOString();
    }
  }

  const section = (name: string) =>
    db.service_categories.find(
      (row) => row.parent_id == null && row.name === name,
    )?.id;
  const rates = (pairs: [string, number][]): CategoryRate[] =>
    pairs.flatMap(([name, percent]) => {
      const id = section(name);
      return id != null ? [{ category_id: id, percent }] : [];
    });
  const doctor = (specialty: string) =>
    db.doctors.find((row) => row.specialty === specialty)?.id;
  const monthsAgo = (count: number) => {
    let month = thisMonth;
    for (let i = 0; i < count; i++) month = previousMonth(month);
    return month;
  };

  const base = {
    fixed_salary: 0,
    percent: 0,
    percent_base: "price" as const,
    deduct_materials: false,
    category_rates: [] as CategoryRate[],
    visit_rate: 0,
    min_guaranteed: 0,
    note: null,
  };
  const schemes: Omit<PayrollScheme, "id">[] = [];
  const add = (
    person: { doctor_id?: Identifier; sales_id?: Identifier },
    effectiveFrom: string,
    scheme: Partial<PayrollScheme>,
  ) => {
    if (person.doctor_id == null && person.sales_id == null) return;
    schemes.push({
      ...base,
      doctor_id: person.doctor_id ?? null,
      sales_id: person.sales_id ?? null,
      effective_from: effectiveFrom,
      created_at: `${effectiveFrom}T09:00:00+05:00`,
      updated_at: `${effectiveFrom}T09:00:00+05:00`,
      ...scheme,
    });
  };
  add({ doctor_id: doctor("терапевт") }, monthsAgo(12), {
    percent: 22,
    note: "Схема до пересмотра",
  });
  add({ doctor_id: doctor("терапевт") }, monthsAgo(3), {
    percent: 25,
    category_rates: rates([
      ["Терапия", 30],
      ["Гигиена", 20],
    ]),
  });
  add({ doctor_id: doctor("хирург-имплантолог") }, monthsAgo(6), {
    percent: 20,
    deduct_materials: true,
    category_rates: rates([
      ["Имплантация", 18],
      ["Хирургия", 25],
    ]),
  });
  add({ doctor_id: doctor("ортодонт") }, monthsAgo(6), {
    fixed_salary: 150000,
    percent: 15,
    percent_base: "paid",
  });
  add({ doctor_id: doctor("ортопед") }, monthsAgo(6), {
    percent: 25,
    deduct_materials: true,
    category_rates: rates([["Ортопедия", 27]]),
  });
  add({ doctor_id: doctor("детский стоматолог") }, monthsAgo(6), {
    percent: 30,
    visit_rate: 1500,
    min_guaranteed: 250000,
  });
  const administrator = db.sales.find((row) => row.role === "manager");
  add({ sales_id: administrator?.id }, monthsAgo(6), {
    fixed_salary: 180000,
    percent: 1,
    note: "Администратор: оклад и 1 % оплат её сделок",
  });
  db.payroll_schemes = schemes.map((scheme, index) => ({
    ...scheme,
    id: index + 1,
  }));

  const owner = db.sales.find((row) => row.role === "owner")?.id ?? null;
  const adjustments: Omit<PayrollAdjustment, "id">[] = [];
  const adjust = (
    person: Identifier | undefined,
    month: string,
    kind: PayrollAdjustment["kind"],
    amount: number,
    occurredOn: string,
    note: string,
  ) => {
    if (person == null) return;
    adjustments.push({
      doctor_id: person,
      sales_id: null,
      month,
      kind,
      amount,
      note,
      occurred_on: occurredOn,
      created_by: owner,
      created_at: `${occurredOn}T12:00:00+05:00`,
    });
  };
  const advanceDay =
    addDays(thisMonth, 14) < today ? addDays(thisMonth, 14) : today;
  adjust(
    doctor("терапевт"),
    thisMonth,
    "bonus",
    20000,
    today,
    "Отзывы пациентов",
  );
  adjust(
    doctor("ортопед"),
    thisMonth,
    "penalty",
    5000,
    today,
    "Опоздание на приём",
  );
  adjust(doctor("терапевт"), thisMonth, "payout", 50000, advanceDay, "Аванс");
  adjust(
    doctor("хирург-имплантолог"),
    thisMonth,
    "payout",
    50000,
    advanceDay,
    "Аванс",
  );

  // Last month: closed, every accrual paid out on the 5th
  const input: PayrollInput = {
    month: lastMonth,
    timeZone: TZ,
    today,
    doctors: db.doctors,
    sales: db.sales,
    schemes: db.payroll_schemes,
    adjustments: [],
    plans: db.treatment_plans,
    stages: db.treatment_stages,
    items: db.treatment_plan_items,
    services: db.services,
    categories: db.service_categories,
    costs: db.service_costs,
    visits: db.visits,
    operations: db.account_operations,
    deals: db.deals,
    patients: db.patients,
    exceptions: db.doctor_exceptions,
  };
  const lines = computePayrollLines(input);
  db.payroll_months = [
    {
      id: 1,
      month: lastMonth,
      closed_at: `${addDays(thisMonth, 1)}T10:00:00+05:00`,
      closed_by: owner,
    },
  ];
  db.payroll_closed_lines = lines.map((line, index) => ({
    ...line,
    id: index + 1,
    month: lastMonth,
  }));
  const accrued = new Map<
    string,
    { person: Identifier; sales: boolean; sum: number }
  >();
  for (const line of lines) {
    const key =
      line.doctor_id != null ? `d${line.doctor_id}` : `s${line.sales_id}`;
    const row = accrued.get(key) ?? {
      person: (line.doctor_id ?? line.sales_id)!,
      sales: line.doctor_id == null,
      sum: 0,
    };
    row.sum += line.accrued;
    accrued.set(key, row);
  }
  const payday = addDays(thisMonth, 4) < today ? addDays(thisMonth, 4) : today;
  for (const row of accrued.values()) {
    if (row.sum <= 0) continue;
    adjustments.push({
      doctor_id: row.sales ? null : row.person,
      sales_id: row.sales ? row.person : null,
      month: lastMonth,
      kind: "payout",
      amount: row.sum,
      note: "Зарплата",
      occurred_on: payday,
      created_by: owner,
      created_at: `${payday}T12:00:00+05:00`,
    });
  }
  db.payroll_adjustments = adjustments.map((row, index) => ({
    ...row,
    id: index + 1,
  }));
};
