import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import type { AccountOperation } from "../../payments/types";
import {
  buildPayrollMonth,
  computePayrollLines,
  monthStart,
  schemeError,
} from "../../payroll/payrollMath";
import type {
  PayrollAdjustment,
  PayrollClosedLine,
  PayrollMonth,
  PayrollMonthRow,
  PayrollScheme,
} from "../../payroll/types";
import type { ServiceCategory } from "../../price-list/types";
import type { DoctorException, Visit } from "../../schedule/types";
import { todayKey } from "../../tasks/calendarLayout";
import type {
  TreatmentPlan,
  TreatmentPlanItem,
  TreatmentStage,
} from "../../treatment/types";
import type {
  AuditLogEntry,
  Deal,
  Doctor,
  Organization,
  Patient,
  Sale,
  Service,
} from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

const SCHEME_AUDITED = [
  "doctor_id",
  "sales_id",
  "effective_from",
  "fixed_salary",
  "percent",
  "percent_base",
  "deduct_materials",
  "category_rates",
  "visit_rate",
  "min_guaranteed",
  "note",
] as const;
const ADJUSTMENT_AUDITED = [
  "doctor_id",
  "sales_id",
  "month",
  "kind",
  "amount",
  "note",
  "occurred_on",
] as const;

const diff = (
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[],
) => {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of fields) {
    let a = before?.[field] ?? null;
    let b = after?.[field] ?? null;
    if (!before && JSON.stringify(b) === "[]") b = null;
    if (!after && JSON.stringify(a) === "[]") a = null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
};

/**
 * «Зарплаты» of the demo (stage 39): the same rules as
 * supabase/schemas/39_payroll.sql — the owner and the head only, the
 * schemes checked (rates of the clinic's categories, one scheme per person
 * and date), the month computed by payroll/payrollMath.ts, closing freezes
 * the lines, bonuses and penalties of a closed month do not change, the
 * owner reopens a month, everything in the audit log.
 */
