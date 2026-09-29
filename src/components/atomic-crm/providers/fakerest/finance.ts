import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import {
  cashFlowReport,
  computeModel,
  factRange,
  filterMovements,
  financeMovements,
  modelFacts,
  monthOf,
  pnlFacts,
  pnlReport,
} from "../../finance/financeMath";
import type {
  FinanceAccount,
  FinanceArticle,
  FinanceMethod,
  FinanceMethodAccount,
  FinanceModel,
  FinanceModelLine,
  FinanceModelMonth,
  FinanceModelReport,
  FinanceTransaction,
  PnlReport,
  Scenario,
} from "../../finance/types";
import type { Lab, LabOrderCost, LabPayment } from "../../lab/types";
import type { AdSpend } from "../../marketing/types";
import type {
  AccountOperation,
  CashExpenseCategory,
} from "../../payments/types";
import type { PayrollAdjustment, PayrollLine } from "../../payroll/types";
import type { Chair, Visit } from "../../schedule/types";
import { dayKeyOf, todayKey } from "../../tasks/calendarLayout";
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
import type {
  CashFlowFilters,
  MovementFilters,
} from "../supabase/financeMethods";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

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

const AUDITED: Record<string, { entity: string; fields: string[] }> = {
  finance_accounts: {
    entity: "finance_account",
    fields: ["name", "kind", "opening_balance", "opening_date", "is_active"],
  },
  finance_articles: {
    entity: "finance_article",
    fields: ["name", "section", "activity", "pnl_line", "is_active"],
  },
  finance_transactions: {
    entity: "finance_transaction",
    fields: [
      "kind",
      "occurred_on",
      "account_id",
      "to_account_id",
      "article_id",
      "amount",
      "counterparty",
      "comment",
      "branch_id",
    ],
  },
  finance_models: {
    entity: "finance_model",
    fields: [
      "name",
      "start_month",
      "chairs",
      "working_days",
      "hours_per_day",
      "utilization",
      "visits_per_chair_hour",
      "avg_check",
      "investment_amount",
    ],
  },
};

const MODEL_RESOURCES = [
  "finance_models",
  "finance_model_months",
  "finance_model_lines",
];

/**
 * Finance of the demo (stage 44): the same rules as
 * supabase/schemas/44_finance.sql — the ДДС (and reading the accounts,
 * articles and transactions) for whoever has the reports right, the P&L,
 * the model and every write for the owner and the head; system accounts
 * and articles kept; the article fits the kind of a transaction; the
 * transactions of the payouts and the lab payments paid without the cash
 * desk follow them. The reports are finance/financeMath.ts.
 */
