import type { Identifier } from "ra-core";

import type { AccountOperation } from "../payments/types";
import type { ServiceCategory } from "../price-list/types";
import type { DoctorException, Visit, WeeklyHours } from "../schedule/types";
import { addDays, dayKeyOf, weekdayOf } from "../tasks/calendarLayout";
import { planTotal, stageTotal } from "../treatment/planMath";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../treatment/types";
import type { Deal, Doctor, Patient, Sale, Service } from "../types";
import type {
  PayrollAdjustment,
  PayrollDay,
  PayrollEmployee,
  PayrollLine,
  PayrollMonth,
  PayrollMonthRow,
  PayrollScheme,
} from "./types";

/**
 * Payroll of a month (stage 39): the twin of supabase/schemas/39_payroll.sql
 * (private.payroll_compute, public.payroll_month), for the demo and the
 * tests. Whole tenge, rounded half away from zero like round() of
 * PostgreSQL on numeric; BigInt keeps the products exact.
 */

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** round(n / d), half away from zero; 0 when d is 0 */
export const roundDiv = (n: bigint, d: bigint): number => {
  if (d === 0n) return 0;
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (2n * ad);
  return Number(negative ? -q : q);
};

/** A value with up to two decimals, in hundredths */
const cents = (value: number | string | null | undefined) =>
  BigInt(Math.round(Number(value ?? 0) * 100));

const int = (value: number | string | null | undefined) =>
  BigInt(Math.round(Number(value ?? 0)));

/** round(a × b / c) for amounts and percentages with two decimals */
export const mulDiv = (
  a: number | string,
  b: number | string,
  c: number | string,
): number => roundDiv(cents(a) * cents(b), cents(c) * 100n);

/** round(amount × percent / 100) */
export const percentOf = (amount: number, percent: number | string) =>
  mulDiv(amount, percent, 100);

/** YYYY-MM-01 of any day of the month (YYYY-MM or YYYY-MM-DD) */
export const monthStart = (value: string) => `${value.slice(0, 7)}-01`;

