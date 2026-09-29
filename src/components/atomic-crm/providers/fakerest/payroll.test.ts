import { beforeAll, describe, expect, it } from "vitest";

import { monthStart, previousMonth } from "../../payroll/payrollMath";
import type { PayrollAdjustment, PayrollScheme } from "../../payroll/types";
import { todayKey } from "../../tasks/calendarLayout";
import type { AuditLogEntry, Sale } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
}, 120_000);

const setup = () => {
  const db = generateData();
  let current: Sale = db.sales.find((sale) => sale.role === "owner")!;
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({
        id: current.id,
        fullName: current.first_name,
      }),
    },
  }) as CrmDataProvider;
  const loginAs = (role: Sale["role"]) => {
    current = db.sales.find((sale) => sale.role === role && !sale.disabled)!;
    return current;
  };
  return { db, dataProvider, loginAs };
};

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

const thisMonth = () => monthStart(todayKey("Asia/Almaty"));

describe("demo payroll", () => {
  it("gives every doctor a scheme and a month of work", async () => {
    const { db, dataProvider } = setup();
    expect(db.payroll_schemes.length).toBeGreaterThanOrEqual(6);
    for (const doctor of db.doctors) {
      expect(
        db.payroll_schemes.some((scheme) => scheme.doctor_id === doctor.id),
      ).toBe(true);
    }
    // No work is done in the future
    const now = Date.now();
    for (const item of db.treatment_plan_items) {
      if (item.done_at) {
        expect(new Date(item.done_at).getTime()).toBeLessThanOrEqual(now);
      }
    }
    const month = await dataProvider.getPayrollMonth(thisMonth());
    expect(month.closed).toBe(false);
    expect(month.employees.filter((row) => row.kind === "doctor")).toHaveLength(
      db.doctors.length,
    );
    expect(month.employees.some((row) => row.kind === "sales")).toBe(true);
    const works = month.employees.reduce(
      (sum, row) => sum + row.works_count,
      0,
    );
    expect(works).toBeGreaterThan(5);
    for (const employee of month.employees) {
      expect(employee.accrued).toBe(
        employee.lines.reduce((sum, line) => sum + line.accrued, 0) +
          employee.bonuses -
          employee.penalties,
      );
      expect(employee.balance).toBe(employee.accrued - employee.paid_out);
    }
    // The children's doctor is topped up to her minimum
    const kids = month.employees.find(
      (row) => row.specialty === "детский стоматолог",
    )!;
    expect(kids.accrued - kids.bonuses + kids.penalties).toBeGreaterThanOrEqual(
      250000,
    );
    // Days off from the weekly hours of the schedule
    expect(month.employees[0].days_off).toBeGreaterThan(0);
  });

  it("shows last month closed and paid out", async () => {
    const { dataProvider } = setup();
    const month = await dataProvider.getPayrollMonth(
      previousMonth(thisMonth()),
    );
    expect(month.closed).toBe(true);
    for (const employee of month.employees) {
      if (employee.accrued > 0) expect(employee.balance).toBe(0);
    }
  });

  it("keeps the payroll for the owner and the head", async () => {
    const { dataProvider, loginAs } = setup();
    loginAs("manager");
    await expect(dataProvider.getPayrollMonth(thisMonth())).rejects.toThrow();
    await expect(list(dataProvider, "payroll_schemes")).rejects.toThrow();
    await expect(
      dataProvider.create("payroll_adjustments", {
        data: { doctor_id: 1, month: thisMonth(), kind: "bonus", amount: 1000 },
      }),
    ).rejects.toThrow();
    await expect(dataProvider.closePayrollMonth(thisMonth())).rejects.toThrow();
  });

  it("checks the schemes and logs them", async () => {
    const { db, dataProvider } = setup();
    const doctor = db.doctors[0];
    await expect(
      dataProvider.create("payroll_schemes", {
        data: {
          doctor_id: doctor.id,
          effective_from: "2026-01-02",
          percent: 120,
        },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.create("payroll_schemes", {
        data: {
          doctor_id: doctor.id,
          effective_from: "2026-01-02",
          category_rates: [{ category_id: 99999, percent: 10 }],
        },
      }),
    ).rejects.toThrow();
    const existing = db.payroll_schemes.find(
      (scheme) => scheme.doctor_id === doctor.id,
    )!;
    await expect(
      dataProvider.create("payroll_schemes", {
        data: { doctor_id: doctor.id, effective_from: existing.effective_from },
      }),
    ).rejects.toThrow();
    const { data } = await dataProvider.create<PayrollScheme>(
      "payroll_schemes",
      {
        data: {
          doctor_id: doctor.id,
          effective_from: "2020-01-01",
          percent: 10,
        } as Partial<PayrollScheme>,
      },
    );
    expect(data.percent_base).toBe("price");
    const audit = await list<AuditLogEntry>(dataProvider, "audit_log");
    expect(
      audit.some(
        (row) => row.entity === "payroll_scheme" && row.entity_id === data.id,
      ),
    ).toBe(true);
  });

  it("freezes a closed month: no bonus, payouts still", async () => {
    const { db, dataProvider } = setup();
    const month = thisMonth();
    const before = await dataProvider.getPayrollMonth(month);
    await dataProvider.closePayrollMonth(month);
    await expect(dataProvider.closePayrollMonth(month)).rejects.toThrow();
    const doctor = db.doctors[0];
    await expect(
      dataProvider.create("payroll_adjustments", {
        data: { doctor_id: doctor.id, month, kind: "bonus", amount: 1000 },
      }),
    ).rejects.toThrow();
    const scheme = db.payroll_schemes.find(
      (row) => row.doctor_id === doctor.id && row.percent === 25,
    )!;
    await dataProvider.update("payroll_schemes", {
      id: scheme.id,
      data: { percent: 90 },
      previousData: scheme,
    });
    const frozen = await dataProvider.getPayrollMonth(month);
    expect(frozen.closed).toBe(true);
    expect(frozen.employees[0].accrued).toBe(before.employees[0].accrued);
    await dataProvider.create<PayrollAdjustment>("payroll_adjustments", {
      data: {
        doctor_id: doctor.id,
        month,
        kind: "payout",
        amount: 1000,
      } as Partial<PayrollAdjustment>,
    });
    expect(
      (await dataProvider.getPayrollMonth(month)).employees[0].paid_out,
    ).toBe(before.employees[0].paid_out + 1000);
    await dataProvider.reopenPayrollMonth(month);
    const reopened = await dataProvider.getPayrollMonth(month);
    expect(reopened.closed).toBe(false);
  });
});
