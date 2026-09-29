import { useDelete, useNotify, useTranslate } from "ra-core";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { operationSign, useMethodLabel } from "./operationFormat";
import type { AccountOperationSummary } from "./types";
import {
  money,
  useMoneyDocuments,
  usePaymentRights,
  useRefreshMoney,
} from "./usePayments";

const time = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Operations of an account, a deal or a day: when, what, how, how much,
 * who; «Квитанция» and, for the owner and the head, «Отменить».
 */
export const OperationsList = ({
  operations,
  showPatient = false,
  empty,
}: {
  operations: AccountOperationSummary[];
  showPatient?: boolean;
  empty?: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const rights = usePaymentRights();
  const refresh = useRefreshMoney();
  const { receipt } = useMoneyDocuments();
  const [remove] = useDelete();
  const methodLabel = useMethodLabel();

  if (!operations.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {empty ?? translate("payments.account.no_operations")}
      </p>
    );
  }

  const cancel = (op: AccountOperationSummary) => {
    if (!window.confirm(translate("payments.account.cancel_confirm"))) return;
    remove(
      "account_operations",
      { id: op.id, previousData: op },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          notify("payments.account.cancelled", { type: "info" });
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
    <ul className="flex flex-col gap-1.5" data-testid="operations-list">
      {operations.map((op) => {
        const sign = operationSign(op);
        return (
          <li
            key={op.id}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-2xl bg-muted/60 px-4 py-3 text-sm"
          >
            <span className="text-xs text-muted-foreground tabular-nums">
              {time(op.occurred_at)}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                    op.kind === "refund" || op.kind === "expense"
                      ? "bg-tone-red/15"
                      : op.kind === "deposit"
                        ? "bg-neon-soft"
                        : op.kind === "correction"
                          ? "bg-tone-violet/15"
                          : "bg-card",
                  )}
                >
                  {op.kind === "expense"
                    ? translate("cash_out.kind")
                    : translate(`payments.kinds.${op.kind}`)}
                </span>
                {op.kind === "expense" && op.category_name ? (
                  <span className="rounded-full bg-card px-2.5 py-0.5 text-[11px]">
                    {op.category_name}
                  </span>
                ) : null}
                <span className="truncate">{methodLabel(op)}</span>
                {op.payroll_adjustment_id != null ||
                op.lab_payment_id != null ? (
                  <span className="text-xs text-muted-foreground">
                    {translate(
                      op.payroll_adjustment_id != null
                        ? "cash_out.linked_payout"
                        : "cash_out.linked_lab",
                    )}
                  </span>
                ) : null}
                {op.prepayment ? (
                  <span className="text-xs text-muted-foreground">
                    {translate("payments.dialog.prepayment")}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {[
                  showPatient && op.patient_name ? (
                    <Link
                      key="patient"
                      to={`/patients/${op.patient_id}/show`}
                      className="text-foreground"
                    >
                      {op.patient_name}
                    </Link>
                  ) : null,
                  op.deal_name ?? null,
                  op.plan_name ?? null,
                  op.cashier_name ?? null,
                  op.comment ?? null,
                ]
                  .filter(Boolean)
                  .flatMap((part, index) => (index ? [" · ", part] : [part]))}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "text-base font-light tabular-nums whitespace-nowrap",
                  sign < 0 && "text-tone-red",
                )}
              >
                {sign > 0 ? "+" : sign < 0 ? "−" : ""}
                {money(Math.abs(op.amount))}
              </span>
              {op.kind !== "expense" ? (
                <button
                  type="button"
                  onClick={() => receipt(op.id)}
                  className="rounded-full bg-card px-3 py-1 text-xs hover:bg-pill"
                  title={translate("payments.account.receipt")}
                >
                  {translate("payments.account.receipt")}
                </button>
              ) : null}
              {rights.canEdit ? (
                <button
                  type="button"
                  onClick={() => cancel(op)}
                  className="rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-tone-red"
                  aria-label={translate("payments.account.cancel")}
                  title={translate("payments.account.cancel")}
                >
                  ×
                </button>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