/** The first day of the next month */
export const nextMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return m === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(m + 1).padStart(2, "0")}-01`;
};

export const previousMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number);
  return m === 1
    ? `${year - 1}-12-01`
    : `${year}-${String(m - 1).padStart(2, "0")}-01`;
};

/** Every day of the month, YYYY-MM-DD */
export const monthDays = (month: string) => {
  const start = monthStart(month);
  const end = nextMonth(start);
  const days: string[] = [];
  for (let day = start; day < end; day = addDays(day, 1)) days.push(day);
  return days;
};

/** The scheme of a person on a day: the last one effective */
export const schemeAt = (
  schemes: PayrollScheme[],
  person: { doctor_id?: Identifier | null; sales_id?: Identifier | null },
  day: string,
): PayrollScheme | null =>
  schemes
    .filter(
      (scheme) =>
        (person.doctor_id != null
          ? same(scheme.doctor_id, person.doctor_id)
          : scheme.doctor_id == null) &&
        (person.sales_id != null
          ? same(scheme.sales_id, person.sales_id)
          : scheme.sales_id == null) &&
        scheme.effective_from.slice(0, 10) <= day,
    )
    .sort(
      (a, b) =>
        b.effective_from.localeCompare(a.effective_from) ||
        Number(b.id) - Number(a.id),
    )[0] ?? null;

/**
 * The percentage of a scheme for a category: its own rate, else its
 * section's, else the default (private.payroll_percent)
 */
export const percentFor = (
  scheme: Pick<PayrollScheme, "percent" | "category_rates">,
  categoryId: Identifier | null | undefined,
  sectionId: Identifier | null | undefined,
) => {
  const rates = scheme.category_rates ?? [];
  const own = rates.find((rate) => same(rate.category_id, categoryId));
  if (own) return Number(own.percent);
  const section = rates.find((rate) => same(rate.category_id, sectionId));
  if (section) return Number(section.percent);
  return Number(scheme.percent ?? 0);
};

/**
 * A day off of a doctor: an exception without hours, else a weekday missing
 * from the weekly hours; no weekly hours — the clinic hours, every day
 * (private.payroll_day_off)
 */
export const isDayOff = (
  doctor: { id: Identifier; working_hours?: WeeklyHours | null },
  day: string,
  exceptions: DoctorException[],
) => {
  const exception = exceptions.find(
    (row) => same(row.doctor_id, doctor.id) && row.day.slice(0, 10) === day,
  );
  if (exception) return !exception.start_time;
  const hours = doctor.working_hours ?? {};
  if (Object.keys(hours).length === 0) return false;
  const weekday = String(weekdayOf(day) + 1) as keyof WeeklyHours;
  return !hours[weekday];
};

/**
 * The money of a line: materials deducted (never below 0), the paid share
 * in the «paid» mode, then the percent
 */
export const lineMoney = ({
  amount,
  cost,
  percent,
  deductMaterials,
  paidMode,
  paid,
  due,
}: {
  amount: number;
  cost: number;
  percent: number;
  deductMaterials: boolean;
  paidMode: boolean;
  /** What the patient paid for the work (the plan, the visit) */
  paid: number;
  /** What the work (all the done work of the plan, the visit) costs */
  due: number;
}) => {
  const materials = deductMaterials ? cost : 0;
  const net = Math.max(0, amount - materials);
  const base =
    paidMode && paid < due
      ? roundDiv(BigInt(net) * BigInt(Math.max(paid, 0)), BigInt(due))
      : net;
  return { materials, base, accrued: percentOf(base, percent) };
};

export type PayrollInput = {
  /** Any day of the month */
  month: string;
  timeZone?: string | null;
  /** Today in the clinic, YYYY-MM-DD (the overdue deadlines) */
  today: string;
  doctors: Doctor[];
  sales: Sale[];
  schemes: PayrollScheme[];
  adjustments: PayrollAdjustment[];
  plans: TreatmentPlan[];
  stages: TreatmentStage[];
  items: (TreatmentPlanItem & { doctor_id?: Identifier | null })[];
  services: Service[];
  categories: ServiceCategory[];
  /** Cost prices by service */
  costs: { service_id: Identifier; cost_price: number }[];
  visits: Visit[];
  operations: AccountOperation[];
  deals: Pick<Deal, "id" | "name" | "sales_id">[];
  patients: Pick<Patient, "id" | "first_name" | "last_name">[];
  exceptions: DoctorException[];
  /** The closing of the month and its frozen lines, when it is closed */
  closing?: PayrollMonthRow | null;
  closedLines?: PayrollLine[];
};

const patientName = (
  patients: PayrollInput["patients"],
  id: Identifier | null | undefined,
) => {
  const patient = patients.find((row) => same(row.id, id));
  const name = [patient?.last_name, patient?.first_name]
    .filter((part) => part != null && part !== "")
    .join(" ")
    .trim();
  return name || null;
};

/** Every line of the month (private.payroll_compute) */
export const computePayrollLines = (input: PayrollInput): PayrollLine[] => {
  const start = monthStart(input.month);
  const end = nextMonth(start);
  const tz = input.timeZone;
  const inMonth = (value: string | null | undefined) => {
    if (!value) return null;
    const day = dayKeyOf(value, tz);
    return day >= start && day < end ? day : null;
  };
  const lines: PayrollLine[] = [];
  const totals = new Map<string, number>();
  const push = (line: PayrollLine) => {
    lines.push(line);
    const key =
      line.doctor_id != null ? `d${line.doctor_id}` : `s${line.sales_id}`;
    totals.set(key, (totals.get(key) ?? 0) + line.accrued);
  };
  const serviceOf = (id: Identifier | null | undefined) =>
    input.services.find((service) => same(service.id, id));
  const categoryOf = (service: Service | undefined) => {
    const category = input.categories.find((row) =>
      same(row.id, service?.category_id),
    );
    const section = input.categories.find((row) =>
      same(row.id, category?.parent_id),
    );
    return {
      categoryId: category?.id ?? null,
      sectionId: category?.parent_id ?? null,
      name: section?.name ?? category?.name ?? null,
    };
  };
  const costOf = (serviceId: Identifier | null | undefined, quantity = 1) => {
    const cost = input.costs.find((row) => same(row.service_id, serviceId));
    return cost ? roundDiv(cents(cost.cost_price) * int(quantity), 100n) : 0;
  };

  // Done plan items
  const planIds = new Set(
    input.items
      .filter((item) => item.done && inMonth(item.done_at))
      .map((item) => String(item.plan_id)),
  );
  const plans = input.plans.filter(
    (plan) => planIds.has(String(plan.id)) && plan.status !== "declined",
  );
  const done: {
    item: TreatmentPlanItem & { doctor_id?: Identifier | null };
    plan: TreatmentPlan;
    doctorId: Identifier | null;
    amount: number;
  }[] = [];
  for (const plan of plans) {
    const stages = input.stages.filter((stage) => same(stage.plan_id, plan.id));
    const items = input.items.filter((item) => same(item.plan_id, plan.id));
    const linesOf = (stageId: Identifier) =>
      items
        .filter((item) => same(item.stage_id, stageId))
        .reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
    const subtotal = stages
      .filter((stage) => stage.status !== "cancelled")
      .reduce(
        (sum, stage) =>
          sum + stageTotal(linesOf(stage.id), stage.discount_percent),
        0,
      );
    const total = planTotal(
      subtotal,
      plan.discount_percent,
      plan.discount_amount,
    );
    for (const item of items) {
      const stage = stages.find((row) => same(row.id, item.stage_id));
      if (!item.done || !item.done_at || !stage || stage.status === "cancelled")
        continue;
      const stageLines = linesOf(stage.id);
      done.push({
        item,
        plan,
        doctorId: item.doctor_id ?? stage.doctor_id ?? plan.doctor_id ?? null,
        amount: roundDiv(
          int(item.line_total) *
            int(stageTotal(stageLines, stage.discount_percent)) *
            int(total),
          int(stageLines) * int(subtotal),
        ),
      });
    }
  }
  const planPaid = (plan: TreatmentPlan) =>
    input.operations
      .filter(
        (op) =>
          same(op.plan_id, plan.id) ||
          (plan.is_main &&
            same(op.deal_id, plan.deal_id) &&
            op.plan_id == null),
      )
      .reduce((sum, op) => sum + Number(op.paid_delta ?? 0), 0);
  const shares = new Map<string, { done: number; paid: number }>();
  for (const plan of plans) {
    shares.set(String(plan.id), {
      done: done
        .filter((row) => same(row.plan.id, plan.id))
        .reduce((sum, row) => sum + row.amount, 0),
      paid: planPaid(plan),
    });
  }
  const monthDone = done
    .filter((row) => row.doctorId != null && inMonth(row.item.done_at))
    .sort(
      (a, b) =>
        new Date(a.item.done_at!).getTime() -
          new Date(b.item.done_at!).getTime() ||
        Number(a.item.id) - Number(b.item.id),
    );
  for (const row of monthDone) {
    const day = inMonth(row.item.done_at)!;
    const scheme = schemeAt(input.schemes, { doctor_id: row.doctorId }, day);
    const service = serviceOf(row.item.service_id);
    const category = categoryOf(service);
    const percent = scheme
      ? percentFor(scheme, category.categoryId, category.sectionId)
      : 0;
    const share = shares.get(String(row.plan.id))!;
    const money = lineMoney({
      amount: row.amount,
      cost: costOf(row.item.service_id, row.item.quantity),
      percent,
      deductMaterials: !!scheme?.deduct_materials,
      paidMode: scheme?.percent_base === "paid",
      paid: share.paid,
      due: share.done,
    });
    push({
      doctor_id: row.doctorId,
      sales_id: null,
      scheme_id: scheme?.id ?? null,
      source: "plan_item",
      source_id: row.item.id,
      work_day: day,
      patient_id: row.plan.patient_id,
      patient_name: patientName(input.patients, row.plan.patient_id),
      service_name: row.item.name,
      category_name: category.name,
      amount: row.amount,
      materials: money.materials,
      base: money.base,
      percent,
      accrued: money.accrued,
    });
  }

  // Completed visits of the CRM with a priced service, deal without a plan
  const byStart = (a: Visit, b: Visit) =>
    new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime() ||
    Number(a.id) - Number(b.id);
  const completed = input.visits
    .filter((visit) => visit.status === "completed" && inMonth(visit.starts_at))
    .sort(byStart);
  for (const visit of completed) {
    const service = serviceOf(visit.service_id);
    if (
      visit.source !== "crm" ||
      visit.doctor_id == null ||
      !service ||
      !(Number(service.price) > 0) ||
      input.plans.some(
        (plan) =>
          same(plan.deal_id, visit.deal_id) && plan.status !== "declined",
      )
    )
      continue;
    const day = inMonth(visit.starts_at)!;
    const scheme = schemeAt(input.schemes, { doctor_id: visit.doctor_id }, day);
    const category = categoryOf(service);
    const percent = scheme
      ? percentFor(scheme, category.categoryId, category.sectionId)
      : 0;
    const price = roundDiv(cents(service.price), 100n);
    const paid = input.operations
      .filter((op) => same(op.visit_id, visit.id))
      .reduce((sum, op) => sum + Number(op.paid_delta ?? 0), 0);
    const money = lineMoney({
      amount: price,
      cost: costOf(service.id),
      percent,
      deductMaterials: !!scheme?.deduct_materials,
      paidMode: scheme?.percent_base === "paid",
      paid,
      due: price,
    });
    push({
      doctor_id: visit.doctor_id,
      sales_id: null,
      scheme_id: scheme?.id ?? null,
      source: "visit",
      source_id: visit.id,
      work_day: day,
      patient_id: visit.patient_id,
      patient_name: patientName(input.patients, visit.patient_id),
      service_name: service.name,
      category_name: category.name,
      amount: price,
      materials: money.materials,
      base: money.base,
      percent,
      accrued: money.accrued,
    });
  }

  // Payments of the deals of an employee (percent of sales)
  const payments = input.operations
    .filter((op) => Number(op.paid_delta ?? 0) !== 0 && inMonth(op.occurred_at))
    .sort(
      (a, b) =>
        new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() ||
        Number(a.id) - Number(b.id),
    );
  for (const op of payments) {
    const deal = input.deals.find((row) => same(row.id, op.deal_id));
    if (!deal || deal.sales_id == null) continue;
    const day = inMonth(op.occurred_at)!;
    const scheme = schemeAt(input.schemes, { sales_id: deal.sales_id }, day);
    if (!scheme || Number(scheme.percent) === 0) continue;
    const amount = Number(op.paid_delta);
    push({
      doctor_id: null,
      sales_id: deal.sales_id,
      scheme_id: scheme.id,
      source: "payment",
      source_id: op.id,
      work_day: day,
      patient_id: op.patient_id,
      patient_name: patientName(input.patients, op.patient_id),
      service_name: deal.name ?? null,
      category_name: null,
      amount,
      materials: 0,
      base: amount,
      percent: Number(scheme.percent),
      accrued: percentOf(amount, scheme.percent),
    });
  }

  // A rate per completed visit: the doctor's, the booking employee's
  for (const visit of completed) {
    const day = inMonth(visit.starts_at)!;
    const people: { doctor_id?: Identifier; sales_id?: Identifier }[] = [];
    if (visit.doctor_id != null) people.push({ doctor_id: visit.doctor_id });
    if (visit.created_by != null) people.push({ sales_id: visit.created_by });
    for (const person of people) {
      const scheme = schemeAt(input.schemes, person, day);
      if (!scheme || !(Number(scheme.visit_rate) > 0)) continue;
      push({
        doctor_id: person.doctor_id ?? null,
        sales_id: person.sales_id ?? null,
        scheme_id: scheme.id,
        source: "visit_rate",
        source_id: visit.id,
        work_day: day,
        patient_id: visit.patient_id,
        patient_name: patientName(input.patients, visit.patient_id),
        service_name: serviceOf(visit.service_id)?.name ?? null,
        category_name: null,
        amount: Number(scheme.visit_rate),
        materials: 0,
        base: Number(scheme.visit_rate),
        percent: null,
        accrued: Number(scheme.visit_rate),
      });
    }
  }

  // The salary and the minimum: the scheme of the last day of the month
  const lastDay = addDays(end, -1);
  const persons = new Map<
    string,
    { doctor_id?: Identifier; sales_id?: Identifier }
  >();
  for (const scheme of input.schemes) {
    if (scheme.effective_from.slice(0, 10) >= end) continue;
    if (scheme.doctor_id != null)
      persons.set(`d${scheme.doctor_id}`, { doctor_id: scheme.doctor_id });
    else if (scheme.sales_id != null)
      persons.set(`s${scheme.sales_id}`, { sales_id: scheme.sales_id });
  }
  for (const [key, person] of persons) {
    const scheme = schemeAt(input.schemes, person, lastDay);
    if (!scheme) continue;
    const base = {
      doctor_id: person.doctor_id ?? null,
      sales_id: person.sales_id ?? null,
      scheme_id: scheme.id,
      source_id: null,
      work_day: null,
      patient_id: null,
      patient_name: null,
      service_name: null,
      category_name: null,
      materials: 0,
      percent: null,
    };
    if (Number(scheme.fixed_salary) > 0) {
      const salary = Number(scheme.fixed_salary);
      push({
        ...base,
        source: "fixed",
        amount: salary,
        base: salary,
        accrued: salary,
      });
    }
    const minimum = Number(scheme.min_guaranteed);
    const total = totals.get(key) ?? 0;
    if (minimum > 0 && total < minimum) {
      push({
        ...base,
        source: "minimum",
        amount: minimum - total,
        base: minimum - total,
        accrued: minimum - total,
      });
    }
  }
  return lines;
};

/** Lines in the order of the page: by day (salary last), source, id */
const compareLines = (a: PayrollLine, b: PayrollLine) => {
  if (a.work_day !== b.work_day) {
    if (a.work_day == null) return 1;
    if (b.work_day == null) return -1;
    return a.work_day < b.work_day ? -1 : 1;
  }
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  return Number(a.source_id ?? 0) - Number(b.source_id ?? 0);
};

const sumOf = (
  lines: PayrollLine[],
  sources: string[] | null,
  field: "amount" | "accrued" | "materials",
) =>
  lines
    .filter((line) => !sources || sources.includes(line.source))
    .reduce((sum, line) => sum + Number(line[field]), 0);

/** «Зарплаты» of a month (public.payroll_month) */
export const buildPayrollMonth = (input: PayrollInput): PayrollMonth => {
  const start = monthStart(input.month);
  const end = nextMonth(start);
  const lastDay = addDays(end, -1);
  const lines =
    input.closing && input.closedLines
      ? input.closedLines
      : computePayrollLines(input);
  const keyOf = (line: {
    doctor_id?: Identifier | null;
    sales_id?: Identifier | null;
  }) => (line.doctor_id != null ? `d${line.doctor_id}` : `s${line.sales_id}`);
  const grouped = new Map<string, PayrollLine[]>();
  for (const line of lines) {
    const key = keyOf(line);
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }
  const adjustmentsOf = (person: {
    doctor_id?: Identifier | null;
    sales_id?: Identifier | null;
  }) =>
    input.adjustments
      .filter(
        (row) =>
          monthStart(row.month) === start &&
          (person.doctor_id != null
            ? same(row.doctor_id, person.doctor_id)
            : row.doctor_id == null) &&
          (person.sales_id != null
            ? same(row.sales_id, person.sales_id)
            : row.sales_id == null),
      )
      .sort(
        (a, b) =>
          a.occurred_on.localeCompare(b.occurred_on) ||
          Number(a.id) - Number(b.id),
      );

  type Person = {
    kind: "doctor" | "sales";
    doctor_id: Identifier | null;
    sales_id: Identifier | null;
    name: string;
    specialty: string | null;
    color: string | null;
    position: number;
    is_active: boolean;
  };
  const people: Person[] = [
    ...input.doctors
      .filter(
        (doctor) =>
          doctor.is_active ||
          grouped.has(`d${doctor.id}`) ||
          adjustmentsOf({ doctor_id: doctor.id }).length > 0,
      )
      .map(
        (doctor): Person => ({
          kind: "doctor",
          doctor_id: doctor.id,
          sales_id: null,
          name: doctor.name,
          specialty: doctor.specialty ?? null,
          color: doctor.color ?? null,
          position: doctor.position ?? 0,
          is_active: doctor.is_active,
        }),
      )
      .sort((a, b) => a.position - b.position || compareText(a.name, b.name)),
    ...input.sales
      .filter(
        (sale) =>
          grouped.has(`s${sale.id}`) ||
          input.schemes.some(
            (scheme) =>
              same(scheme.sales_id, sale.id) &&
              scheme.effective_from.slice(0, 10) < end,
          ) ||
          adjustmentsOf({ sales_id: sale.id }).length > 0,
      )
      .map(
        (sale): Person => ({
          kind: "sales",
          doctor_id: null,
          sales_id: sale.id,
          name: [sale.first_name, sale.last_name].filter(Boolean).join(" "),
          specialty: sale.role ?? null,
          color: null,
          position: 0,
          is_active: !sale.disabled,
        }),
      )
      .sort((a, b) => compareText(a.name, b.name)),
  ];

  const employees = people.map((person): PayrollEmployee => {
    const own = [...(grouped.get(keyOf(person)) ?? [])].sort(compareLines);
    const adjustments = adjustmentsOf(person);
    const adjusted = (kind: string) =>
      adjustments
        .filter((row) => row.kind === kind)
        .reduce((sum, row) => sum + Number(row.amount), 0);
    const bonuses = adjusted("bonus");
    const penalties = adjusted("penalty");
    const payouts = adjusted("payout");
    const linesAccrued = sumOf(own, null, "accrued");
    const days = monthDays(start).map((day): PayrollDay => {
      const ofDay = own.filter((line) => line.work_day === day);
      const doctor =
        person.doctor_id != null
          ? input.doctors.find((row) => same(row.id, person.doctor_id))
          : undefined;
      return {
        day,
        works: ofDay.filter((line) =>
          ["plan_item", "visit"].includes(line.source),
        ).length,
        amount: sumOf(ofDay, null, "accrued"),
        overdue:
          person.doctor_id == null
            ? 0
            : input.stages.filter((stage) => {
                const plan = input.plans.find((row) =>
                  same(row.id, stage.plan_id),
                );
                const deadline = stage.deadline?.slice(0, 10);
                return (
                  !!plan &&
                  deadline === day &&
                  deadline < input.today &&
                  same(stage.doctor_id ?? plan.doctor_id, person.doctor_id) &&
                  !["done", "cancelled"].includes(stage.status) &&
                  plan.status !== "declined"
                );
              }).length,
        off: !!doctor && isDayOff(doctor, day, input.exceptions),
      };
    });
    const accrued = linesAccrued + bonuses - penalties;
    return {
      kind: person.kind,
      doctor_id: person.doctor_id,
      sales_id: person.sales_id,
      name: person.name,
      specialty: person.specialty,
      color: person.color,
      is_active: person.is_active,
      scheme: schemeAt(input.schemes, person, lastDay),
      works_count: own.filter((line) =>
        ["plan_item", "visit"].includes(line.source),
      ).length,
      work_amount: sumOf(own, ["plan_item", "visit", "payment"], "amount"),
      materials: sumOf(own, null, "materials"),
      work_accrued: sumOf(own, ["plan_item", "visit", "payment"], "accrued"),
      visits_count: own.filter((line) => line.source === "visit_rate").length,
      visits_accrued: sumOf(own, ["visit_rate"], "accrued"),
      fixed: sumOf(own, ["fixed"], "accrued"),
      minimum: sumOf(own, ["minimum"], "accrued"),
      bonuses,
      penalties,
      accrued,
      paid_out: payouts,
      balance: accrued - payouts,
      overdue_count: days.reduce((sum, day) => sum + day.overdue, 0),
      days_off: days.filter((day) => day.off).length,
      days,
      lines: own,
      adjustments,
    };
  });
  return {
    month: start,
    closed: !!input.closing,
    closed_at: input.closing?.closed_at ?? null,
    closed_by: input.closing?.closed_by ?? null,
    employees,
  };
};

const compareText = (a: string, b: string) => a.localeCompare(b, "ru");

//
// The page
//

/** 0 (nothing) … 4 (the busiest day of the month) */
export const heatLevel = (works: number, max: number) => {
  if (works <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((works / max) * 4)));
};

/** The largest works of the month, for the card */
export const topLines = (lines: PayrollLine[], count = 4) =>
  lines
    .filter((line) => ["plan_item", "visit", "payment"].includes(line.source))
    .sort((a, b) => b.accrued - a.accrued || b.amount - a.amount)
    .slice(0, count);

/** The month summary of all employees */
export const monthTotals = (month: PayrollMonth) =>
  month.employees.reduce(
    (totals, employee) => ({
      accrued: totals.accrued + employee.accrued,
      paidOut: totals.paidOut + employee.paid_out,
      balance: totals.balance + employee.balance,
      works: totals.works + employee.works_count,
    }),
    { accrued: 0, paidOut: 0, balance: 0, works: 0 },
  );

/** «Сентябрь 2026» */
export const monthLabel = (month: string, locale = "ru-RU") => {
  const [year, m] = month.split("-").map(Number);
  const label = new Date(Date.UTC(year, m - 1, 1)).toLocaleString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1).replace(" г.", "");
};

/** The id of an employee in the address: d12 (doctor) or s3 (employee) */
export const employeeKey = (employee: {
  doctor_id?: Identifier | null;
  sales_id?: Identifier | null;
}) =>
  employee.doctor_id != null
    ? `d${employee.doctor_id}`
    : `s${employee.sales_id}`;

/** Check a scheme before it is saved (the same rules as the database) */
export const schemeError = (
  scheme: Pick<
    PayrollScheme,
    | "percent"
    | "fixed_salary"
    | "visit_rate"
    | "min_guaranteed"
    | "category_rates"
    | "effective_from"
  >,
): string | null => {
  const percent = Number(scheme.percent);
  if (!(percent >= 0 && percent <= 100)) return "percent";
  for (const field of [
    "fixed_salary",
    "visit_rate",
    "min_guaranteed",
  ] as const) {
    const value = Number(scheme[field]);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000)
      return field;
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(scheme.effective_from ?? "")) return "date";
  const seen = new Set<string>();
  for (const rate of scheme.category_rates ?? []) {
    const value = Number(rate.percent);
    if (rate.category_id == null || !(value >= 0 && value <= 100))
      return "rate";
    if (seen.has(String(rate.category_id))) return "duplicate";
    seen.add(String(rate.category_id));
  }
  return null;
};
