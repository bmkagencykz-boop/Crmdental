import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import { monthStart } from "../../lab/labMath";
import type { Lab, LabPayment, LabPaymentMethod } from "../../lab/types";
import type {
  AccountOperation,
  CashExpenseCategory,
  CashShift,
  ExpenseMethod,
} from "../../payments/types";
import type { PayrollAdjustment } from "../../payroll/types";
import type { AuditLogEntry, Doctor, Sale } from "../../types";
import type { CashLinkResult } from "../supabase/cashOutflowMethods";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

const LAB_PAYMENT_AUDITED = [
  "lab_id",
  "month",
  "amount",
  "method",
  "paid_at",
  "comment",
  "account_operation_id",
] as const;

const diff = (
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[],
) => {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
};

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
/** Now when the day is today, else noon of that day (private.cash_moment) */
const momentOf = (day?: string | null) => {
  const now = new Date();
  if (!day || day === dayOf(now)) return now.toISOString();
  return new Date(`${day}T12:00:00`).toISOString();
};
const monthLabel = (month: string) =>
  `${month.slice(5, 7)}.${month.slice(0, 4)}`;

/**
 * Money going out of the cash desk in the demo (stage 42): the same rules
 * as supabase/schemas/42_cash_outflows.sql — the categories of the clinic
 * (the system ones are not deleted), the lab payments (owner and head),
 * «Выдать из кассы» and «Оплатить» writing the expense and linking it, the
 * amount of a linked payout or lab payment locked, deleting one cancels its
 * expense. The expense itself is the payments demo's (payments.ts).
 */
