import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { OperationsList } from "./OperationsList";
import { PaymentDialog, type PaymentMode } from "./PaymentDialog";
import type { AccountOperationSummary } from "./types";
import {
  money,
  useMoneyDocuments,
  usePatientAccount,
  usePaymentRights,
} from "./usePayments";

/**
 * «Счёт» of the patient card (stage 36): balance, deposit, debt, the
 * operations, and «Принять оплату», «Пополнить депозит», «Возврат», «Акт
 * выполненных работ».
 */
export const PatientAccountBlock = ({
  patientId,
}: {
  patientId: Identifier;
}) => {
  const translate = useTranslate();
  const rights = usePaymentRights();
  const { data: account } = usePatientAccount(patientId);
  const { act } = useMoneyDocuments();
  const [all, setAll] = useState(false);
  const [dialog, setDialog] = useState<PaymentMode | null>(null);
  const { data: operations = [], total = 0 } =
    useGetList<AccountOperationSummary>("account_operations_summary", {
      filter: { patient_id: patientId },
      sort: { field: "occurred_at", order: "DESC" },
      pagination: { page: 1, perPage: all ? 500 : 6 },
    });
  if (!rights.canAccept) return null;

  const balance = account?.balance ?? 0;
  return (
    <section
      className="rounded-[28px] bg-card p-6"
      aria-label={translate("payments.account.title")}
      data-testid="patient-account"
    >
      <div className="flex flex-wrap items-start gap-3">
        <h3 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("payments.account.title")}
        </h3>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => setDialog("payment")}>
            {translate("payments.account.accept")}
          </Button>
          <Button variant="outline" onClick={() => setDialog("deposit")}>
            {translate("payments.account.top_up")}
          </Button>
          {rights.canRefund ? (
            <Button variant="outline" onClick={() => setDialog("refund")}>
              {translate("payments.account.refund")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => act(patientId)}>
            {translate("payments.account.act")}
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label={translate("payments.account.balance")}
          value={money(balance)}
          hint={translate("payments.account.balance_hint")}
          big
          negative={balance < 0}
        />
        <Figure
          label={translate("payments.account.deposit")}
          value={money(account?.deposit ?? 0)}
        />
        <Figure
          label={translate("payments.account.debt")}
          value={money(account?.debt ?? 0)}
          neon={(account?.debt ?? 0) > 0}
        />
        <Figure
          label={translate("payments.account.paid_of_done")}
          value={`${money(account?.paid ?? 0)}`}
          hint={translate("payments.account.done", {
            amount: money(account?.charged ?? 0),
          })}
        />
      </div>

      <div className="mt-5">
        <OperationsList operations={operations} />
        {total > operations.length && !all ? (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="mt-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            {translate("payments.account.show_all", { count: total })}
          </button>
        ) : null}
      </div>

      <PaymentDialog
        open={dialog != null}
        onOpenChange={(open) => !open && setDialog(null)}
        patientId={patientId}
        mode={dialog ?? "payment"}
      />
    </section>
  );
};

const Figure = ({
  label,
  value,
  hint,
  big,
  neon,
  negative,
}: {
  label: string;
  value: string;
  hint?: string;
  big?: boolean;
  neon?: boolean;
  negative?: boolean;
}) => (
  <div
    className={cn(
      "flex min-w-0 flex-col justify-between rounded-[20px] px-4 py-3",
      neon ? "bg-neon text-neon-ink" : "bg-muted",
    )}
  >
    <span
      className={cn(
        "text-xs",
        neon ? "text-neon-ink/80" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
    <span
      className={cn(
        "mt-2 truncate font-light tracking-[-0.03em] tabular-nums",
        big ? "text-[32px] leading-none" : "text-2xl leading-none",
        negative && "text-tone-red",
      )}
      title={value}
    >
      {value}
    </span>
    {hint ? (
      <span
        className={cn(
          "mt-1 truncate text-[11px]",
          neon ? "text-neon-ink/80" : "text-muted-foreground",
        )}
      >
        {hint}
      </span>
    ) : null}
  </div>
);
