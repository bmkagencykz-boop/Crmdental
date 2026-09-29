import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import {
  checkExpense,
  checkOperation,
  expenseTotals,
  normalizeOperation,
  operationDeltas,
  patientCharged,
  planCharges,
  planPaid,
  shiftExpected,
  tillTotals,
  withDeltas,
} from "../../payments/paymentMath";
import {
  PAYMENT_METHODS,
  type AccountOperation,
  type CashExpenseCategory,
  type CashExpenseRow,
  type CashMethodRow,
  type CashShift,
  type ShiftClosing,
} from "../../payments/types";
import type { LabPayment } from "../../lab/types";
import type { PayrollAdjustment } from "../../payroll/types";
import type { Branch } from "../../branches/branches";
import type { Visit } from "../../schedule/types";
import type { TreatmentPlan, TreatmentPlanItem } from "../../treatment/types";
import type {
  AuditLogEntry,
  Deal,
  DealPayment,
  OrganizationSettings,
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

const MESSAGES: Record<string, string> = {
  "payments.errors.amount": "Укажите сумму",
  "payments.errors.method": "Этот способ оплаты здесь не подходит",
  "payments.errors.parts_count": "Смешанная оплата — два способа или больше",
  "payments.errors.part_invalid": "Неверная часть смешанной оплаты",
  "payments.errors.parts_sum": "Сумма частей не равна сумме оплаты",
  "payments.errors.cash_short": "Получено наличными меньше, чем к оплате",
  "payments.errors.deposit_insufficient": "На депозите меньше суммы операции",
  "payments.errors.refund_exceeds_paid": "Вернуть можно не больше оплаченного",
  "cash_out.errors.method":
    "Расход проводится наличными, картой, Kaspi или переводом",
  "cash_out.errors.category": "Укажите статью расхода",
};

const AUDITED = [
  "kind",
  "account",
  "amount",
  "method",
  "parts",
  "occurred_at",
  "comment",
  "deal_id",
  "plan_id",
  "visit_id",
  "shift_id",
  "category_id",
] as const;

const clinicDate = (at: string) => {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Payments, deposits and the cash desk of the demo (stage 36): the same
 * rules as supabase/schemas/36_payments.sql — the ledger with its effects
 * (paymentMath.ts), the deal payment of every operation that pays the
 * services of a deal (and the ledger row of a deal payment written
 * directly), the balances, the cashier's shift and branch, the refunds for
 * the owner and the head, the corrections for the owner, the audit log.
 * Expenses (stage 42, 42_cash_outflows.sql): no patient, a category, the
 * owner and the head (an administrator when the clinic allows it), their
 * payout or lab payment deleted with them.
 */
export const createPaymentsDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
  logAudit,
  reportsAllowed,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getDataProvider: () => DataProvider;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  /** The «Отчёты» right of the signed-in employee (stage 30) */
  reportsAllowed: () => Promise<boolean>;
}) => {
  /** 'ledger': a deal payment written by an operation; 'deal': the reverse */
  let sync: "" | "ledger" | "deal" = "";
  const previousOps = new Map<string, AccountOperation>();
  /** Expenses being cancelled by their payout or lab payment (stage 42) */
  const linkDeleting = new Set<string>();
  /** The payout or the lab payment of an expense */
  const linkOf = async (
    opId: Identifier,
  ): Promise<
    | { kind: "payout"; row: PayrollAdjustment }
    | { kind: "lab"; row: LabPayment }
    | null
  > => {
    const payout = (await all<PayrollAdjustment>("payroll_adjustments")).find(
      (a) => same(a.account_operation_id, opId),
    );
    if (payout) return { kind: "payout", row: payout };
    const lab = (await all<LabPayment>("lab_payments")).find((l) =>
      same(l.account_operation_id, opId),
    );
    return lab ? { kind: "lab", row: lab } : null;
  };

  const me = async () => {
    const id = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, id));
  };
  // The demo's default user (no staff row) is the owner
  const myRole = async () => (await me())?.role ?? "owner";

  const ops = () => all<AccountOperation>("account_operations");
  const shifts = () => all<CashShift>("cash_shifts");
  const openShiftOf = async (salesId: Identifier | null | undefined) =>
    (await shifts()).find(
      (shift) => same(shift.sales_id, salesId) && !shift.closed_at,
    );

  const audit = (
    action: "create" | "update" | "delete",
    op: AccountOperation,
    previous?: AccountOperation,
  ) => {
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of AUDITED) {
      const before = previous
        ? (previous[field] ?? null)
        : action === "delete"
          ? (op[field] ?? null)
          : null;
      const after = action === "delete" ? null : (op[field] ?? null);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changes[field] = [before, after];
      }
    }
    if (action === "update" && !Object.keys(changes).length) return;
    return logAudit({
      entity: "account_operation",
      entity_id: op.id,
      action,
      changes,
      deal_id: op.deal_id ?? null,
      patient_id: op.patient_id,
    });
  };

  // --- views ------------------------------------------------------------

  /** Who may record an expense: owner, head; a manager when allowed */
  const canExpense = async () => {
    const role = await myRole();
    if (role === "owner" || role === "head") return true;
    if (role !== "manager") return false;
    const [settings] = await all<OrganizationSettings>("organization_settings");
    return !!settings?.manager_cash_expenses;
  };
  /**
   * Expenses are read by the owner and the head, a manager with the
   * «Отчёты» right, and the manager who recorded them
   */
  const expenseFilter = async () => {
    const role = await myRole();
    if (role === "owner" || role === "head") return () => true;
    if (role !== "manager") return () => false;
    if (await reportsAllowed()) return () => true;
    const id = await currentSalesId();
    return (op: AccountOperation) => same(op.sales_id, id);
  };
  const visibleOps = async () => {
    const seesExpense = await expenseFilter();
    return (await ops()).filter(
      (op) => op.kind !== "expense" || seesExpense(op),
    );
  };
  const categories = () =>
    all<CashExpenseCategory>("cash_expense_categories");

  const operationsSummary = async () => {
    const [rows, patients, sales, deals, plans, branches, cats, payouts, labs] =
      await Promise.all([
        visibleOps(),
        all<Patient>("patients"),
        all<Sale>("sales"),
        all<Deal>("deals"),
        all<TreatmentPlan>("treatment_plans"),
        all<Branch>("branches"),
        categories(),
        all<PayrollAdjustment>("payroll_adjustments"),
        all<LabPayment>("lab_payments"),
      ]);
    return rows.flatMap((op) => {
      const patient = patients.find((p) => same(p.id, op.patient_id));
      if (!patient && op.kind !== "expense") return [];
      const cashier = sales.find((s) => same(s.id, op.sales_id));
      const category = cats.find((c) => same(c.id, op.category_id));
      return [
        {
          ...op,
          patient_name: patient
            ? [patient.last_name, patient.first_name, patient.middle_name]
                .filter((part) => part?.trim())
                .join(" ") || null
            : null,
          patient_phone: patient?.phones?.[0] ?? null,
          cashier_name:
            [cashier?.first_name, cashier?.last_name]
              .filter(Boolean)
              .join(" ") || null,
          deal_name: deals.find((d) => same(d.id, op.deal_id))?.name ?? null,
          plan_name: plans.find((p) => same(p.id, op.plan_id))?.name ?? null,
          branch_name:
            branches.find((b) => same(b.id, op.branch_id))?.name ?? null,
          category_id: op.category_id ?? null,
          category_name: category?.name ?? null,
          category_code: category?.code ?? null,
          payroll_adjustment_id:
            payouts.find((a) => same(a.account_operation_id, op.id))?.id ??
            null,
          lab_payment_id:
            labs.find((l) => same(l.account_operation_id, op.id))?.id ?? null,
        },
      ];
    });
  };

  const patientAccounts = async () => {
    const [patients, rows, plans, items, visits, services, deals] =
      await Promise.all([
        all<Patient>("patients"),
        ops(),
        all<TreatmentPlan>("treatment_plans"),
        all<TreatmentPlanItem>("treatment_plan_items"),
        all<Visit>("visits"),
        all<Service>("services"),
        all<Deal>("deals"),
      ]);
    return patients.map((patient) => {
      const own = rows.filter((op) => same(op.patient_id, patient.id));
      const charged = patientCharged({
        patientId: patient.id,
        plans,
        items,
        visits,
        services,
      });
      let deposit = 0;
      let paid = 0;
      for (const op of own) {
        const deltas = operationDeltas(op);
        deposit += deltas.deposit;
        paid += deltas.paid;
      }
      const lastVisit = visits
        .filter(
          (visit) =>
            same(visit.patient_id, patient.id) &&
            ["arrived", "completed"].includes(visit.status),
        )
        .map((visit) => visit.starts_at)
        .sort()
        .at(-1);
      const lastDeal = deals
        .filter((deal) => same(deal.patient_id, patient.id))
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            Number(b.id) - Number(a.id),
        )[0];
      return {
        id: patient.id,
        first_name: patient.first_name,
        last_name: patient.last_name,
        middle_name: patient.middle_name ?? null,
        phones: patient.phones ?? [],
        sales_id: patient.sales_id ?? null,
        deposit,
        paid,
        charged,
        debt: Math.max(0, charged - paid),
        advance: Math.max(0, paid - charged),
        balance: deposit + paid - charged,
        last_payment_at:
          own
            .map((op) => op.occurred_at)
            .sort()
            .at(-1) ?? null,
        operations_count: own.length,
        last_visit_at: lastVisit ?? null,
        last_deal_id: lastDeal?.id ?? null,
      };
    });
  };

  const planPayments = async () => {
    const [plans, items, rows] = await Promise.all([
      all<TreatmentPlan>("treatment_plans"),
      all<TreatmentPlanItem>("treatment_plan_items"),
      ops(),
    ]);
    return plans.map((plan) => {
      const { total, done } = planCharges(plan, items);
      const paid = planPaid(plan, rows);
      return {
        id: plan.id,
        deal_id: plan.deal_id,
        patient_id: plan.patient_id,
        status: plan.status,
        is_main: plan.is_main,
        total_amount: total,
        done_amount: done,
        paid_amount: paid,
        due_amount: Math.max(0, total - paid),
        debt_amount: Math.max(0, done - paid),
      };
    });
  };

  /** The cashier's own shifts; every shift with the «Отчёты» right */
  const visibleShifts = async () => {
    const role = await myRole();
    if (role === "integrator") return [];
    if (role === "owner" || role === "head" || (await reportsAllowed())) {
      return shifts();
    }
    const id = await currentSalesId();
    return (await shifts()).filter((shift) => same(shift.sales_id, id));
  };

  const views: Record<string, () => Promise<any[]>> = {
    account_operations_summary: operationsSummary,
    patient_accounts: patientAccounts,
    treatment_plan_payments: planPayments,
    cash_shifts: visibleShifts,
  };

  // --- the rules of the trigger -----------------------------------------

  const balances = async (
    patientId: Identifier,
    dealId: Identifier | null | undefined,
  ) => {
    const own = (await ops()).filter((op) => same(op.patient_id, patientId));
    return {
      deposit: own.reduce((sum, op) => sum + operationDeltas(op).deposit, 0),
      paid: own
        .filter((op) => dealId == null || same(op.deal_id, dealId))
        .reduce((sum, op) => sum + operationDeltas(op).paid, 0),
    };
  };

  /** An expense: no patient, a category, a real method (stage 42) */
  const prepareExpense = async (input: Partial<AccountOperation>) => {
    if (!(await canExpense())) {
      throw fail("Расходы из кассы проводят владелец и руководитель", "42501");
    }
    if (
      input.patient_id != null ||
      input.deal_id != null ||
      input.plan_id != null ||
      input.visit_id != null ||
      (input.plan_item_ids ?? []).length
    ) {
      throw fail("Расход не связан с пациентом, сделкой или визитом");
    }
    const amount = Math.round(Number(input.amount ?? 0));
    const method = input.method ?? "cash";
    const category = (await categories()).find((c) =>
      same(c.id, input.category_id),
    );
    const problem = checkExpense({
      amount,
      method,
      category_id: category?.id ?? null,
    });
    if (problem) throw fail(MESSAGES[problem] ?? problem);
    if (!category!.is_active) throw fail("Статья расхода в архиве");
    const salesId = (await currentSalesId()) ?? null;
    const shift = await openShiftOf(salesId);
    const now = new Date().toISOString();
    return withDeltas({
      kind: "expense" as const,
      account: "services" as const,
      amount,
      method,
      parts: null,
      cash_received: null,
      prepayment: false,
      occurred_at: input.occurred_at ?? now,
      sales_id: salesId,
      branch_id: input.branch_id ?? shift?.branch_id ?? null,
      shift_id: shift?.id ?? null,
      patient_id: null,
      deal_id: null,
      plan_id: null,
      plan_item_ids: [],
      visit_id: null,
      comment: input.comment?.trim() || null,
      source: "cash_desk" as const,
      deal_payment_id: null,
      category_id: category!.id,
      created_at: now,
    });
  };

  const prepare = async (input: Partial<AccountOperation>) => {
    if (input.kind === "expense") return prepareExpense(input);
    if (input.category_id != null) {
      throw fail("Статья расхода указывается только у расхода");
    }
    const role = await myRole();
    if (!["owner", "head", "manager"].includes(role)) {
      throw fail("Нет права на операции по счёту пациента", "42501");
    }
    if (input.kind === "refund" && !["owner", "head"].includes(role)) {
      throw fail("Возврат проводят владелец или руководитель", "42501");
    }
    if (input.kind === "correction" && role !== "owner") {
      throw fail("Корректировку проводит только владелец", "42501");
    }
    const op = normalizeOperation({
      account: "services",
      method: "cash",
      parts: null,
      ...input,
      amount: Math.round(Number(input.amount ?? 0)),
    } as AccountOperation);
    op.comment = op.comment?.trim() || null;
    op.plan_item_ids = op.plan_item_ids ?? [];

    // Links: the visit, the plan and the deal are of the patient
    if (op.visit_id != null) {
      const visit = (await all<Visit>("visits")).find((v) =>
        same(v.id, op.visit_id),
      );
      if (
        !visit ||
        (op.patient_id != null && !same(visit.patient_id, op.patient_id))
      ) {
        throw fail("Визит другого пациента");
      }
      op.patient_id = visit.patient_id;
      op.visit_id = visit.id;
      op.deal_id = op.deal_id ?? visit.deal_id ?? null;
    }
    if (op.plan_id != null) {
      const plan = (await all<TreatmentPlan>("treatment_plans")).find((p) =>
        same(p.id, op.plan_id),
      );
      if (!plan || (op.deal_id != null && !same(plan.deal_id, op.deal_id))) {
        throw fail("План лечения другой сделки");
      }
      op.deal_id = plan.deal_id;
      op.plan_id = plan.id;
      const items = (
        await all<TreatmentPlanItem>("treatment_plan_items")
      ).filter((item) => same(item.plan_id, plan.id));
      const chosen = op.plan_item_ids.map((id) =>
        items.find((item) => same(item.id, id)),
      );
      if (chosen.some((item) => !item)) {
        throw fail("Позиции не из этого плана лечения");
      }
      // The ids as stored (a form sends strings)
      op.plan_item_ids = chosen.map((item) => item!.id);
    } else if (op.plan_item_ids.length) {
      throw fail("Позиции не из этого плана лечения");
    }
    let deal: Deal | undefined;
    if (op.deal_id != null) {
      deal = (await all<Deal>("deals")).find((d) => same(d.id, op.deal_id));
      if (!deal) throw fail("Сделка не найдена", "P0002");
      op.deal_id = deal.id;
      if (op.patient_id == null) op.patient_id = deal.patient_id;
      else if (!same(op.patient_id, deal.patient_id)) {
        throw fail("Сделка другого пациента");
      }
    }
    const patient = (await all<Patient>("patients")).find((p) =>
      same(p.id, op.patient_id),
    );
    if (!patient) throw fail("Пациент не найден", "P0002");
    op.patient_id = patient.id;

    const problem = checkOperation(
      op,
      await balances(op.patient_id, op.deal_id),
    );
    if (problem) throw fail(MESSAGES[problem] ?? problem);
    if (
      !["payment", "deposit"].includes(op.kind) ||
      !(op.method === "cash" || op.parts?.some((p) => p.method === "cash"))
    ) {
      op.cash_received = null;
    }

    const salesId = (await currentSalesId()) ?? null;
    const shift = await openShiftOf(salesId);
    const now = new Date().toISOString();
    return withDeltas({
      ...op,
      occurred_at: op.occurred_at ?? now,
      sales_id: salesId,
      shift_id: shift?.id ?? null,
      branch_id: op.branch_id ?? shift?.branch_id ?? deal?.branch_id ?? null,
      source: "cash_desk" as const,
      deal_payment_id: null,
      prepayment: !!op.prepayment,
      created_at: now,
    });
  };

  /** The deal payment of an operation paying the services of a deal */
  const writeDealPayment = async (op: AccountOperation) => {
    const paid = operationDeltas(op).paid;
    if (op.deal_id == null || paid === 0) return;
    sync = "ledger";
    try {
      const { data: payment } = await getDataProvider().create<DealPayment>(
        "deal_payments",
        {
          data: {
            deal_id: op.deal_id,
            amount: paid,
            paid_at: clinicDate(op.occurred_at),
            comment: op.comment ?? null,
            kind: op.prepayment ? "prepayment" : "payment",
          },
        },
      );
      await baseDataProvider.update("account_operations", {
        id: op.id,
        data: { deal_payment_id: payment.id },
        previousData: op,
      });
      op.deal_payment_id = payment.id;
    } finally {
      sync = "";
    }
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "account_operations",
      beforeCreate: async (params) => ({
        ...params,
        data: await prepare(params.data),
      }),
      afterCreate: async (result) => {
        const op = result.data as AccountOperation;
        await writeDealPayment(op);
        await audit("create", op);
        return { ...result, data: op };
      },
      beforeUpdate: async (params) => {
        const role = await myRole();
        if (role !== "owner" && role !== "head") {
          throw fail(
            "Изменить операцию могут владелец или руководитель",
            "42501",
          );
        }
        const previous = (await ops()).find((op) => same(op.id, params.id));
        if (!previous) throw fail("Операция не найдена", "P0002");
        // Only the comment, the time and the method change
        const changes = params.data as Partial<AccountOperation>;
        const next = {
          ...previous,
          comment:
            changes.comment !== undefined
              ? changes.comment?.trim() || null
              : previous.comment,
          occurred_at: changes.occurred_at ?? previous.occurred_at,
          method: changes.method ?? previous.method,
          parts: changes.parts !== undefined ? changes.parts : previous.parts,
          category_id:
            changes.category_id !== undefined
              ? changes.category_id
              : (previous.category_id ?? null),
        };
        if (previous.kind === "expense") {
          const problem = checkExpense(next);
          if (problem) throw fail(MESSAGES[problem] ?? problem);
          if (!same(next.category_id, previous.category_id)) {
            const category = (await categories()).find((c) =>
              same(c.id, next.category_id),
            );
            if (!category) throw fail("Укажите статью расхода");
            if (!category.is_active) throw fail("Статья расхода в архиве");
            if (await linkOf(previous.id)) {
              throw fail(
                "Это выплата зарплаты или оплата лаборатории: статья не меняется",
              );
            }
            next.category_id = category.id;
          }
          previousOps.set(String(previous.id), previous);
          return { ...params, data: withDeltas(next) };
        } else if (next.category_id != null) {
          throw fail("Статья расхода указывается только у расхода");
        }
        if (
          next.method !== previous.method &&
          [previous.method, next.method].some((m) =>
            ["deposit", "other"].includes(m),
          )
        ) {
          throw fail("Способ оплаты этой операции не меняется");
        }
        const problem = checkOperation(normalizeOperation(next), {
          deposit: Infinity,
          paid: Infinity,
        });
        if (problem) throw fail(MESSAGES[problem] ?? problem);
        previousOps.set(String(previous.id), previous);
        return { ...params, data: withDeltas(normalizeOperation(next)) };
      },
      afterUpdate: async (result) => {
        const op = result.data as AccountOperation;
        const previous = previousOps.get(String(op.id));
        previousOps.delete(String(op.id));
        if (
          previous &&
          op.deal_payment_id != null &&
          (op.comment !== previous.comment ||
            op.occurred_at !== previous.occurred_at)
        ) {
          const payment = (await all<DealPayment>("deal_payments")).find((p) =>
            same(p.id, op.deal_payment_id),
          );
          if (payment) {
            sync = "ledger";
            try {
              await getDataProvider().update("deal_payments", {
                id: payment.id,
                data: {
                  comment: op.comment ?? null,
                  paid_at: clinicDate(op.occurred_at),
                },
                previousData: payment,
              });
            } finally {
              sync = "";
            }
          }
        }
        // The payout or the lab payment follows the method and the time
        if (
          previous &&
          op.kind === "expense" &&
          (op.method !== previous.method ||
            op.occurred_at !== previous.occurred_at)
        ) {
          const link = await linkOf(op.id);
          if (link?.kind === "payout") {
            await baseDataProvider.update("payroll_adjustments", {
              id: link.row.id,
              data: { occurred_on: clinicDate(op.occurred_at) },
              previousData: link.row,
            });
          } else if (link?.kind === "lab") {
            await baseDataProvider.update("lab_payments", {
              id: link.row.id,
              data: { method: op.method, paid_at: op.occurred_at },
              previousData: link.row,
            });
          }
        }
        if (previous) await audit("update", op, previous);
        return result;
      },
      beforeDelete: async (params) => {
        const role = await myRole();
        if (role !== "owner" && role !== "head") {
          throw fail(
            "Отменить операцию могут владелец или руководитель",
            "42501",
          );
        }
        const op = (await ops()).find((row) => same(row.id, params.id));
        if (op && operationDeltas(op).deposit > 0) {
          const { deposit } = await balances(op.patient_id, null);
          if (deposit - operationDeltas(op).deposit < 0) {
            throw fail(
              "Депозит уже израсходован: сначала отмените оплаты с депозита",
            );
          }
        }
        return params;
      },
      afterDelete: async (result) => {
        const op = result.data as AccountOperation;
        if (op.deal_payment_id != null && sync !== "deal") {
          const payment = (await all<DealPayment>("deal_payments")).find((p) =>
            same(p.id, op.deal_payment_id),
          );
          if (payment) {
            sync = "ledger";
            try {
              await getDataProvider().delete("deal_payments", {
                id: payment.id,
                previousData: payment,
              });
            } finally {
              sync = "";
            }
          }
        }
        // An expense takes its payout or lab payment along (a cascade: not
        // in the audit log); unless they are what is being deleted
        const fromLink = linkDeleting.has(String(op.id));
        if (op.kind === "expense" && !fromLink) {
          const link = await linkOf(op.id);
          if (link) {
            await baseDataProvider.delete(
              link.kind === "payout" ? "payroll_adjustments" : "lab_payments",
              { id: link.row.id, previousData: link.row },
            );
          }
        }
        if (sync !== "deal" && !fromLink) await audit("delete", op);
        return result;
      },
    } satisfies ResourceCallbacks<AccountOperation>,
    {
      // A deal payment written directly (the MIS, the import, the API): the
      // ledger follows. A manager does not change or delete payments.
      resource: "deal_payments",
      beforeUpdate: async (params) => {
        if (sync !== "ledger" && (await myRole()) === "manager") {
          throw fail(
            "Изменить или удалить оплату могут владелец или руководитель",
            "42501",
          );
        }
        return params;
      },
      beforeDelete: async (params) => {
        if (sync !== "ledger" && (await myRole()) === "manager") {
          throw fail(
            "Изменить или удалить оплату могут владелец или руководитель",
            "42501",
          );
        }
        return params;
      },
      afterCreate: async (result) => {
        if (sync === "ledger") return result;
        const payment = result.data as DealPayment;
        const deal = (await all<Deal>("deals")).find((d) =>
          same(d.id, payment.deal_id),
        );
        if (!deal) return result;
        await baseDataProvider.create("account_operations", {
          data: withDeltas({
            patient_id: deal.patient_id,
            kind: payment.amount > 0 ? "payment" : "refund",
            account: "services",
            amount: Math.abs(payment.amount),
            method: "other",
            parts: null,
            prepayment: payment.kind === "prepayment",
            occurred_at: payment.created_at ?? new Date().toISOString(),
            sales_id: payment.sales_id ?? null,
            branch_id: deal.branch_id ?? null,
            shift_id: null,
            deal_id: deal.id,
            plan_id: null,
            plan_item_ids: [],
            visit_id: null,
            comment: payment.comment ?? null,
            source: "deal",
            deal_payment_id: payment.id,
            created_at: payment.created_at ?? new Date().toISOString(),
          } as Omit<AccountOperation, "id">),
        });
        return result;
      },
      afterUpdate: async (result) => {
        if (sync === "ledger") return result;
        const payment = result.data as DealPayment;
        const op = (await ops()).find((row) =>
          same(row.deal_payment_id, payment.id),
        );
        if (op) {
          await baseDataProvider.update("account_operations", {
            id: op.id,
            data: withDeltas({
              ...op,
              kind:
                payment.amount > 0
                  ? op.kind === "refund"
                    ? "payment"
                    : op.kind
                  : "refund",
              amount: Math.abs(payment.amount),
              deal_id: payment.deal_id,
              comment: payment.comment ?? null,
              prepayment: payment.kind === "prepayment",
            }),
            previousData: op,
          });
        }
        return result;
      },
      afterDelete: async (result) => {
        if (sync === "ledger") return result;
        const payment = result.data as DealPayment;
        const op = (await ops()).find((row) =>
          same(row.deal_payment_id, payment.id),
        );
        if (op) {
          await baseDataProvider.delete("account_operations", {
            id: op.id,
            previousData: op,
          });
        }
        return result;
      },
    } satisfies ResourceCallbacks<DealPayment>,
    // Expenses: the owner, the head, the managers allowed (stage 42)
    {
      resource: "account_operations",
      afterGetList: async (result: GetListResult) => {
        const seesExpense = await expenseFilter();
        const data = result.data.filter(
          (op) => op.kind !== "expense" || seesExpense(op),
        );
        return { ...result, data, total: data.length };
      },
    } satisfies ResourceCallbacks,
    // The integrator sees no money (stage 25)
    ...[
      "account_operations",
      "account_operations_summary",
      "patient_accounts",
      "treatment_plan_payments",
    ].map(
      (resource): ResourceCallbacks => ({
        resource,
        afterGetList: async (result: GetListResult) =>
          (await myRole()) === "integrator"
            ? { ...result, data: [], total: 0 }
            : result,
      }),
    ),
  ];

  const methods = {
    async openCashShift(
      openingCash: number,
      branchId?: Identifier | null,
    ): Promise<Identifier> {
      const role = await myRole();
      const salesId = await currentSalesId();
      if (!["owner", "head", "manager"].includes(role) || salesId == null) {
        throw fail("Нет права открыть смену", "42501");
      }
      if (!(openingCash >= 0)) {
        throw fail("Сумма на начало смены не может быть отрицательной");
      }
      if (await openShiftOf(salesId)) throw fail("Смена уже открыта", "23505");
      const mine = (
        await all<{ sales_id: Identifier; branch_id: Identifier }>(
          "sales_branches",
        )
      ).filter((row) => same(row.sales_id, salesId));
      const { data } = await baseDataProvider.create<CashShift>("cash_shifts", {
        data: {
          sales_id: salesId,
          branch_id: branchId ?? (mine.length === 1 ? mine[0].branch_id : null),
          opened_at: new Date().toISOString(),
          opening_cash: Math.round(openingCash),
          closed_at: null,
          closed_by: null,
          expected_cash: null,
          counted_cash: null,
          discrepancy: null,
          note: null,
        },
      });
      await logAudit({
        entity: "cash_shift",
        entity_id: data.id,
        action: "create",
        changes: {
          opening_cash: [null, data.opening_cash],
          branch_id: [null, data.branch_id ?? null],
        },
      });
      return data.id;
    },
    async cashShiftExpected(shiftId: Identifier): Promise<number> {
      const shift = (await shifts()).find((s) => same(s.id, shiftId));
      if (!shift) return 0;
      return shiftExpected(
        shift.opening_cash,
        (await ops()).filter((op) => same(op.shift_id, shift.id)),
      );
    },
    async closeCashShift(
      shiftId: Identifier,
      countedCash: number,
      note?: string | null,
    ): Promise<ShiftClosing> {
      const shift = (await shifts()).find((s) => same(s.id, shiftId));
      if (!shift) throw fail("Смена не найдена", "P0002");
      const role = await myRole();
      const salesId = await currentSalesId();
      if (
        !["owner", "head"].includes(role) &&
        !(role === "manager" && same(shift.sales_id, salesId))
      ) {
        throw fail(
          "Закрыть смену может кассир смены, владелец или руководитель",
          "42501",
        );
      }
      if (shift.closed_at) throw fail("Смена уже закрыта");
      if (!(countedCash >= 0)) throw fail("Укажите сумму в кассе");
      const expected = await methods.cashShiftExpected(shift.id);
      const counted = Math.round(countedCash);
      const closed = {
        closed_at: new Date().toISOString(),
        closed_by: salesId ?? null,
        expected_cash: expected,
        counted_cash: counted,
        discrepancy: counted - expected,
        note: note?.trim() || null,
      };
      await baseDataProvider.update("cash_shifts", {
        id: shift.id,
        data: closed,
        previousData: shift,
      });
      await logAudit({
        entity: "cash_shift",
        entity_id: shift.id,
        action: "update",
        changes: {
          closed_at: [null, closed.closed_at],
          expected_cash: [null, expected],
          counted_cash: [null, counted],
          ...(closed.note ? { note: [null, closed.note] } : {}),
        },
      });
      return {
        shift_id: shift.id,
        expected_cash: expected,
        counted_cash: counted,
        discrepancy: counted - expected,
      };
    },
    async planPaidAmount(planId: Identifier): Promise<number> {
      const plan = (await all<TreatmentPlan>("treatment_plans")).find((p) =>
        same(p.id, planId),
      );
      return plan ? planPaid(plan, await ops()) : 0;
    },
    async getCashMethodsReport(filters: {
      from?: string | null;
      to?: string | null;
      branch_id?: Identifier | null;
    }): Promise<CashMethodRow[]> {
      const role = await myRole();
      if (role !== "owner" && role !== "head" && !(await reportsAllowed())) {
        throw new Error("reports.forbidden");
      }
      const rows = (await ops()).filter(
        (op) =>
          (!filters.from || op.occurred_at >= filters.from) &&
          (!filters.to || op.occurred_at < filters.to) &&
          (filters.branch_id == null || same(op.branch_id, filters.branch_id)),
      );
      const { byMethod } = tillTotals(rows);
      return PAYMENT_METHODS.map((method) => ({
        method,
        income: byMethod[method].income,
        refunds: byMethod[method].refunds,
        expenses: byMethod[method].expenses,
        net: byMethod[method].net,
        operations: byMethod[method].count,
      }))
        .filter((row) => row.operations > 0)
        .sort((a, b) => b.net - a.net || a.method.localeCompare(b.method));
    },
    /** Reports «Расходы по статьям» (public.report_cash_expenses) */
    async getCashExpensesReport(filters: {
      from?: string | null;
      to?: string | null;
      branch_id?: Identifier | null;
    }): Promise<CashExpenseRow[]> {
      const role = await myRole();
      if (role !== "owner" && role !== "head" && !(await reportsAllowed())) {
        throw new Error("reports.forbidden");
      }
      const rows = (await ops()).filter(
        (op) =>
          op.kind === "expense" &&
          (!filters.from || op.occurred_at >= filters.from) &&
          (!filters.to || op.occurred_at < filters.to) &&
          (filters.branch_id == null || same(op.branch_id, filters.branch_id)),
      );
      return expenseTotals(rows, await categories());
    },
  };

  return {
    views,
    callbacks,
    methods,
    /** A deal payment being written by an operation (logged as the operation) */
    isLedgerWriting: () => sync === "ledger",
    /**
     * Cancel the expense of a deleted payout or lab payment (a cascade of
     * the database: not in the audit log)
     */
    cancelLinkedExpense: async (opId: Identifier) => {
      const op = (await ops()).find((row) => same(row.id, opId));
      if (!op) return;
      linkDeleting.add(String(op.id));
      try {
        await getDataProvider().delete("account_operations", {
          id: op.id,
          previousData: op,
        });
      } finally {
        linkDeleting.delete(String(op.id));
      }
    },
    canExpense,
  };
};
