import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { StudioCard } from "../dashboard/StudioCards";
import { Sphere3D } from "../misc/Dental3D";
import { OperationsList } from "./OperationsList";
import { expenseTotals } from "./paymentMath";
import type { AccountOperationSummary, CashExpenseCategory } from "./types";
import {
  money,
  useExpenseCategories,
  usePaymentRights,
  useRefreshMoney,
} from "./usePayments";
import { CountUp } from "../misc/CountUp";

const pad = (n: number) => String(n).padStart(2, "0");
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
};
const shift = (month: string, by: number) => {
  const date = new Date(`${month}T00:00:00`);
  date.setMonth(date.getMonth() + by);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
};

/**
 * «Расходы» of the cash desk (stage 42): the month by category (hatched
 * leader, the cash part), its expenses, and the categories of the clinic
 * (the owner and the head add, rename, archive).
 */
export const ExpensesTab = ({ onExpense }: { onExpense?: () => void }) => {
  const translate = useTranslate();
  const rights = usePaymentRights();
  const [month, setMonth] = useState(thisMonth);
  const from = new Date(`${month}T00:00:00`).toISOString();
  const to = new Date(`${shift(month, 1)}T00:00:00`).toISOString();
  const { data: categories = [] } = useExpenseCategories();
  const { data: expenses = [], isPending } =
    useGetList<AccountOperationSummary>("account_operations_summary", {
      filter: {
        kind: "expense",
        "occurred_at@gte": from,
        "occurred_at@lt": to,
        ...(rights.seesAll ? {} : { sales_id: rights.me }),
      },
      sort: { field: "occurred_at", order: "DESC" },
      pagination: { page: 1, perPage: 1000 },
    });
  const rows = useMemo(
    () => expenseTotals(expenses, categories),
    [expenses, categories],
  );
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const cash = rows.reduce((sum, row) => sum + row.cash, 0);
  const max = Math.max(1, ...rows.map((row) => row.amount));
  const title = new Date(`${month}T00:00:00`).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-5" data-testid="expenses-tab">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMonth(shift(month, -1))}
          aria-label={translate("cash_out.month.prev")}
          title={translate("cash_out.month.prev")}
        >
          ‹
        </Button>
        <h2 className="min-w-44 text-center text-[22px] font-normal tracking-[-0.02em] first-letter:uppercase">
          {title}
        </h2>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setMonth(shift(month, 1))}
          aria-label={translate("cash_out.month.next")}
          title={translate("cash_out.month.next")}
        >
          ›
        </Button>
        {onExpense ? (
          <Button className="ml-auto" onClick={onExpense}>
            {translate("cash_out.action")}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section
          className="relative flex min-h-[15rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink lg:col-span-4"
          aria-label={translate("cash_out.month.title")}
        >
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {translate("cash_out.month.title")}
          </h2>
          <p className="mt-1 text-sm opacity-80">
            {translate("cash_out.month.cash", { amount: money(cash) })}
          </p>
          <p
            className="mt-auto text-[48px] leading-none font-light tracking-[-0.04em] tabular-nums"
            data-testid="expenses-total"
          >
            <CountUp>{money(total)}</CountUp>
          </p>
          <Sphere3D tone="soft" size={96} style={{ right: -18, top: -18 }} />
        </section>

        <StudioCard
          title={translate("cash_out.report.title")}
          subtitle={translate("cash_out.month.hint")}
          className="lg:col-span-8"
        >
          {isPending ? null : rows.length ? (
            <ul
              className="flex flex-col gap-2.5"
              data-testid="expenses-by-category"
            >
              {rows.map((row, index) => (
                <li key={row.category_id} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm">
                    {row.name}
                  </span>
                  <span className="relative h-9 flex-1 overflow-hidden rounded-xl bg-muted">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-xl",
                        index === 0
                          ? "hatch border border-foreground/15 bg-pill"
                          : "bg-pill",
                      )}
                      style={{
                        width: `${Math.max((row.amount / max) * 100, 6)}%`,
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm tabular-nums">
                      {money(row.amount)}
                    </span>
                  </span>
                  <span className="w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                    {row.cash
                      ? translate("cash_out.month.cash", {
                          amount: money(row.cash),
                        })
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {translate("cash_out.month.empty")}
            </p>
          )}
        </StudioCard>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <StudioCard
          title={translate("cash_out.month.operations")}
          subtitle={title}
          className={rights.canEdit ? "lg:col-span-8" : "lg:col-span-12"}
        >
          {isPending ? null : (
            <OperationsList
              operations={expenses}
              empty={translate("cash_out.month.empty")}
            />
          )}
        </StudioCard>
        {rights.canEdit ? (
          <CategoriesCard categories={categories} className="lg:col-span-4" />
        ) : null}
      </div>
    </div>
  );
};

/** The categories of the clinic: add, rename, archive / restore, delete */
const CategoriesCard = ({
  categories,
  className,
}: {
  categories: CashExpenseCategory[];
  className?: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshMoney();
  const [create] = useCreate();
  const [update] = useUpdate();
  const [remove] = useDelete();
  const [name, setName] = useState("");
  const onError = (error: any) =>
    notify(error?.message || "ra.notification.http_error", { type: "error" });
  const onSuccess = () => {
    notify("cash_out.categories.saved", { type: "info" });
    refresh();
  };
  const add = () => {
    if (!name.trim()) return;
    create(
      "cash_expense_categories",
      { data: { name: name.trim(), position: categories.length } },
      {
        onSuccess: () => {
          setName("");
          onSuccess();
        },
        onError,
      },
    );
  };
  return (
    <StudioCard
      title={translate("cash_out.categories.title")}
      subtitle={translate("cash_out.categories.hint")}
      className={className}
    >
      <ul className="flex flex-col gap-1.5" data-testid="expense-categories">
        {categories.map((category) => (
          <li
            key={category.id}
            className={cn(
              "flex items-center gap-2 rounded-2xl bg-muted/60 px-3 py-2 text-sm",
              !category.is_active && "opacity-60",
            )}
          >
            <Input
              defaultValue={category.name}
              aria-label={translate("cash_out.categories.name")}
              className="h-8 flex-1 bg-card"
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== category.name) {
                  update(
                    "cash_expense_categories",
                    {
                      id: category.id,
                      data: { name: next },
                      previousData: category,
                    },
                    { mutationMode: "pessimistic", onSuccess, onError },
                  );
                }
              }}
            />
            {category.code ? (
              <span className="text-[11px] text-muted-foreground">
                {translate("cash_out.categories.system")}
              </span>
            ) : null}
            <button
              type="button"
              className="rounded-full bg-card px-3 py-1 text-xs hover:bg-pill"
              onClick={() =>
                update(
                  "cash_expense_categories",
                  {
                    id: category.id,
                    data: { is_active: !category.is_active },
                    previousData: category,
                  },
                  { mutationMode: "pessimistic", onSuccess, onError },
                )
              }
            >
              {category.is_active
                ? translate("cash_out.categories.archive")
                : translate("cash_out.categories.restore")}
            </button>
            {!category.code ? (
              <button
                type="button"
                className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-tone-red"
                aria-label={translate("cash_out.categories.delete")}
                title={translate("cash_out.categories.delete")}
                onClick={() => {
                  if (
                    !window.confirm(
                      translate("cash_out.categories.delete_confirm", {
                        name: category.name,
                      }),
                    )
                  ) {
                    return;
                  }
                  remove(
                    "cash_expense_categories",
                    { id: category.id, previousData: category },
                    { mutationMode: "pessimistic", onSuccess, onError },
                  );
                }}
              >
                ×
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={translate("cash_out.categories.placeholder")}
          aria-label={translate("cash_out.categories.name")}
          onKeyDown={(event) => event.key === "Enter" && add()}
        />
        <Button variant="outline" onClick={add} disabled={!name.trim()}>
          {translate("cash_out.categories.add")}
        </Button>
      </div>
    </StudioCard>
  );
};
