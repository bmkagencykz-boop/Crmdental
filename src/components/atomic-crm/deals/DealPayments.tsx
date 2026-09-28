import { useGetList, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";

import { OperationsList } from "../payments/OperationsList";
import {
  PaymentDialog,
  type PaymentMode,
} from "../payments/PaymentDialog";
import type { AccountOperationSummary } from "../payments/types";
import {
  useMoneyDocuments,
  usePaymentRights,
} from "../payments/usePayments";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { formatMoney } from "./kanbanFormat";

/**
 * Payments of a deal (stage 36): the operations of the patient account
 * linked to the deal, accepted with the payment dialog (methods, mixed
 * payments, change, plan items, the deposit). The deal's paid amount is the
 * sum of its deal payments, which the database writes from the operations;
 * the prepayment is the sum of those marked «Предоплата» (deals_summary).
 */
export const DealPayments = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const { currency } = useConfigurationContext();
  const rights = usePaymentRights();
  const { act } = useMoneyDocuments();
  const [dialog, setDialog] = useState<PaymentMode | null>(null);
  const { data: operations = [] } = useGetList<AccountOperationSummary>(
    "account_operations_summary",
    {
      filter: { deal_id: deal.id },
      sort: { field: "occurred_at", order: "DESC" },
      pagination: { page: 1, perPage: 200 },
    },
  );

  const rest = Math.max(0, (deal.plan_amount ?? 0) - (deal.paid_amount ?? 0));

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
      {rights.canAccept ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog("payment")}>
            {translate("payments.account.accept")}
          </Button>
          {rights.canRefund ? (
            <Button variant="outline" onClick={() => setDialog("refund")}>
              {translate("payments.account.refund")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => act(deal.patient_id, deal.id)}
          >
            {translate("payments.account.act")}
          </Button>
        </div>
      ) : null}
      <OperationsList
        operations={operations}
        empty={translate("payments.deal.no_operations")}
      />
      <PaymentDialog
        open={dialog != null}
        onOpenChange={(open) => !open && setDialog(null)}
        patientId={deal.patient_id}
        dealId={deal.id}
        mode={dialog ?? "payment"}
      />
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
  <div className="min-w-0 rounded-2xl bg-muted/60 px-4 py-3">
    <p className="truncate text-xs text-muted-foreground">{label}</p>
    <p
      className={`mt-1 truncate text-xl font-light tracking-[-0.02em] tabular-nums ${muted ? "text-muted-foreground" : ""}`}
      title={value}
    >
      {value}
    </p>
  </div>
);
