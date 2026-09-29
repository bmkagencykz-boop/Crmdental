import { useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useDelete,
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

import { StudioCard } from "../dashboard/StudioCards";
import { Pills } from "../payments/PaymentDialog";
import { parseAmount } from "../payments/paymentMath";
import { EXPENSE_METHODS } from "../payments/types";
import { useRefreshMoney } from "../payments/usePayments";
import type { CrmDataProvider } from "../providers/types";
import { localDay, shortDay, tenge } from "./labMath";
import {
  LAB_PAYMENT_METHODS,
  type LabOrderBalance,
  type LabPaymentMethod,
  type LabPaymentSummary,
  type LabSettlementRow,
} from "./types";

const useMethodName = () => {
  const translate = useTranslate();
  return (method: string) =>
    method === "other"
      ? translate("cash_out.lab.methods.other")
      : translate(`payments.methods.${method}`);
};

/** Refresh the settlement and the cash desk after a lab payment */
const useRefreshLabPayments = () => {
  const queryClient = useQueryClient();
  const refreshMoney = useRefreshMoney();
  return () => {
    for (const key of [
      "lab_payments_summary",
      "lab_payments",
      // Stage 43
      "lab_payment_allocations",
      "lab_order_balances",
      "lab_orders_summary",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    return refreshMoney();
  };
};

/**
 * «Оплатить» a lab for the month of the settlement (stage 42): the amount
 * (the balance by default), the method, the day, a comment and «Из кассы» —
 * the expense «Лаборатория» in the cashier's open shift
 */
export const LabPaymentDialog = ({
  row,
  month,
  monthTitle,
  onClose,
}: {
  row: LabSettlementRow;
  month: string;
  monthTitle: string;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const methodName = useMethodName();
  const refresh = useRefreshLabPayments();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [amount, setAmount] = useState(
    row.total_balance > 0 ? String(row.total_balance) : "",
  );
  const [method, setMethod] = useState<LabPaymentMethod>("bank_transfer");
  const [fromCash, setFromCash] = useState(false);
  const [day, setDay] = useState(localDay());
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  // Stage 43: the orders it pays (optional)
  const [allocate, setAllocate] = useState(false);
  const [parts, setParts] = useState<Record<string, string>>({});
  const { data: balances = [] } = useGetList<LabOrderBalance>(
    "lab_order_balances",
    {
      filter: { lab_id: row.lab_id, "due@gt": 0 },
      pagination: { page: 1, perPage: 500 },
      sort: { field: "number", order: "ASC" },
    },
    { enabled: allocate },
  );
  const allocations = Object.entries(parts)
    .map(([order_id, text]) => ({ order_id, amount: parseAmount(text) }))
    .filter((part) => part.amount > 0);
  const allocated = allocations.reduce((sum, part) => sum + part.amount, 0);
  const value = parseAmount(amount);
  /** «По порядку»: the oldest orders first, up to the amount */
  const fillInOrder = () => {
    let left = value;
    const next: Record<string, string> = {};
    for (const balance of [...balances].sort((a, b) =>
      (a.billed_on ?? "9999").localeCompare(b.billed_on ?? "9999"),
    )) {
      if (left <= 0) break;
      const part = Math.min(left, balance.due);
      next[String(balance.id)] = String(part);
      left -= part;
    }
    setParts(next);
  };
  // From the cash desk: the methods money leaves the till by
  const methods: readonly LabPaymentMethod[] = fromCash
    ? EXPENSE_METHODS
    : LAB_PAYMENT_METHODS;

  const save = async () => {
    if (!(value > 0)) return;
    setSaving(true);
    try {
      await dataProvider.recordLabPayment({
        lab_id: row.lab_id,
        month,
        amount: value,
        method,
        day,
        comment: comment.trim() || null,
        fromCash,
        allocations: allocate ? allocations : undefined,
      });
      notify("cash_out.lab.done", { type: "info" });
      await refresh();
      onClose();
    } catch (error) {
      notify((error as Error)?.message || "ra.notification.http_error", {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="rounded-[28px] sm:max-w-lg"
        data-testid="lab-payment-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[24px] font-normal tracking-[-0.02em]">
            {translate("cash_out.lab.title")} · {row.lab_name}
          </DialogTitle>
          <DialogDescription>
            {translate("cash_out.lab.hint", {
              month: monthTitle,
              owed: tenge(row.amount),
              paid: tenge(row.paid),
            })}
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("cash_out.lab.amount")}
          </span>
          <Input
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-label={translate("cash_out.lab.amount")}
            className="h-14 text-[28px] font-light tabular-nums"
            autoFocus
          />
        </label>
        <Pills
          label={translate("cash_out.lab.from_cash")}
          value={fromCash ? "cash" : "bank"}
          options={[
            { value: "bank", label: translate("cash_out.payout.bank") },
            { value: "cash", label: translate("cash_out.lab.from_cash") },
          ]}
          onChange={(next) => {
            const cash = next === "cash";
            setFromCash(cash);
            setMethod(cash ? "cash" : "bank_transfer");
          }}
        />
        {fromCash ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            {translate("cash_out.lab.from_cash_hint")}
          </p>
        ) : null}
        <Pills
          label={translate("cash_out.lab.method")}
          value={method}
          options={methods.map((option) => ({
            value: option,
            label: methodName(option),
          }))}
          onChange={(next) => setMethod(next as LabPaymentMethod)}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("cash_out.lab.date")}
            </span>
            <Input
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value || localDay())}
              aria-label={translate("cash_out.lab.date")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("cash_out.lab.comment")}
            </span>
            <Input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={translate("cash_out.lab.comment_placeholder")}
              aria-label={translate("cash_out.lab.comment")}
            />
          </label>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allocate}
              onChange={(event) => setAllocate(event.target.checked)}
              data-testid="lab-payment-allocate"
            />
            {translate("lab_plus.allocation.toggle")}
          </label>
          {allocate ? (
            balances.length ? (
              <>
                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                  {balances.map((balance) => (
                    <li
                      key={balance.id}
                      className="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5 text-sm"
                    >
                      <span className="w-14 shrink-0 tabular-nums">
                        № {balance.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {balance.patient_name ?? "—"}
                        <span className="block text-xs text-muted-foreground">
                          {translate("lab_plus.allocation.due", {
                            amount: tenge(balance.due),
                          })}
                        </span>
                      </span>
                      <Input
                        inputMode="numeric"
                        value={parts[String(balance.id)] ?? ""}
                        placeholder="0"
                        onChange={(event) =>
                          setParts((current) => ({
                            ...current,
                            [String(balance.id)]: event.target.value,
                          }))
                        }
                        aria-label={translate("lab_plus.allocation.amount", {
                          number: balance.number,
                        })}
                        className="h-9 w-28 text-right tabular-nums"
                      />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={fillInOrder}
                    disabled={!(value > 0)}
                  >
                    {translate("lab_plus.allocation.fill")}
                  </Button>
                  <span
                    className={
                      allocated > value
                        ? "text-tone-red"
                        : "text-muted-foreground"
                    }
                  >
                    {translate("lab_plus.allocation.total", {
                      allocated: tenge(allocated),
                      rest: tenge(Math.max(0, value - allocated)),
                    })}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate("lab_plus.allocation.none")}
              </p>
            )
          ) : null}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            disabled={saving || !(value > 0) || (allocate && allocated > value)}
            onClick={save}
            data-testid="lab-payment-save"
          >
            {translate("cash_out.lab.pay")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** The payments of the month: lab, day, method («из кассы»), amount, × */
export const LabPaymentsCard = ({
  payments,
  subtitle,
  className,
}: {
  payments: LabPaymentSummary[];
  subtitle: string;
  className?: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const methodName = useMethodName();
  const refresh = useRefreshLabPayments();
  const [remove] = useDelete();
  return (
    <StudioCard
      title={translate("cash_out.lab.payments")}
      subtitle={subtitle}
      className={className}
    >
      {payments.length ? (
        <ul className="flex flex-col gap-1.5" data-testid="lab-payments">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-2.5 text-sm"
            >
              <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                {shortDay(localDay(new Date(payment.paid_at)))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{payment.lab_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[
                    methodName(payment.method),
                    payment.account_operation_id != null
                      ? translate("cash_out.lab.in_cash")
                      : null,
                    payment.comment,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="text-base font-light whitespace-nowrap tabular-nums">
                {tenge(payment.amount)}
              </span>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-tone-red"
                aria-label={translate("cash_out.lab.delete")}
                title={translate("cash_out.lab.delete")}
                onClick={() => {
                  if (!window.confirm(translate("cash_out.lab.delete_confirm")))
                    return;
                  remove(
                    "lab_payments",
                    { id: payment.id, previousData: payment },
                    {
                      mutationMode: "pessimistic",
                      onSuccess: () => {
                        notify("cash_out.lab.deleted", { type: "info" });
                        refresh();
                      },
                      onError: (error) =>
                        notify(
                          (error as Error)?.message ||
                            "ra.notification.http_error",
                          { type: "error" },
                        ),
                    },
                  );
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">
          {translate("cash_out.lab.no_payments")}
        </p>
      )}
    </StudioCard>
  );
};
