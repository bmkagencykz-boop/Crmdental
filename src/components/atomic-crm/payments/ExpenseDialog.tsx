import { useQuery } from "@tanstack/react-query";
import {
  useCreate,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { CrmDataProvider } from "../providers/types";
import { NativeSelect, Pills } from "./PaymentDialog";
import { checkExpense, parseAmount } from "./paymentMath";
import {
  EXPENSE_METHODS,
  type AccountOperation,
  type CashShift,
  type ExpenseMethod,
} from "./types";
import {
  money,
  useExpenseCategories,
  usePaymentRights,
  useRefreshMoney,
} from "./usePayments";

/**
 * «Расход» (stage 42): money out of the till without a patient — the
 * amount, the method, the category, a comment. A cash expense comes out
 * of the cashier's open shift (the expected cash goes down).
 */
export const ExpenseDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshMoney();
  const rights = usePaymentRights();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [create, { isPending }] = useCreate<AccountOperation>();
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<ExpenseMethod>("cash");
  const [categoryId, setCategoryId] = useState("");
  const [comment, setComment] = useState("");
  const { data: categories = [] } = useExpenseCategories();
  const active = categories.filter((category) => category.is_active);
  const { data: shifts = [] } = useGetList<CashShift>(
    "cash_shifts",
    {
      filter: { sales_id: rights.me },
      pagination: { page: 1, perPage: 5 },
      sort: { field: "opened_at", order: "DESC" },
    },
    { enabled: open && rights.me != null },
  );
  const shift = shifts.find((s) => !s.closed_at);
  const { data: expected } = useQuery({
    queryKey: ["cash_shifts", "expected", shift?.id],
    queryFn: () => dataProvider.cashShiftExpected(shift!.id),
    enabled: open && shift != null,
  });
  const amount = parseAmount(amountText);
  const problem = checkExpense({
    amount,
    method,
    category_id: categoryId || null,
  });

  const reset = () => {
    setAmountText("");
    setMethod("cash");
    setCategoryId("");
    setComment("");
  };
  const save = () => {
    if (problem) {
      notify(problem, { type: "warning" });
      return;
    }
    create(
      "account_operations",
      {
        data: {
          kind: "expense",
          amount,
          method,
          category_id: categoryId,
          comment: comment.trim() || null,
        },
      },
      {
        onSuccess: () => {
          notify("cash_out.dialog.done", { type: "info" });
          reset();
          onOpenChange(false);
          refresh();
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="rounded-[28px] sm:max-w-lg"
        data-testid="expense-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[24px] font-normal tracking-[-0.02em]">
            {translate("cash_out.dialog.title")}
          </DialogTitle>
          <DialogDescription>
            {translate("cash_out.dialog.hint")}
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("cash_out.dialog.amount")}
          </span>
          <Input
            inputMode="numeric"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-label={translate("cash_out.dialog.amount")}
            className="h-14 text-[28px] font-light tabular-nums"
            autoFocus
          />
        </label>
        <Pills
          label={translate("cash_out.dialog.method")}
          value={method}
          options={EXPENSE_METHODS.map((value) => ({
            value,
            label: translate(`payments.methods.${value}`),
          }))}
          onChange={(value) => setMethod(value as ExpenseMethod)}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("cash_out.dialog.category")}
          </span>
          <NativeSelect
            value={categoryId}
            onChange={setCategoryId}
            aria-label={translate("cash_out.dialog.category")}
          >
            <option value="">
              {translate("cash_out.dialog.choose_category")}
            </option>
            {active.map((category) => (
              <option key={category.id} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("cash_out.dialog.comment")}
          </span>
          <Input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={translate("cash_out.dialog.comment_placeholder")}
            aria-label={translate("cash_out.dialog.comment")}
          />
        </label>
        {method === "cash" ? (
          <p
            className="rounded-2xl bg-muted px-4 py-2.5 text-sm text-muted-foreground"
            data-testid="expense-shift-hint"
          >
            {shift
              ? translate("cash_out.dialog.in_shift", {
                  amount: money((expected ?? shift.opening_cash) - amount),
                })
              : translate("cash_out.dialog.no_shift")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate("ra.action.cancel")}
          </Button>
          <Button disabled={isPending || !!problem} onClick={save}>
            {translate("cash_out.dialog.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
