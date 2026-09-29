import type { Identifier } from "ra-core";

import { addMonths, monthOf } from "../../../finance/financeMath";
import type {
  ArticleActivity,
  ArticleCode,
  ArticleSection,
  FinanceAccount,
  FinanceMethod,
  FinanceModel,
  FinanceModelLine,
  FinanceModelMonth,
  FinanceTransaction,
  PnlLine,
} from "../../../finance/types";
import { dayKeyOf, todayKey } from "../../../tasks/calendarLayout";
import type { Db } from "./types";

/** The accounts every clinic starts with (private.seed_finance) */
export const DEFAULT_FINANCE_ACCOUNTS: Omit<FinanceAccount, "id">[] = [
  {
    name: "Касса",
    kind: "cash",
    code: "till",
    opening_balance: 0,
    opening_date: null,
    is_active: true,
    position: 0,
  },
  {
    name: "Kaspi",
    kind: "kaspi",
    code: "kaspi",
    opening_balance: 0,
    opening_date: null,
    is_active: true,
    position: 1,
  },
  {
    name: "Банк",
    kind: "bank",
    code: "bank",
    opening_balance: 0,
    opening_date: null,
    is_active: true,
    position: 2,
  },
];

export const DEFAULT_METHOD_ACCOUNTS: Record<
  FinanceMethod,
  "till" | "kaspi" | "bank"
> = {
  cash: "till",
  card: "kaspi",
  kaspi_qr: "kaspi",
  kaspi_transfer: "kaspi",
  bank_transfer: "bank",
  insurance: "bank",
  other: "bank",
};

/** The articles every clinic starts with (private.seed_finance) */
export const DEFAULT_FINANCE_ARTICLES: [
  string,
  ArticleCode,
  ArticleSection,
  ArticleActivity,
  PnlLine | null,
  number,
][] = [
  ["Оплата услуг", "services", "in", "operating", "revenue", 0],
  ["Предоплаты и депозиты", "prepayments", "in", "operating", null, 1],
  ["Возвраты пациентам", "refunds", "in", "operating", null, 2],
  ["Прочие поступления", "other_in", "in", "operating", "other_income", 3],
  ["Кредиты и займы полученные", "loans_in", "in", "financing", null, 4],
  ["Вклад собственника", "owner_in", "in", "financing", null, 5],
  ["Зарплата врачей", "salary_doctors", "out", "operating", "doctors", 10],
  ["Зарплата персонала", "salary_staff", "out", "operating", "staff", 11],
  ["Лаборатория", "lab", "out", "operating", "lab", 12],
  ["Материалы", "materials", "out", "operating", "materials", 13],
  ["Аренда", "rent", "out", "operating", "opex", 14],
  ["Коммунальные услуги", "utilities", "out", "operating", "opex", 15],
  ["Маркетинг", "marketing", "out", "operating", "marketing", 16],
  ["Налоги", "taxes", "out", "operating", "tax", 17],
  ["Кредиты и лизинг", "loans", "out", "financing", null, 18],
  ["Проценты по кредитам", "interest", "out", "financing", "interest", 19],
  ["Оборудование и ремонт", "equipment", "out", "investing", null, 20],
  ["Дивиденды и вывод собственника", "dividends", "out", "financing", null, 21],
  ["Амортизация", "depreciation", "out", "operating", "depreciation", 22],
  ["Прочие выплаты", "other_out", "out", "operating", "opex", 23],
];

const CATEGORY_ARTICLES: Record<string, ArticleCode> = {
  salary: "salary_staff",
  lab: "lab",
  materials: "materials",
  rent: "rent",
  other: "other_out",
};

/** Almaty: a summer dip, peaks in March and before the New Year */
const SEASON = [
  0.86, 0.95, 1.08, 1.04, 1.0, 0.94, 0.82, 0.8, 1.0, 1.06, 1.1, 1.15,
];