export const createFinanceDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  logAudit,
  reportsAllowed,
  payrollLines,
  labCosts,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  reportsAllowed: () => Promise<boolean>;
  payrollLines: (month: string) => Promise<PayrollLine[]>;
  labCosts: () => Promise<LabOrderCost[]>;
}) => {
  const myRole = async () => {
    const id = await currentSalesId();
    // The demo's default user (no staff row) is the owner
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, id))?.role ??
      "owner"
    );
  };
  const canEdit = async () => ["owner", "head"].includes(await myRole());
  const canView = async () =>
    ["owner", "head", "manager"].includes(await myRole()) &&
    ((await myRole()) === "owner" || (await reportsAllowed()));
  const checkView = async () => {
    if (!(await canView())) throw fail("Нет доступа к финансам", "42501");
  };
  const checkEdit = async (
    message = "Финансы меняют владелец и руководитель",
  ) => {
    if (!(await canEdit())) throw fail(message, "42501");
  };
  const timeZone = async () =>
    (await all<Organization>("organizations"))[0]?.timezone || "Asia/Almaty";
  const articles = () => all<FinanceArticle>("finance_articles");
  const accounts = () => all<FinanceAccount>("finance_accounts");
  const methodRows = () =>
    all<FinanceMethodAccount & { id: string }>("finance_method_accounts");
  const articleByCode = async (code: string) =>
    (await articles()).find((row) => row.code === code);
  const accountOf = async (method: string) =>
    (await methodRows()).find((row) => row.method === method)?.account_id ??
    null;
  let syncing = false;
  const previousRows = new Map<string, Record<string, unknown>>();

  // --- the linked transactions of payouts and lab payments ---------------

  const linkedOf = async (
    field: "payroll_adjustment_id" | "lab_payment_id",
    id: Identifier,
  ) =>
    (await all<FinanceTransaction>("finance_transactions")).find((row) =>
      same(row[field], id),
    );
  const withSync = async (work: () => Promise<unknown>) => {
    syncing = true;
    try {
      await work();
    } finally {
      syncing = false;
    }
  };
  const syncPayout = async (payout: PayrollAdjustment) => {
    const linked = await linkedOf("payroll_adjustment_id", payout.id);
    await withSync(async () => {
      if (payout.kind !== "payout" || payout.account_operation_id != null) {
        if (linked) {
          await baseDataProvider.delete("finance_transactions", {
            id: linked.id,
            previousData: linked,
          });
        }
        return;
      }
      if (linked) {
        if (
          linked.amount !== payout.amount ||
          linked.occurred_on !== payout.occurred_on
        ) {
          await baseDataProvider.update("finance_transactions", {
            id: linked.id,
            data: { amount: payout.amount, occurred_on: payout.occurred_on },
            previousData: linked,
          });
        }
        return;
      }
      const account = await accountOf("bank_transfer");
      const article = await articleByCode(
        payout.doctor_id != null ? "salary_doctors" : "salary_staff",
      );
      if (account == null || !article) return;
      const person =
        payout.doctor_id != null
          ? (await all<Doctor>("doctors")).find((d) =>
              same(d.id, payout.doctor_id),
            )?.name
          : (() => null)();
      const sale =
        payout.sales_id != null
          ? (await all<Sale>("sales")).find((s) => same(s.id, payout.sales_id))
          : undefined;
      await baseDataProvider.create("finance_transactions", {
        data: {
          kind: "out",
          occurred_on: payout.occurred_on,
          account_id: account,
          to_account_id: null,
          article_id: article.id,
          amount: payout.amount,
          counterparty:
            person ??
            ([sale?.first_name, sale?.last_name].filter(Boolean).join(" ") ||
              null),
          comment: [
            `Зарплата за ${payout.month.slice(5, 7)}.${payout.month.slice(0, 4)}`,
            payout.note,
          ]
            .filter(Boolean)
            .join(" — "),
          branch_id: null,
          payroll_adjustment_id: payout.id,
          lab_payment_id: null,
          created_by: payout.created_by ?? null,
          created_at: new Date().toISOString(),
        },
      });
    });
  };
  const syncLabPayment = async (payment: LabPayment, previous?: LabPayment) => {
    const linked = await linkedOf("lab_payment_id", payment.id);
    const day = dayKeyOf(payment.paid_at, await timeZone());
    await withSync(async () => {
      if (payment.account_operation_id != null) {
        if (linked) {
          await baseDataProvider.delete("finance_transactions", {
            id: linked.id,
            previousData: linked,
          });
        }
        return;
      }
      if (linked) {
        const account =
          previous && previous.method !== payment.method
            ? ((await accountOf(payment.method)) ?? linked.account_id)
            : linked.account_id;
        await baseDataProvider.update("finance_transactions", {
          id: linked.id,
          data: {
            amount: payment.amount,
            occurred_on: day,
            account_id: account,
          },
          previousData: linked,
        });
        return;
      }
      const account =
        (await accountOf(payment.method)) ?? (await accountOf("bank_transfer"));
      const article = await articleByCode("lab");
      if (account == null || !article) return;
      const lab = (await all<Lab>("labs")).find((row) =>
        same(row.id, payment.lab_id),
      );
      await baseDataProvider.create("finance_transactions", {
        data: {
          kind: "out",
          occurred_on: day,
          account_id: account,
          to_account_id: null,
          article_id: article.id,
          amount: payment.amount,
          counterparty: lab?.name ?? null,
          comment: [
            `Лаборатория за ${payment.month.slice(5, 7)}.${payment.month.slice(0, 4)}`,
            payment.comment,
          ]
            .filter(Boolean)
            .join(" — "),
          branch_id: null,
          payroll_adjustment_id: null,
          lab_payment_id: payment.id,
          created_by: payment.created_by ?? null,
          created_at: new Date().toISOString(),
        },
      });
    });
  };
  const dropLinked = async (
    field: "payroll_adjustment_id" | "lab_payment_id",
    id: Identifier,
  ) => {
    const linked = await linkedOf(field, id);
    if (linked) {
      await withSync(() =>
        baseDataProvider.delete("finance_transactions", {
          id: linked.id,
          previousData: linked,
        }),
      );
    }
  };

  // --- rules of the rows ---------------------------------------------------

  const checkTransaction = async (
    data: Partial<FinanceTransaction>,
    previous?: FinanceTransaction,
  ): Promise<Partial<FinanceTransaction>> => {
    const next = { ...previous, ...data } as FinanceTransaction;
    if (!["in", "out", "transfer", "accrual"].includes(next.kind)) {
      throw fail(
        "Вид движения: поступление, выплата, перевод или начисление",
        "23514",
      );
    }
    if (!(Number(next.amount) > 0)) throw fail("Укажите сумму", "23514");
    if (!next.occurred_on) throw fail("Укажите дату", "23514");
    if (next.kind === "transfer") {
      if (
        next.account_id == null ||
        next.to_account_id == null ||
        same(next.account_id, next.to_account_id)
      ) {
        throw fail("Перевод — между двумя разными счетами", "23514");
      }
      next.article_id = null;
    } else if (next.kind === "accrual") {
      next.account_id = null;
      next.to_account_id = null;
    } else {
      if (next.account_id == null) throw fail("Укажите счёт", "23514");
      next.to_account_id = null;
    }
    if (next.kind !== "transfer") {
      const article = (await articles()).find((row) =>
        same(row.id, next.article_id),
      );
      if (!article) throw fail("Статья не найдена");
      if (next.kind === "in" && article.section !== "in") {
        throw fail("Поступление — по статье поступлений");
      }
      if (next.kind === "out" && article.section !== "out") {
        throw fail("Выплата — по статье выплат");
      }
      if (next.kind === "accrual" && !article.pnl_line) {
        throw fail("Начисление — по статье, которая входит в ПиУ");
      }
      if (
        !article.is_active &&
        !syncing &&
        (!previous || !same(previous.article_id, next.article_id))
      ) {
        throw fail("Статья в архиве");
      }
    }
    const known = await accounts();
    for (const id of [next.account_id, next.to_account_id]) {
      if (id != null && !known.some((row) => same(row.id, id))) {
        throw fail("Счёт не найден", "23503");
      }
    }
    return {
      ...data,
      kind: next.kind,
      account_id: next.account_id ?? null,
      to_account_id: next.to_account_id ?? null,
      article_id: next.article_id ?? null,
      counterparty: next.counterparty?.trim() || null,
      comment: next.comment?.trim() || null,
    };
  };

  const auditAfter = (resource: string) => ({
    afterCreate: async (result: { data: Record<string, any> }) => {
      if (!syncing) {
        await logAudit({
          entity: AUDITED[resource].entity,
          entity_id: result.data.id,
          action: "create",
          changes: diff(null, result.data, AUDITED[resource].fields),
        });
      }
      return result as any;
    },
    afterUpdate: async (result: { data: Record<string, any> }) => {
      const key = `${resource}${result.data.id}`;
      const previous = previousRows.get(key);
      previousRows.delete(key);
      const changes = diff(previous, result.data, AUDITED[resource].fields);
      if (!syncing && Object.keys(changes).length) {
        await logAudit({
          entity: AUDITED[resource].entity,
          entity_id: result.data.id,
          action: "update",
          changes,
        });
      }
      return result as any;
    },
    afterDelete: async (result: { data: Record<string, any> }) => {
      if (!syncing && result.data) {
        await logAudit({
          entity: AUDITED[resource].entity,
          entity_id: result.data.id,
          action: "delete",
          changes: diff(result.data, null, AUDITED[resource].fields),
        });
      }
      return result as any;
    },
  });

  const readable =
    (check: () => Promise<boolean>) => async (result: GetListResult) =>
      (await check()) ? result : { ...result, data: [], total: 0 };

  const dictionary = (
    resource: "finance_accounts" | "finance_articles",
    label: string,
  ): ResourceCallbacks => ({
    resource,
    afterGetList: readable(canView),
    beforeCreate: async (params) => {
      await checkEdit();
      const name = String(params.data.name ?? "").trim();
      if (!name) throw fail("Укажите название", "23514");
      const rows = await all<{ name: string }>(resource);
      if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
        throw fail(`Такой ${label} уже есть`, "23505");
      }
      return {
        ...params,
        data: {
          is_active: true,
          position: rows.length + 10,
          ...(resource === "finance_accounts"
            ? { kind: "bank", opening_balance: 0, opening_date: null }
            : { activity: "operating", pnl_line: null }),
          ...params.data,
          name,
          code: null,
          created_at: new Date().toISOString(),
        },
      };
    },
    ...auditAfter(resource),
    beforeUpdate: async (params) => {
      await checkEdit();
      const previous = (
        await all<FinanceAccount & FinanceArticle>(resource)
      ).find((row) => same(row.id, params.id));
      if (!previous) throw fail("Не найдено", "P0002");
      const data = { ...params.data };
      if ("code" in data && data.code !== previous.code) {
        throw fail("Код системной записи не меняется");
      }
      if (
        resource === "finance_articles" &&
        previous.code &&
        (["section", "activity", "pnl_line"] as const).some(
          (field) =>
            field in data &&
            (data[field] ?? null) !== (previous[field] ?? null),
        )
      ) {
        throw fail("У системной статьи меняются только название и архив");
      }
      if (data.name !== undefined) {
        const name = String(data.name).trim();
        if (!name) throw fail("Укажите название", "23514");
        data.name = name;
      }
      previousRows.set(`${resource}${params.id}`, previous);
      return { ...params, data };
    },
    beforeDelete: async (params) => {
      await checkEdit();
      const previous = (await all<FinanceAccount>(resource)).find((row) =>
        same(row.id, params.id),
      );
      if (previous?.code) {
        throw fail(
          `Системный ${label} нельзя удалить — только переименовать или убрать в архив`,
        );
      }
      const field =
        resource === "finance_accounts"
          ? ["account_id", "to_account_id"]
          : ["article_id"];
      const used = (await all<FinanceTransaction>("finance_transactions")).some(
        (row) =>
          field.some((key) =>
            same((row as Record<string, any>)[key], params.id),
          ),
      );
      const mapped =
        resource === "finance_accounts"
          ? (await methodRows()).some((row) => same(row.account_id, params.id))
          : false;
      if (used || mapped) throw fail("Запись используется", "23503");
      return params;
    },
  });

  const callbacks: ResourceCallbacks[] = [
    dictionary("finance_accounts", "счёт"),
    dictionary("finance_articles", "статья"),
    {
      resource: "finance_transactions",
      afterGetList: readable(canView),
      beforeCreate: async (params) => {
        if (!syncing) {
          await checkEdit();
          if (
            params.data.payroll_adjustment_id != null ||
            params.data.lab_payment_id != null
          ) {
            throw fail("Связь с выплатой задаёт только система");
          }
        }
        return {
          ...params,
          data: {
            payroll_adjustment_id: null,
            lab_payment_id: null,
            branch_id: null,
            ...params.data,
            ...(syncing ? {} : await checkTransaction(params.data)),
            created_by: syncing
              ? params.data.created_by
              : ((await currentSalesId()) ?? null),
            created_at: new Date().toISOString(),
          },
        };
      },
      ...auditAfter("finance_transactions"),
      beforeUpdate: async (params) => {
        const previous = (
          await all<FinanceTransaction>("finance_transactions")
        ).find((row) => same(row.id, params.id));
        if (!previous) throw fail("Движение не найдено", "P0002");
        if (syncing) return params;
        await checkEdit();
        const data = { ...params.data } as Partial<FinanceTransaction>;
        const linked =
          previous.payroll_adjustment_id != null ||
          previous.lab_payment_id != null;
        if (
          ("payroll_adjustment_id" in data &&
            !same(data.payroll_adjustment_id, previous.payroll_adjustment_id) &&
            (data.payroll_adjustment_id != null ||
              previous.payroll_adjustment_id != null)) ||
          ("lab_payment_id" in data &&
            !same(data.lab_payment_id, previous.lab_payment_id) &&
            (data.lab_payment_id != null || previous.lab_payment_id != null))
        ) {
          throw fail("Связь с выплатой не меняется");
        }
        if (
          linked &&
          ((data.amount !== undefined &&
            Number(data.amount) !== previous.amount) ||
            (data.occurred_on !== undefined &&
              data.occurred_on !== previous.occurred_on) ||
            (data.kind !== undefined && data.kind !== previous.kind))
        ) {
          throw fail(
            "Сумму и дату выплаты меняют в разделе «Зарплаты» или «Лаборатория»",
          );
        }
        previousRows.set(`finance_transactions${params.id}`, previous);
        return { ...params, data: await checkTransaction(data, previous) };
      },
      beforeDelete: async (params) => {
        if (syncing) return params;
        await checkEdit();
        const previous = (
          await all<FinanceTransaction>("finance_transactions")
        ).find((row) => same(row.id, params.id));
        if (
          previous &&
          (previous.payroll_adjustment_id != null ||
            previous.lab_payment_id != null)
        ) {
          throw fail(
            "Это выплата зарплаты или оплата лаборатории: удалите её в разделе «Зарплаты» или «Лаборатория»",
          );
        }
        return params;
      },
    },
    ...MODEL_RESOURCES.map(
      (resource): ResourceCallbacks => ({
        resource,
        afterGetList: readable(canEdit),
        beforeCreate: async (params) => {
          await checkEdit("Финмодель меняют владелец и руководитель");
          const data = { ...params.data };
          if (resource === "finance_models") {
            data.name = String(data.name ?? "").trim();
            if (!data.name) throw fail("Укажите название", "23514");
            data.start_month = monthOf(
              data.start_month ?? todayKey(await timeZone()),
            );
            data.created_by = (await currentSalesId()) ?? null;
            data.created_at = new Date().toISOString();
            data.updated_at = data.created_at;
          }
          if (resource === "finance_model_months") {
            const taken = (await all<FinanceModelMonth>(resource)).some(
              (row) =>
                same(row.model_id, data.model_id) &&
                Number(row.month_index) === Number(data.month_index),
            );
            if (taken) throw fail("Месяц уже задан", "23505");
          }
          if (resource === "finance_model_lines") {
            if (!String(data.name ?? "").trim())
              throw fail("Укажите название", "23514");
            if (Number(data.to_index ?? 11) < Number(data.from_index ?? 0)) {
              throw fail("Месяцы строки", "23514");
            }
          }
          return { ...params, data };
        },
        ...(resource === "finance_models" ? auditAfter(resource) : {}),
        beforeUpdate: async (params) => {
          await checkEdit("Финмодель меняют владелец и руководитель");
          const data = { ...params.data };
          if (resource === "finance_models") {
            if (data.start_month) data.start_month = monthOf(data.start_month);
            data.updated_at = new Date().toISOString();
            const previous = (await all<FinanceModel>(resource)).find((row) =>
              same(row.id, params.id),
            );
            if (previous) previousRows.set(`${resource}${params.id}`, previous);
          }
          return { ...params, data };
        },
        beforeDelete: async (params) => {
          await checkEdit("Финмодель меняют владелец и руководитель");
          if (resource === "finance_models") {
            // The months and the lines go with the model (on delete cascade)
            for (const child of [
              "finance_model_months",
              "finance_model_lines",
            ]) {
              for (const row of await all<{
                id: Identifier;
                model_id: Identifier;
              }>(child)) {
                if (same(row.model_id, params.id)) {
                  await baseDataProvider.delete(child, {
                    id: row.id,
                    previousData: row,
                  });
                }
              }
            }
          }
          return params;
        },
      }),
    ),
    {
      resource: "payroll_adjustments",
      afterCreate: async (result) => {
        await syncPayout(result.data as PayrollAdjustment);
        return result;
      },
      afterUpdate: async (result) => {
        await syncPayout(result.data as PayrollAdjustment);
        return result;
      },
      afterDelete: async (result) => {
        if (result.data)
          await dropLinked("payroll_adjustment_id", result.data.id);
        return result;
      },
    },
    {
      resource: "lab_payments",
      beforeUpdate: async (params) => {
        const previous = (await all<LabPayment>("lab_payments")).find((row) =>
          same(row.id, params.id),
        );
        if (previous)
          previousRows.set(`lab_payments${params.id}`, previous as never);
        return params;
      },
      afterCreate: async (result) => {
        await syncLabPayment(result.data as LabPayment);
        return result;
      },
      afterUpdate: async (result) => {
        const key = `lab_payments${result.data.id}`;
        const previous = previousRows.get(key) as LabPayment | undefined;
        previousRows.delete(key);
        await syncLabPayment(result.data as LabPayment, previous);
        return result;
      },
      afterDelete: async (result) => {
        if (result.data) await dropLinked("lab_payment_id", result.data.id);
        return result;
      },
    },
  ];

  // --- reports ---------------------------------------------------------------

  const movementsUpTo = async (
    to: string | null,
    from: string | null = null,
  ) => {
    const [
      operations,
      transactions,
      arts,
      methods,
      categories,
      adjustments,
      patients,
    ] = await Promise.all([
      all<AccountOperation>("account_operations"),
      all<FinanceTransaction>("finance_transactions"),
      articles(),
      methodRows(),
      all<CashExpenseCategory & { article_id?: Identifier | null }>(
        "cash_expense_categories",
      ),
      all<PayrollAdjustment>("payroll_adjustments"),
      all<Patient>("patients"),
    ]);
    return financeMovements({
      operations,
      transactions,
      articles: arts,
      methodAccounts: methods,
      categories,
      adjustments,
      patients,
      timeZone: await timeZone(),
      from,
      to,
    });
  };

  const pnl = async (
    from: string,
    to: string,
    branchId?: Identifier | null,
  ): Promise<PnlReport> => {
    const tz = await timeZone();
    const [
      plans,
      stages,
      items,
      visits,
      services,
      costs,
      deals,
      operations,
      adjustments,
      doctors,
      adSpend,
      transactions,
      arts,
      chairs,
      lab,
    ] = await Promise.all([
      all<TreatmentPlan>("treatment_plans"),
      all<TreatmentStage>("treatment_stages"),
      all<TreatmentPlanItem>("treatment_plan_items"),
      all<Visit>("visits"),
      all<Service>("services"),
      all<{ service_id: Identifier; cost_price: number }>("service_costs"),
      all<Deal>("deals"),
      all<AccountOperation>("account_operations"),
      all<PayrollAdjustment>("payroll_adjustments"),
      all<Doctor>("doctors"),
      all<AdSpend>("ad_spend"),
      all<FinanceTransaction>("finance_transactions"),
      articles(),
      all<Chair>("chairs"),
      labCosts(),
    ]);
    const months: Record<string, PayrollLine[]> = {};
    for (let month = monthOf(from); month < to; ) {
      months[month] = await payrollLines(month);
      const [y, m] = month.split("-").map(Number);
      month =
        m === 12
          ? `${y + 1}-01-01`
          : `${y}-${String(m + 1).padStart(2, "0")}-01`;
    }
    const facts = pnlFacts(
      {
        plans,
        stages,
        items,
        visits,
        services,
        costs,
        deals,
        timeZone: tz,
        operations,
        labCosts: lab,
        payrollLines: (month) => months[month] ?? [],
        adjustments,
        doctors,
        adSpend,
        movements: await movementsUpTo(to, from),
        transactions,
        articles: arts,
      },
      from,
      to,
    );
    return pnlReport({
      facts,
      from,
      to,
      branchId,
      visits,
      chairs: chairs.map((chair) => ({
        is_active: chair.is_active,
        branch_id:
          (chair as Chair & { branch_id?: Identifier | null }).branch_id ??
          null,
      })),
      timeZone: tz,
    });
  };

  const methods = {
    async getCashFlow(filters: CashFlowFilters) {
      await checkView();
      if (!filters.from || !filters.to || filters.to <= filters.from) {
        throw fail("Укажите период");
      }
      return cashFlowReport({
        movements: await movementsUpTo(filters.to),
        accounts: await accounts(),
        articles: await articles(),
        from: filters.from,
        to: filters.to,
        branchId: filters.branch_id ?? null,
        granularity: filters.granularity ?? "month",
      });
    },
    async getCashFlowMovements(filters: MovementFilters) {
      await checkView();
      return filterMovements(
        await movementsUpTo(filters.to, filters.from),
        filters,
      );
    },
    async getPnl(filters: {
      from: string;
      to: string;
      branch_id?: Identifier | null;
    }) {
      await checkEdit("ПиУ видят только владелец и руководитель");
      const from = monthOf(filters.from);
      const to = monthOf(filters.to);
      if (to <= from) throw fail("Укажите период");
      return pnl(from, to, filters.branch_id ?? null);
    },
    async getFinanceModelReport(
      modelId: Identifier,
      scenario: Scenario = "base",
    ): Promise<FinanceModelReport> {
      await checkEdit("Финмодель видят только владелец и руководитель");
      const model = (await all<FinanceModel>("finance_models")).find((row) =>
        same(row.id, modelId),
      );
      if (!model) throw fail("Модель не найдена", "P0002");
      const plan = computeModel(
        model,
        (await all<FinanceModelMonth>("finance_model_months")).filter((row) =>
          same(row.model_id, modelId),
        ),
        (await all<FinanceModelLine>("finance_model_lines")).filter((row) =>
          same(row.model_id, modelId),
        ),
        scenario,
      );
      const currentMonth = monthOf(todayKey(await timeZone()));
      const range = factRange(model.start_month, currentMonth);
      const fact = range ? await pnl(range.from, range.to, null) : null;
      return {
        ...plan,
        current_month: currentMonth,
        fact: modelFacts(plan, fact, currentMonth),
      };
    },
    async getFinanceMethodAccounts(): Promise<FinanceMethodAccount[]> {
      if (!(await canView())) return [];
      return (await methodRows()).map(({ method, account_id }) => ({
        method,
        account_id,
      }));
    },
    async setFinanceMethodAccount(
      method: FinanceMethod,
      accountId: Identifier,
    ) {
      await checkEdit();
      const row = (await methodRows()).find((r) => r.method === method);
      if (!row) throw fail("Способ не найден", "P0002");
      if (!(await accounts()).some((a) => same(a.id, accountId))) {
        throw fail("Счёт не найден", "23503");
      }
      await baseDataProvider.update("finance_method_accounts", {
        id: row.id,
        data: { account_id: accountId },
        previousData: row,
      });
    },
  };

  return { callbacks, methods };
};