export const createPayrollDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  logAudit,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
}) => {
  const myRole = async () => {
    const id = await currentSalesId();
    // The demo's default user (no staff row) is the owner
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, id))?.role ??
      "owner"
    );
  };
  const checkAccess = async () => {
    if (!["owner", "head"].includes(await myRole())) {
      throw fail("Зарплаты видят только владелец и руководитель", "42501");
    }
  };
  const timeZone = async () =>
    (await all<Organization>("organizations"))[0]?.timezone || "Asia/Almaty";
  const closings = () => all<PayrollMonthRow>("payroll_months");
  const closingOf = async (month: string) =>
    (await closings()).find((row) => row.month === monthStart(month)) ?? null;

  const inputFor = async (month: string) => {
    const tz = await timeZone();
    const [
      doctors,
      sales,
      schemes,
      adjustments,
      plans,
      stages,
      items,
      services,
      categories,
      costs,
      visits,
      operations,
      deals,
      patients,
      exceptions,
    ] = await Promise.all([
      all<Doctor>("doctors"),
      all<Sale>("sales"),
      all<PayrollScheme>("payroll_schemes"),
      all<PayrollAdjustment>("payroll_adjustments"),
      all<TreatmentPlan>("treatment_plans"),
      all<TreatmentStage>("treatment_stages"),
      all<TreatmentPlanItem>("treatment_plan_items"),
      all<Service>("services"),
      all<ServiceCategory>("service_categories"),
      all<{ service_id: Identifier; cost_price: number }>("service_costs"),
      all<Visit>("visits"),
      all<AccountOperation>("account_operations"),
      all<Deal>("deals"),
      all<Patient>("patients"),
      all<DoctorException>("doctor_exceptions"),
    ]);
    return {
      month,
      timeZone: tz,
      today: todayKey(tz),
      doctors,
      sales,
      schemes,
      adjustments,
      plans,
      stages,
      items,
      services,
      categories,
      costs,
      visits,
      operations,
      deals,
      patients,
      exceptions,
    };
  };

  const checkScheme = async (
    data: Partial<PayrollScheme>,
    id?: Identifier,
  ): Promise<Partial<PayrollScheme>> => {
    const scheme = {
      fixed_salary: 0,
      percent: 0,
      percent_base: "price" as const,
      deduct_materials: false,
      category_rates: [],
      visit_rate: 0,
      min_guaranteed: 0,
      effective_from: todayKey(await timeZone()),
      ...data,
    };
    if ((scheme.doctor_id == null) === (scheme.sales_id == null)) {
      throw fail("Схема — для врача или для сотрудника", "23514");
    }
    if (!["price", "paid"].includes(scheme.percent_base)) {
      throw fail("Процент — от цены или от оплаты", "23514");
    }
    const error = schemeError(scheme as PayrollScheme);
    if (error) {
      throw fail(
        error === "duplicate"
          ? "Процент для раздела указан дважды"
          : "Проверьте суммы и проценты схемы",
        error === "percent" ? "23514" : "22023",
      );
    }
    const categories = await all<ServiceCategory>("service_categories");
    for (const rate of scheme.category_rates ?? []) {
      if (!categories.some((row) => same(row.id, rate.category_id))) {
        throw fail("Раздел прайса не найден");
      }
    }
    const others = (await all<PayrollScheme>("payroll_schemes")).filter(
      (row) => !same(row.id, id),
    );
    if (
      others.some(
        (row) =>
          row.effective_from === scheme.effective_from &&
          (scheme.doctor_id != null
            ? same(row.doctor_id, scheme.doctor_id)
            : same(row.sales_id, scheme.sales_id)),
      )
    ) {
      throw fail("С этой даты у сотрудника уже есть схема", "23505");
    }
    return {
      ...scheme,
      category_rates: (scheme.category_rates ?? []).map((rate) => ({
        category_id: rate.category_id,
        percent: Math.round(Number(rate.percent) * 100) / 100,
      })),
      updated_at: new Date().toISOString(),
    };
  };

  const checkAdjustment = async (
    data: Partial<PayrollAdjustment>,
    previous?: PayrollAdjustment,
  ) => {
    if (
      previous &&
      previous.kind !== "payout" &&
      (await closingOf(previous.month))
    ) {
      throw fail("Месяц закрыт: премии и штрафы не меняются");
    }
    if (!data) return data;
    const row = { ...(previous ?? {}), ...data } as PayrollAdjustment;
    if ((row.doctor_id == null) === (row.sales_id == null)) {
      throw fail("Укажите врача или сотрудника", "23514");
    }
    if (!(Number(row.amount) > 0 && Number(row.amount) <= 1_000_000_000)) {
      throw fail("Сумма должна быть больше нуля", "23514");
    }
    if (!["bonus", "penalty", "payout"].includes(row.kind)) {
      throw fail("Неизвестный вид", "23514");
    }
    const month = monthStart(row.month ?? todayKey(await timeZone()));
    if (row.kind !== "payout" && (await closingOf(month))) {
      throw fail("Месяц закрыт: премии и штрафы не меняются");
    }
    return {
      ...data,
      month,
      occurred_on: row.occurred_on ?? todayKey(await timeZone()),
    };
  };

  const previousRows = new Map<string, unknown>();
  const byId = async <T extends { id: Identifier }>(
    resource: string,
    id: Identifier,
  ) => (await all<T>(resource)).find((row) => same(row.id, id));

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "payroll_schemes",
      beforeGetList: async (params) => {
        await checkAccess();
        return params;
      },
      beforeCreate: async (params) => {
        await checkAccess();
        return { ...params, data: await checkScheme(params.data) };
      },
      afterCreate: async (result) => {
        await logAudit({
          entity: "payroll_scheme",
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, SCHEME_AUDITED),
        });
        return result;
      },
      beforeUpdate: async (params) => {
        await checkAccess();
        const previous = await byId<PayrollScheme>(
          "payroll_schemes",
          params.id,
        );
        if (!previous) throw fail("Схема не найдена", "P0002");
        previousRows.set(`scheme${params.id}`, previous);
        return {
          ...params,
          data: await checkScheme({ ...previous, ...params.data }, params.id),
        };
      },
      afterUpdate: async (result) => {
        const key = `scheme${result.data.id}`;
        const previous = previousRows.get(key) as PayrollScheme | undefined;
        previousRows.delete(key);
        const changes = diff(previous, result.data, SCHEME_AUDITED);
        if (Object.keys(changes).length) {
          await logAudit({
            entity: "payroll_scheme",
            entity_id: result.data.id,
            action: "update",
            changes,
          });
        }
        return result;
      },
      beforeDelete: async (params) => {
        await checkAccess();
        const previous = await byId<PayrollScheme>(
          "payroll_schemes",
          params.id,
        );
        previousRows.set(`scheme${params.id}`, previous);
        return params;
      },
      afterDelete: async (result) => {
        const key = `scheme${result.data?.id}`;
        const previous = previousRows.get(key) as PayrollScheme | undefined;
        previousRows.delete(key);
        if (previous) {
          await logAudit({
            entity: "payroll_scheme",
            entity_id: previous.id,
            action: "delete",
            changes: diff(previous, null, SCHEME_AUDITED),
          });
        }
        return result;
      },
    },
    {
      resource: "payroll_adjustments",
      beforeGetList: async (params) => {
        await checkAccess();
        return params;
      },
      beforeCreate: async (params) => {
        await checkAccess();
        const me = await currentSalesId();
        return {
          ...params,
          data: {
            created_by: me ?? null,
            created_at: new Date().toISOString(),
            ...(await checkAdjustment(params.data)),
          },
        };
      },
      afterCreate: async (result) => {
        await logAudit({
          entity: "payroll_adjustment",
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, ADJUSTMENT_AUDITED),
        });
        return result;
      },
      beforeUpdate: async (params) => {
        await checkAccess();
        const previous = await byId<PayrollAdjustment>(
          "payroll_adjustments",
          params.id,
        );
        if (!previous) throw fail("Запись не найдена", "P0002");
        previousRows.set(`adjustment${params.id}`, previous);
        return {
          ...params,
          data: await checkAdjustment(params.data, previous),
        };
      },
      afterUpdate: async (result) => {
        const key = `adjustment${result.data.id}`;
        const previous = previousRows.get(key) as PayrollAdjustment | undefined;
        previousRows.delete(key);
        const changes = diff(previous, result.data, ADJUSTMENT_AUDITED);
        if (Object.keys(changes).length) {
          await logAudit({
            entity: "payroll_adjustment",
            entity_id: result.data.id,
            action: "update",
            changes,
          });
        }
        return result;
      },
      beforeDelete: async (params) => {
        await checkAccess();
        const previous = await byId<PayrollAdjustment>(
          "payroll_adjustments",
          params.id,
        );
        if (previous) {
          await checkAdjustment(undefined as never, previous);
          previousRows.set(`adjustment${params.id}`, previous);
        }
        return params;
      },
      afterDelete: async (result) => {
        const key = `adjustment${result.data?.id}`;
        const previous = previousRows.get(key) as PayrollAdjustment | undefined;
        previousRows.delete(key);
        if (previous) {
          await logAudit({
            entity: "payroll_adjustment",
            entity_id: previous.id,
            action: "delete",
            changes: diff(previous, null, ADJUSTMENT_AUDITED),
          });
        }
        return result;
      },
    },
  ];

  const methods = {
    /** «Зарплаты» of a month (public.payroll_month) */
    async getPayrollMonth(month: string): Promise<PayrollMonth> {
      await checkAccess();
      const closing = await closingOf(month);
      const closedLines = closing
        ? (await all<PayrollClosedLine>("payroll_closed_lines")).filter(
            (line) => line.month === closing.month,
          )
        : undefined;
      return buildPayrollMonth({
        ...(await inputFor(month)),
        closing,
        closedLines,
      });
    },
    /** «Закрыть месяц» (public.close_payroll_month) */
    async closePayrollMonth(month: string) {
      await checkAccess();
      const start = monthStart(month);
      const tz = await timeZone();
      if (start > monthStart(todayKey(tz))) {
        throw fail("Нельзя закрыть месяц, который ещё не начался");
      }
      if (await closingOf(start)) throw fail("Месяц уже закрыт", "23505");
      const lines = computePayrollLines(await inputFor(start));
      const { data: closing } = await baseDataProvider.create(
        "payroll_months",
        {
          data: {
            month: start,
            closed_at: new Date().toISOString(),
            closed_by: (await currentSalesId()) ?? null,
          },
        },
      );
      for (const line of lines) {
        await baseDataProvider.create("payroll_closed_lines", {
          data: { ...line, month: start },
        });
      }
      await logAudit({
        entity: "payroll_month",
        entity_id: closing.id,
        action: "create",
        changes: {
          month: [null, start],
          closed_at: [null, closing.closed_at],
        },
      });
      return {
        month: start,
        lines: lines.length,
        accrued: lines.reduce((sum, line) => sum + line.accrued, 0),
      };
    },
    /** «Открыть месяц»: the owner only (public.reopen_payroll_month) */
    async reopenPayrollMonth(month: string) {
      if ((await myRole()) !== "owner") {
        throw fail("Открыть закрытый месяц может только владелец", "42501");
      }
      const closing = await closingOf(month);
      if (!closing) throw fail("Месяц не закрыт", "P0002");
      for (const line of await all<PayrollClosedLine>("payroll_closed_lines")) {
        if (line.month === closing.month) {
          await baseDataProvider.delete("payroll_closed_lines", {
            id: line.id,
          });
        }
      }
      await baseDataProvider.delete("payroll_months", { id: closing.id });
      await logAudit({
        entity: "payroll_month",
        entity_id: closing.id,
        action: "delete",
        changes: {
          month: [closing.month, null],
          closed_at: [closing.closed_at, null],
        },
      });
    },
  };

  return { methods, callbacks };
};