const round = (value: number, step = 1000) => Math.round(value / step) * step;

/**
 * Finance of the demo (stage 44): the accounts, the articles, the method
 * map, the categories of the cash desk mapped to articles, the transactions
 * of the payouts and the lab payments paid without the cash desk — like
 * private.seed_finance and the sync triggers — and a year of history.
 *
 * The demo clinic moved to the CRM this month; before that its MIS gives
 * monthly totals: «Итоги МИС» — revenue, materials, lab, doctors' and
 * staff pay as accruals (the P&L) and the receipts of the month as money
 * in (the ДДС); the bank pays the rent, salaries, the lab, materials,
 * taxes, the leasing and the dividends; the cash desk and Kaspi are taken
 * to the bank every month. ~5 doctors in Almaty, 20–40 млн ₸ a month.
 * Runs after the cash outflows.
 */
export const generateFinance = (db: Db) => {
  const tz = db.organizations?.[0]?.timezone || "Asia/Almaty";
  const today = todayKey(tz);
  const current = monthOf(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(
    Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)), 0),
  ).getUTCDate();

  db.finance_accounts = DEFAULT_FINANCE_ACCOUNTS.map((account, index) => ({
    ...account,
    id: index + 1,
    created_at: new Date().toISOString(),
  }));
  const account = (code: string) =>
    db.finance_accounts.find((row) => row.code === code)!.id;
  db.finance_method_accounts = (
    Object.entries(DEFAULT_METHOD_ACCOUNTS) as [FinanceMethod, string][]
  ).map(([method, code]) => ({
    id: method,
    method,
    account_id: account(code),
  }));
  db.finance_articles = DEFAULT_FINANCE_ARTICLES.map(
    ([name, code, section, activity, pnl_line, position], index) => ({
      id: index + 1,
      name,
      code,
      section,
      activity,
      pnl_line,
      is_active: true,
      position,
      created_at: new Date().toISOString(),
    }),
  );
  const article = (code: ArticleCode) =>
    db.finance_articles.find((row) => row.code === code)!.id;
  for (const category of db.cash_expense_categories) {
    const code = category.code ? CATEGORY_ARTICLES[category.code] : undefined;
    (
      category as typeof category & { article_id?: Identifier | null }
    ).article_id = code ? article(code) : null;
  }

  const transactions: FinanceTransaction[] = [];
  const owner = db.sales.find((sale) => sale.role === "owner") ?? db.sales[0];
  const add = (
    row: Omit<FinanceTransaction, "id" | "created_at" | "created_by"> & {
      created_by?: Identifier | null;
    },
  ) => {
    if (row.amount <= 0 || row.occurred_on > today) return;
    transactions.push({
      counterparty: null,
      comment: null,
      branch_id: null,
      to_account_id: null,
      payroll_adjustment_id: null,
      lab_payment_id: null,
      created_by: owner?.id ?? null,
      ...row,
      id: transactions.length + 1,
      created_at: `${row.occurred_on}T09:00:00.000Z`,
    });
  };

  // The linked transactions of what was paid without the cash desk
  for (const payout of db.payroll_adjustments) {
    if (payout.kind !== "payout" || payout.account_operation_id != null)
      continue;
    const doctor = db.doctors.find(
      (d) => String(d.id) === String(payout.doctor_id),
    );
    const sale = db.sales.find((s) => String(s.id) === String(payout.sales_id));
    add({
      kind: "out",
      occurred_on: payout.occurred_on,
      account_id: account("bank"),
      article_id: article(
        payout.doctor_id != null ? "salary_doctors" : "salary_staff",
      ),
      amount: payout.amount,
      counterparty:
        doctor?.name ??
        ([sale?.first_name, sale?.last_name].filter(Boolean).join(" ") || null),
      comment: [
        `Зарплата за ${payout.month.slice(5, 7)}.${payout.month.slice(0, 4)}`,
        payout.note,
      ]
        .filter(Boolean)
        .join(" — "),
      payroll_adjustment_id: payout.id,
      created_by: payout.created_by ?? null,
    });
  }
  for (const payment of db.lab_payments) {
    if (payment.account_operation_id != null) continue;
    const lab = db.labs.find(
      (row) => String(row.id) === String(payment.lab_id),
    );
    const method = payment.method as FinanceMethod;
    add({
      kind: "out",
      occurred_on: dayKeyOf(payment.paid_at, tz),
      account_id: account(DEFAULT_METHOD_ACCOUNTS[method] ?? "bank"),
      article_id: article("lab"),
      amount: payment.amount,
      counterparty: lab?.name ?? null,
      comment: [
        `Лаборатория за ${payment.month.slice(5, 7)}.${payment.month.slice(0, 4)}`,
        payment.comment,
      ]
        .filter(Boolean)
        .join(" — "),
      lab_payment_id: payment.id,
      created_by: payment.created_by ?? null,
    });
  }

  // A year of history («Итоги МИС») and the bank
  const first = addMonths(current, -11);
  const day = (month: string, d: number) =>
    `${month.slice(0, 8)}${String(Math.min(d, 28)).padStart(2, "0")}`;
  const label = (month: string) => `${month.slice(5, 7)}.${month.slice(0, 4)}`;
  const revenueOf = (month: string, index: number) => {
    const season = SEASON[Number(month.slice(5, 7)) - 1];
    const growth = 0.88 + (index / 11) * 0.16;
    return round(29_000_000 * season * growth, 10_000);
  };
  let previousRevenue = revenueOf(addMonths(first, -1), -1);
  for (let index = 0; index < 12; index++) {
    const month = addMonths(first, index);
    const partial = month === current;
    // The current month: what the MIS has so far (the rest is the CRM's)
    const share = partial ? (dayOfMonth / daysInMonth) * 0.6 : 1;
    const revenue = round(revenueOf(month, index) * share, 10_000);
    const mis = `Итоги МИС за ${label(month)}`;
    const accrual = (
      code: ArticleCode,
      amount: number,
      branch: Identifier | null = null,
    ) =>
      add({
        kind: "accrual",
        occurred_on: partial ? today : day(month, 28),
        account_id: null,
        article_id: article(code),
        amount: round(amount),
        comment: mis,
        branch_id: branch,
      });
    accrual("services", revenue);
    accrual("materials", revenue * 0.075);
    accrual("lab", revenue * 0.09);
    accrual("salary_doctors", revenue * 0.33);
    accrual("salary_staff", partial ? 0 : 3_300_000);
    accrual("depreciation", partial ? 0 : 350_000);

    // Money in: the receipts of the month
    add({
      kind: "in",
      occurred_on: partial ? today : day(month, 28),
      account_id: account("kaspi"),
      article_id: article("services"),
      amount: round(revenue * 0.55),
      comment: `${mis}: Kaspi`,
    });
    add({
      kind: "in",
      occurred_on: partial ? today : day(month, 28),
      account_id: account("till"),
      article_id: article("services"),
      amount: round(revenue * 0.18),
      comment: `${mis}: наличные`,
    });
    add({
      kind: "in",
      occurred_on: partial ? today : day(month, 28),
      account_id: account("bank"),
      article_id: article("services"),
      amount: round(revenue * 0.25),
      comment: `${mis}: карты и страховые`,
    });
    add({
      kind: "in",
      occurred_on: partial ? today : day(month, 28),
      account_id: account("kaspi"),
      article_id: article("prepayments"),
      amount: round(revenue * 0.04),
      comment: `${mis}: предоплаты`,
    });

    // The bank
    const out = (
      code: ArticleCode,
      d: number,
      amount: number,
      counterparty: string | null,
      extra: Partial<FinanceTransaction> = {},
    ) =>
      add({
        kind: "out",
        occurred_on: day(month, d),
        account_id: account("bank"),
        article_id: article(code),
        amount: round(amount),
        counterparty,
        comment: label(month),
        ...extra,
      });
    out("rent", 3, 1_400_000, "ТОО «Достык Плаза»", {
      branch_id: db.branches?.[0]?.id ?? null,
    });
    if (db.branches?.[1])
      out("rent", 3, 800_000, "ИП Абдрахманов", {
        branch_id: db.branches[1].id,
      });
    out(
      "salary_doctors",
      7,
      previousRevenue * 0.33 * 0.97,
      "Врачи: зарплата за прошлый месяц",
    );
    out("salary_staff", 7, 3_300_000, "Персонал: зарплата за прошлый месяц");
    out("lab", 12, previousRevenue * 0.09, "Дентал-Арт, Zirkon Lab");
    out("materials", 15, revenue * 0.075 + 150_000, "ТОО «Стома-Трейд»");
    out(
      "utilities",
      20,
      330_000 + (index % 3) * 20_000,
      "Алматыэнергосбыт, АлСеко",
    );
    out("marketing", 10, 900_000, "Instagram, 2GIS, SEO");
    out("taxes", 25, revenue * 0.05, "КГД: ИПН, СН, ОПВ, ОСМС");
    out("other_out", 18, 600_000, "IT, клининг, банковские комиссии");
    out("loans", 22, 650_000, "Halyk Leasing: КЛКТ");
    out("interest", 22, 180_000, "Halyk Leasing");
    if (index % 3 === 2)
      out("dividends", 26, 3_000_000, "Собственник", {
        account_id: account("bank"),
      });
    if (index === 2) {
      add({
        kind: "in",
        occurred_on: day(month, 4),
        account_id: account("bank"),
        article_id: article("loans_in"),
        amount: 8_000_000,
        counterparty: "Halyk Leasing",
        comment: "Лизинг: компьютерный томограф",
      });
      out("equipment", 6, 7_800_000, "Vatech: КЛКТ Green X");
    }
    // Cash collection and Kaspi to the bank
    add({
      kind: "transfer",
      occurred_on: day(month, 28),
      account_id: account("till"),
      to_account_id: account("bank"),
      article_id: null,
      amount: round(revenue * 0.16),
      comment: "Инкассация",
    });
    add({
      kind: "transfer",
      occurred_on: day(month, 28),
      account_id: account("kaspi"),
      to_account_id: account("bank"),
      article_id: null,
      amount: round(revenue * 0.55),
      comment: "Вывод Kaspi на счёт",
    });
    previousRevenue = revenue;
  }
  db.finance_transactions = transactions;
  // Opening balances at the start of the year of history
  db.finance_accounts[0].opening_balance = 350_000;
  db.finance_accounts[0].opening_date = first;
  db.finance_accounts[1].opening_balance = 1_200_000;
  db.finance_accounts[1].opening_date = first;
  db.finance_accounts[2].opening_balance = 6_500_000;
  db.finance_accounts[2].opening_date = first;

  // «Финмодель»: the budget of the year and a forecast with a fourth chair
  const yearStart = `${current.slice(0, 4)}-01-01`;
  const nextMonth = addMonths(current, 1);
  const base = {
    chairs: 3,
    working_days: 26,
    hours_per_day: 12,
    utilization: 75,
    visits_per_chair_hour: 0.9,
    avg_check: 45_000,
    optimistic_factor: 1.15,
    pessimistic_factor: 0.85,
    note: null,
    created_by: owner?.id ?? null,
    created_at: `${yearStart}T09:00:00.000Z`,
    updated_at: `${yearStart}T09:00:00.000Z`,
  };
  db.finance_models = [
    {
      ...base,
      id: 1,
      name: `Бюджет ${current.slice(0, 4)}`,
      start_month: yearStart,
      opening_cash: 12_000_000,
      investment_amount: 0,
      investment_month: 0,
    },
    {
      ...base,
      id: 2,
      name: "Прогноз: четвёртое кресло",
      start_month: nextMonth,
      utilization: 78,
      avg_check: 47_000,
      opening_cash: 15_000_000,
      investment_amount: 9_000_000,
      investment_month: 1,
      note: "Установка в филиале на Абая",
    },
  ] satisfies FinanceModel[];
  const lines: Omit<FinanceModelLine, "id" | "model_id">[] = [
    {
      name: "Врачи",
      pnl_line: "doctors",
      kind: "percent",
      amount: 0,
      percent: 33,
      from_index: 0,
      to_index: 11,
      position: 0,
    },
    {
      name: "Лаборатория",
      pnl_line: "lab",
      kind: "percent",
      amount: 0,
      percent: 9,
      from_index: 0,
      to_index: 11,
      position: 1,
    },
    {
      name: "Материалы",
      pnl_line: "materials",
      kind: "percent",
      amount: 0,
      percent: 7.5,
      from_index: 0,
      to_index: 11,
      position: 2,
    },
    {
      name: "Персонал",
      pnl_line: "staff",
      kind: "fixed",
      amount: 3_900_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 3,
    },
    {
      name: "Аренда",
      pnl_line: "opex",
      kind: "fixed",
      amount: 2_200_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 4,
    },
    {
      name: "Коммунальные",
      pnl_line: "opex",
      kind: "fixed",
      amount: 350_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 5,
    },
    {
      name: "Маркетинг",
      pnl_line: "marketing",
      kind: "fixed",
      amount: 1_300_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 6,
    },
    {
      name: "Прочие расходы",
      pnl_line: "opex",
      kind: "fixed",
      amount: 600_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 7,
    },
    {
      name: "Налоги",
      pnl_line: "tax",
      kind: "percent",
      amount: 0,
      percent: 5,
      from_index: 0,
      to_index: 11,
      position: 8,
    },
    {
      name: "Проценты по лизингу",
      pnl_line: "interest",
      kind: "fixed",
      amount: 180_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 9,
    },
    {
      name: "Амортизация",
      pnl_line: "depreciation",
      kind: "fixed",
      amount: 350_000,
      percent: 0,
      from_index: 0,
      to_index: 11,
      position: 10,
    },
  ];
  db.finance_model_lines = [1, 2]
    .flatMap((modelId) => lines.map((line) => ({ ...line, model_id: modelId })))
    .map((line, index) => ({ ...line, id: index + 1 }));
  // The fourth chair's assistant and its depreciation from month 3
  db.finance_model_lines.push(
    {
      id: db.finance_model_lines.length + 1,
      model_id: 2,
      name: "Ассистент 4-го кресла",
      pnl_line: "staff",
      kind: "fixed",
      amount: 350_000,
      percent: 0,
      from_index: 2,
      to_index: 11,
      position: 11,
    },
    {
      id: db.finance_model_lines.length + 2,
      model_id: 2,
      name: "Амортизация кресла",
      pnl_line: "depreciation",
      kind: "fixed",
      amount: 150_000,
      percent: 0,
      from_index: 2,
      to_index: 11,
      position: 12,
    },
  );
  const months: FinanceModelMonth[] = [];
  // The budget: the summer dip
  for (const [index, utilization] of [
    [6, 64],
    [7, 62],
  ] as const) {
    months.push({
      id: months.length + 1,
      model_id: 1,
      month_index: index,
      utilization,
    });
  }
  // The forecast: four chairs from month 3, a slower start
  for (let index = 2; index < 12; index++) {
    months.push({
      id: months.length + 1,
      model_id: 2,
      month_index: index,
      chairs: 4,
      utilization: index === 2 ? 62 : index === 3 ? 70 : null,
    });
  }
  db.finance_model_months = months;
};
