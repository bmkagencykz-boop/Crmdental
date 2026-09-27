import { Trash2 } from "lucide-react";
import {
  useCreate,
  useDelete,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, DealPayment, DealPaymentKind } from "../types";
import { formatMoney } from "./kanbanFormat";

const today = () => new Date().toISOString().slice(0, 10);

const KINDS: DealPaymentKind[] = ["payment", "prepayment"];

/**
 * Payments of a deal (entered by hand). The deal's paid amount is their sum,
 * computed by the database; the prepayment is the sum of the payments of
 * kind "prepayment" (deals_summary).
 */
export const DealPayments = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const notify = useNotify();
  const refresh = useRefresh();
  const [create, { isPending: isCreating }] = useCreate();
  const [remove] = useDelete();
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today());
  const [comment, setComment] = useState("");
  const [kind, setKind] = useState<DealPaymentKind>("payment");
  const { data: payments = [] } = useGetList<DealPayment>("deal_payments", {
    filter: { deal_id: deal.id },
    sort: { field: "paid_at", order: "DESC" },
    pagination: { page: 1, perPage: 100 },
  });

  const rest = Math.max(0, (deal.plan_amount ?? 0) - (deal.paid_amount ?? 0));
  const value = Number(amount.replace(/\s/g, ""));

  const add = () => {
    if (!(value > 0)) return;
    create(
      "deal_payments",
      {
        data: {
          deal_id: deal.id,
          amount: Math.round(value),
          paid_at: paidAt,
          comment: comment || null,
          kind,
        },
      },
      {
        onSuccess: () => {
          setAmount("");
          setComment("");
          setKind("payment");
          notify("crm.deals.payments.added", { type: "info" });
          refresh();
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };

  const removePayment = (id: Identifier, payment: DealPayment) =>
    remove(
      "deal_payments",
      { id, previousData: payment },
      { mutationMode: "pessimistic", onSuccess: () => refresh() },
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Amount
          label={translate("resources.deals.fields.plan_amount")}
          value={formatMoney(deal.plan_amount, currency)}
        />
        <Amount
          label={translate("resources.deals.fields.paid_amount")}
          value={formatMoney(deal.paid_amount, currency)}
        />
        <Amount
          label={translate("resources.deals.fields.prepayment_amount")}
          value={formatMoney(deal.prepayment_amount ?? 0, currency)}
          muted={!deal.prepayment_amount}
        />
        <Amount
          label={translate("crm.deals.payments.rest")}
          value={formatMoney(rest, currency)}
          muted={rest === 0}
        />
      </div>
      {payments.length ? (
        <ul className="flex flex-col divide-y divide-border">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="w-24 shrink-0 text-muted-foreground tabular-nums">
                {new Date(payment.paid_at).toLocaleDateString("ru-RU")}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {payment.kind === "prepayment" ? (
                  <span className="mr-1.5 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                    {translate("doctors.payments.prepayment")}
                  </span>
                ) : null}
                {payment.comment}
              </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(payment.amount, currency)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={translate("ra.action.delete")}
                onClick={() => removePayment(payment.id, payment)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label={translate("doctors.payments.kind")}
          className="flex rounded-md border border-border p-0.5"
        >
          {KINDS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              onClick={() => setKind(value)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs font-semibold transition-colors",
                kind === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {translate(`doctors.payments.${value}`)}
            </button>
          ))}
        </div>
        <Input
          aria-label={translate("crm.deals.payments.amount")}
          placeholder={translate("crm.deals.payments.amount")}
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="w-32"
        />
        <Input
          type="date"
          aria-label={translate("crm.deals.payments.date")}
          value={paidAt}
          onChange={(event) => setPaidAt(event.target.value)}
          className="w-40"
        />
        <Input
          aria-label={translate("crm.deals.payments.comment")}
          placeholder={translate("crm.deals.payments.comment")}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="min-w-32 flex-1"
        />
        <Button onClick={add} disabled={!(value > 0) || isCreating}>
          {translate("crm.deals.payments.add")}
        </Button>
      </div>
    </div>
  );
};

const Amount = ({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) => (
  <div className="min-w-0 rounded-lg bg-card/70 px-3 py-3">
    <p className="truncate text-xs text-muted-foreground">{label}</p>
    <p
      className={`mt-1 truncate text-[15px] font-bold tabular-nums ${muted ? "text-muted-foreground" : ""}`}
      title={value}
    >
      {value}
    </p>
  </div>
);