export const createCashOutflowsDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
  logAudit,
  cancelLinkedExpense,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getDataProvider: () => DataProvider;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  cancelLinkedExpense: (opId: Identifier) => Promise<void>;
}) => {
  const myRole = async () => {
    const id = await currentSalesId();
    // The demo's default user (no staff row) is the owner
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, id))?.role ??
      "owner"
    );
  };
  const senior = async () => ["owner", "head"].includes(await myRole());
  const categories = () =>
    all<CashExpenseCategory>("cash_expense_categories");
  const categoryOf = async (code: string) =>
    (await categories()).find((c) => c.code === code);
  const previousRows = new Map<string, unknown>();
  const byId = async <T extends { id: Identifier }>(
    resource: string,
    id: Identifier,
  ) => (await all<T>(resource)).find((row) => same(row.id, id));

  /** A cash expense from the till needs the cashier's open shift */
  const needShift = async (method: string) => {
    if (method !== "cash") return;
    const me = await currentSalesId();
    const open = (await all<CashShift>("cash_shifts")).some(
      (shift) => same(shift.sales_id, me) && !shift.closed_at,
    );
    if (!open) {
      throw fail("Откройте смену кассы, чтобы выдать наличные");
    }
  };

  const writeExpense = async (data: {
    amount: number;
    method: string;
    code: string;
    occurred_at: string;
    comment: string;
  }) => {
    const category = await categoryOf(data.code);
    const { data: op } = await getDataProvider().create<AccountOperation>(
      "account_operations",
      {
        data: {
          kind: "expense",
          amount: data.amount,
          method: data.method as AccountOperation["method"],
          occurred_at: data.occurred_at,
          category_id: category?.id ?? null,
          comment: data.comment.slice(0, 1000),
        },
      },
    );
    return op;
  };

  const lockedChange = (
    previous: Record<string, unknown>,
    next: Record<string, unknown>,
    fields: string[],
  ) =>
    fields.some(
      (field) =>
        field in next &&
        JSON.stringify(next[field] ?? null) !==
          JSON.stringify(previous[field] ?? null),
    );

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "cash_expense_categories",
      afterGetList: async (result: GetListResult) =>
        (await myRole()) === "integrator"
          ? { ...result, data: [], total: 0 }
          : result,
      beforeCreate: async (params) => {
        if (!(await senior())) {
          throw fail("Статьи расходов меняют владелец и руководитель", "42501");
        }
        const name = String(params.data.name ?? "").trim();
        if (!name) throw fail("Укажите название", "23514");
        if (
          (await categories()).some(
            (c) => c.name.toLowerCase() === name.toLowerCase(),
          )
        ) {
          throw fail("Такая статья уже есть", "23505");
        }
        return {
          ...params,
          data: {
            is_active: true,
            position: (await categories()).length,
            ...params.data,
            name,
            code: null,
            created_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result) => {
        await logAudit({
          entity: "cash_expense_category",
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, ["name", "is_active"]),
        });
        return result;
      },
      beforeUpdate: async (params) => {
        if (!(await senior())) {
          throw fail("Статьи расходов меняют владелец и руководитель", "42501");
        }
        const previous = await byId<CashExpenseCategory>(
          "cash_expense_categories",
          params.id,
        );
        if (!previous) throw fail("Статья не найдена", "P0002");
        const data = { ...params.data } as Partial<CashExpenseCategory>;
        if ("code" in data && data.code !== previous.code) {
          throw fail("Код системной статьи не меняется");
        }
        if (data.name !== undefined) {
          const name = String(data.name).trim();
          if (!name) throw fail("Укажите название", "23514");
          if (
            (await categories()).some(
              (c) =>
                !same(c.id, previous.id) &&
                c.name.toLowerCase() === name.toLowerCase(),
            )
          ) {
            throw fail("Такая статья уже есть", "23505");
          }
          data.name = name;
        }
        previousRows.set(`category${params.id}`, previous);
        return { ...params, data };
      },
      afterUpdate: async (result) => {
        const key = `category${result.data.id}`;
        const previous = previousRows.get(key) as
          | CashExpenseCategory
          | undefined;
        previousRows.delete(key);
        const changes = diff(previous, result.data, ["name", "is_active"]);
        if (Object.keys(changes).length) {
          await logAudit({
            entity: "cash_expense_category",
            entity_id: result.data.id,
            action: "update",
            changes,
          });
        }
        return result;
      },
      beforeDelete: async (params) => {
        if (!(await senior())) {
          throw fail("Статьи расходов меняют владелец и руководитель", "42501");
        }
        const previous = await byId<CashExpenseCategory>(
          "cash_expense_categories",
          params.id,
        );
        if (previous?.code) {
          throw fail(
            "Системную статью расхода нельзя удалить — только переименовать или убрать в архив",
          );
        }
        if (
          (await all<AccountOperation>("account_operations")).some((op) =>
            same(op.category_id, params.id),
          )
        ) {
          throw fail("По статье есть расходы: уберите её в архив", "23503");
        }
        previousRows.set(`category${params.id}`, previous);
        return params;
      },
      afterDelete: async (result) => {
        const key = `category${result.data?.id}`;
        const previous = previousRows.get(key) as
          | CashExpenseCategory
          | undefined;
        previousRows.delete(key);
        if (previous) {
          await logAudit({
            entity: "cash_expense_category",
            entity_id: previous.id,
            action: "delete",
            changes: diff(previous, null, ["name", "is_active"]),
          });
        }
        return result;
      },
    } satisfies ResourceCallbacks<CashExpenseCategory>,
    {
      resource: "lab_payments",
      afterGetList: async (result: GetListResult) =>
        (await senior()) ? result : { ...result, data: [], total: 0 },
      beforeCreate: async (params) => {
        if (!(await senior())) {
          throw fail(
            "Оплату лаборатории проводят владелец и руководитель",
            "42501",
          );
        }
        const data = params.data as Partial<LabPayment>;
        const lab = await byId<Lab>("labs", data.lab_id as Identifier);
        if (!lab) throw fail("Лаборатория не найдена", "P0002");
        const amount = Math.round(Number(data.amount ?? 0));
        if (!(amount > 0 && amount <= 1_000_000_000)) {
          throw fail("Сумма должна быть больше нуля", "23514");
        }
        let method = data.method ?? "bank_transfer";
        let paidAt = data.paid_at ?? new Date().toISOString();
        if (data.account_operation_id != null) {
          const op = await byId<AccountOperation>(
            "account_operations",
            data.account_operation_id,
          );
          const lab = await categoryOf("lab");
          if (
            !op ||
            op.kind !== "expense" ||
            op.amount !== amount ||
            !same(op.category_id, lab?.id)
          ) {
            throw fail(
              "Оплату лаборатории связывают с расходом «Лаборатория» той же суммы",
            );
          }
          method = op.method as LabPaymentMethod;
          paidAt = op.occurred_at;
        }
        return {
          ...params,
          data: {
            ...data,
            lab_id: lab.id,
            month: monthStart(String(data.month ?? dayOf(new Date()))),
            amount,
            method,
            paid_at: paidAt,
            comment: data.comment?.trim() || null,
            account_operation_id: data.account_operation_id ?? null,
            created_by: (await currentSalesId()) ?? null,
            created_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result) => {
        await logAudit({
          entity: "lab_payment",
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, LAB_PAYMENT_AUDITED),
        });
        return result;
      },
      beforeUpdate: async (params) => {
        if (!(await senior())) {
          throw fail(
            "Оплату лаборатории проводят владелец и руководитель",
            "42501",
          );
        }
        const previous = await byId<LabPayment>("lab_payments", params.id);
        if (!previous) throw fail("Оплата не найдена", "P0002");
        const data = { ...params.data } as Partial<LabPayment>;
        if (
          "account_operation_id" in data &&
          !same(data.account_operation_id, previous.account_operation_id) &&
          (data.account_operation_id ?? null) !==
            (previous.account_operation_id ?? null)
        ) {
          throw fail("Связь оплаты с кассой не меняется");
        }
        if (
          previous.account_operation_id != null &&
          lockedChange(previous, data, ["amount", "method", "paid_at"])
        ) {
          throw fail(
            "Оплата проведена через кассу: сумму, способ и время меняют в кассе или отменяют оплату",
          );
        }
        if (data.month) data.month = monthStart(data.month);
        if (data.comment !== undefined) {
          data.comment = data.comment?.trim() || null;
        }
        previousRows.set(`lab_payment${params.id}`, previous);
        return { ...params, data };
      },
      afterUpdate: async (result) => {
        const key = `lab_payment${result.data.id}`;
        const previous = previousRows.get(key) as LabPayment | undefined;
        previousRows.delete(key);
        const changes = diff(previous, result.data, LAB_PAYMENT_AUDITED);
        if (Object.keys(changes).length) {
          await logAudit({
            entity: "lab_payment",
            entity_id: result.data.id,
            action: "update",
            changes,
          });
        }
        return result;
      },
      beforeDelete: async (params) => {
        if (!(await senior())) {
          throw fail(
            "Оплату лаборатории проводят владелец и руководитель",
            "42501",
          );
        }
        previousRows.set(
          `lab_payment${params.id}`,
          await byId<LabPayment>("lab_payments", params.id),
        );
        return params;
      },
      afterDelete: async (result) => {
        const key = `lab_payment${result.data?.id}`;
        const previous = previousRows.get(key) as LabPayment | undefined;
        previousRows.delete(key);
        if (previous) {
          await logAudit({
            entity: "lab_payment",
            entity_id: previous.id,
            action: "delete",
            changes: diff(previous, null, LAB_PAYMENT_AUDITED),
          });
          if (previous.account_operation_id != null) {
            await cancelLinkedExpense(previous.account_operation_id);
          }
        }
        return result;
      },
    } satisfies ResourceCallbacks<LabPayment>,
    {
      // A payout given from the cash desk (stage 42): the link and the
      // amount and the day are the expense's; deleting it cancels the
      // expense
      resource: "payroll_adjustments",
      beforeCreate: async (params) => {
        const data = params.data as Partial<PayrollAdjustment>;
        if (data.account_operation_id == null) return params;
        const op = await byId<AccountOperation>(
          "account_operations",
          data.account_operation_id,
        );
        const salary = await categoryOf("salary");
        if (
          data.kind !== "payout" ||
          !op ||
          op.kind !== "expense" ||
          op.amount !== Math.round(Number(data.amount)) ||
          !same(op.category_id, salary?.id)
        ) {
          throw fail("Выплату связывают с расходом «Зарплата» той же суммы");
        }
        return params;
      },
      beforeUpdate: async (params) => {
        const previous = await byId<PayrollAdjustment>(
          "payroll_adjustments",
          params.id,
        );
        if (!previous) return params;
        const data = params.data as Partial<PayrollAdjustment>;
        if (
          "account_operation_id" in data &&
          (data.account_operation_id ?? null) !==
            (previous.account_operation_id ?? null) &&
          !same(data.account_operation_id, previous.account_operation_id)
        ) {
          throw fail("Связь выплаты с кассой не меняется");
        }
        if (
          previous.account_operation_id != null &&
          lockedChange(previous, data, ["amount", "occurred_on", "kind"])
        ) {
          throw fail(
            "Выплата проведена через кассу: сумму и дату меняют в кассе или отменяют выплату",
          );
        }
        return params;
      },
      beforeDelete: async (params) => {
        previousRows.set(
          `payout${params.id}`,
          await byId<PayrollAdjustment>("payroll_adjustments", params.id),
        );
        return params;
      },
      afterDelete: async (result) => {
        const key = `payout${result.data?.id}`;
        const previous = previousRows.get(key) as PayrollAdjustment | undefined;
        previousRows.delete(key);
        if (previous?.account_operation_id != null) {
          await cancelLinkedExpense(previous.account_operation_id);
        }
        return result;
      },
    } satisfies ResourceCallbacks<PayrollAdjustment>,
  ];

  const labPaymentsSummary = async () => {
    const [rows, labs, sales] = await Promise.all([
      all<LabPayment>("lab_payments"),
      all<Lab>("labs"),
      all<Sale>("sales"),
    ]);
    if (!(await senior())) return [];
    return rows.flatMap((row) => {
      const lab = labs.find((l) => same(l.id, row.lab_id));
      if (!lab) return [];
      const author = sales.find((s) => same(s.id, row.created_by));
      return [
        {
          ...row,
          lab_name: lab.name,
          created_by_name:
            [author?.first_name, author?.last_name].filter(Boolean).join(" ") ||
            null,
        },
      ];
    });
  };

  const methods = {
    /** «Выплата»; fromCash — «Выдать из кассы» (public.record_payroll_payout) */
    async recordPayrollPayout(input: {
      doctor_id?: Identifier | null;
      sales_id?: Identifier | null;
      month: string;
      amount: number;
      day?: string | null;
      note?: string | null;
      fromCash?: boolean;
      method?: ExpenseMethod;
    }): Promise<CashLinkResult> {
      if (!(await senior())) {
        throw fail("Зарплаты видят только владелец и руководитель", "42501");
      }
      const amount = Math.round(Number(input.amount));
      if (!input.month || !(amount > 0)) {
        throw fail("Укажите месяц и сумму выплаты");
      }
      if ((input.doctor_id == null) === (input.sales_id == null)) {
        throw fail("Укажите врача или сотрудника");
      }
      const doctor =
        input.doctor_id != null
          ? await byId<Doctor>("doctors", input.doctor_id)
          : undefined;
      const employee =
        input.sales_id != null
          ? await byId<Sale>("sales", input.sales_id)
          : undefined;
      const name =
        doctor?.name ??
        (employee
          ? [employee.first_name, employee.last_name].filter(Boolean).join(" ")
          : undefined);
      if (!name) throw fail("Сотрудник не найден", "P0002");
      const month = monthStart(input.month);
      const note = input.note?.trim() || null;
      let op: AccountOperation | null = null;
      if (input.fromCash) {
        const method = input.method ?? "cash";
        await needShift(method);
        op = await writeExpense({
          amount,
          method,
          code: "salary",
          occurred_at: momentOf(input.day),
          comment: [`Зарплата: ${name}, ${monthLabel(month)}`, note]
            .filter(Boolean)
            .join(" — "),
        });
      }
      try {
        const { data } = await getDataProvider().create<PayrollAdjustment>(
          "payroll_adjustments",
          {
            data: {
              doctor_id: input.doctor_id ?? null,
              sales_id: input.sales_id ?? null,
              month,
              kind: "payout",
              amount,
              note,
              occurred_on: op
                ? dayOf(new Date(op.occurred_at))
                : (input.day ?? dayOf(new Date())),
              account_operation_id: op?.id ?? null,
            },
          },
        );
        return { adjustment_id: data.id, operation_id: op?.id ?? null };
      } catch (error) {
        // One transaction in the database: the expense goes too
        if (op) {
          await baseDataProvider.delete("account_operations", {
            id: op.id,
            previousData: op,
          });
        }
        throw error;
      }
    },
    /** «Оплатить» a lab; fromCash — the expense (public.record_lab_payment) */
    async recordLabPayment(input: {
      lab_id: Identifier;
      month: string;
      amount: number;
      method: LabPaymentMethod;
      day?: string | null;
      comment?: string | null;
      fromCash?: boolean;
    }): Promise<CashLinkResult> {
      if (!(await senior())) {
        throw fail(
          "Оплату лаборатории проводят владелец и руководитель",
          "42501",
        );
      }
      const lab = await byId<Lab>("labs", input.lab_id);
      if (!lab) throw fail("Лаборатория не найдена", "P0002");
      const amount = Math.round(Number(input.amount));
      if (!input.month || !(amount > 0)) {
        throw fail("Укажите месяц и сумму оплаты");
      }
      const month = monthStart(input.month);
      const comment = input.comment?.trim() || null;
      let op: AccountOperation | null = null;
      if (input.fromCash) {
        await needShift(input.method);
        op = await writeExpense({
          amount,
          method: input.method,
          code: "lab",
          occurred_at: momentOf(input.day),
          comment: [`Лаборатория: ${lab.name}, ${monthLabel(month)}`, comment]
            .filter(Boolean)
            .join(" — "),
        });
      }
      try {
        const { data } = await getDataProvider().create<LabPayment>(
          "lab_payments",
          {
            data: {
              lab_id: lab.id,
              month,
              amount,
              method: input.method,
              paid_at: op?.occurred_at ?? momentOf(input.day),
              comment,
              account_operation_id: op?.id ?? null,
            },
          },
        );
        return { payment_id: data.id, operation_id: op?.id ?? null };
      } catch (error) {
        if (op) {
          await baseDataProvider.delete("account_operations", {
            id: op.id,
            previousData: op,
          });
        }
        throw error;
      }
    },
  };

  return {
    callbacks,
    methods,
    views: { lab_payments_summary: labPaymentsSummary } as Record<
      string,
      () => Promise<any[]>
    >,
  };
};
