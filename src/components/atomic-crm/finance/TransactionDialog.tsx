import { useCreate, useNotify, useTranslate, useUpdate } from "ra-core";
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

import { useBranches } from "../branches/useBranches";
import { NativeSelect, Pills } from "../payments/PaymentDialog";
import { parseAmount } from "../payments/paymentMath";
import { todayKey } from "../tasks/calendarLayout";
import type { FinanceTransaction, FinanceTransactionKind } from "./types";
import {
  useFinanceAccounts,
  useFinanceArticles,
  useRefreshFinance,
} from "./useFinance";

const KINDS: FinanceTransactionKind[] = ["in", "out", "transfer", "accrual"];

/**
 * «Движение» (stage 44): money outside the cash desk — in or out of an
 * account by an article (rent paid by bank, a loan, taxes, an owner
 * withdrawal), a transfer between accounts, or an accrual for the P&L only
 * (depreciation, history from another system). A payout or a lab payment
 * paid by bank keeps its amount and day: they change where it was paid.
 */
export const TransactionDialog = ({
  open,
  onOpenChange,
  record,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record?: FinanceTransaction | null;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshFinance();
  const { branches, enabled: branchesOn } = useBranches();
  const { data: accounts = [] } = useFinanceAccounts();
  const { data: articles = [] } = useFinanceArticles();
  const [create, { isPending: creating }] = useCreate<FinanceTransaction>();
  const [update, { isPending: updating }] = useUpdate<FinanceTransaction>();
  const linked =
    record != null &&
    (record.payroll_adjustment_id != null || record.lab_payment_id != null);
  const [kind, setKind] = useState<FinanceTransactionKind>(
    record?.kind ?? "out",
  );
  const [day, setDay] = useState(record?.occurred_on ?? todayKey());
  const [amountText, setAmountText] = useState(
    record ? String(record.amount) : "",
  );
  const activeAccounts = accounts.filter(
    (a) => a.is_active || String(a.id) === String(record?.account_id),
  );
  const [accountId, setAccountId] = useState(
    String(
      record?.account_id ??
        activeAccounts.find((a) => a.code === "bank")?.id ??
        "",
    ),
  );
  const [toAccountId, setToAccountId] = useState(
    String(record?.to_account_id ?? ""),
  );
  const [articleId, setArticleId] = useState(String(record?.article_id ?? ""));
  const [counterparty, setCounterparty] = useState(record?.counterparty ?? "");
  const [comment, setComment] = useState(record?.comment ?? "");
  const [branchId, setBranchId] = useState(String(record?.branch_id ?? ""));
  const amount = parseAmount(amountText);
  const fitting = articles.filter(
    (a) =>
      (a.is_active || String(a.id) === articleId) &&
      (kind === "accrual"
        ? a.pnl_line != null
        : a.section === (kind === "in" ? "in" : "out")),
  );
  const problem =
    amount <= 0
      ? "amount"
      : !day
        ? "day"
        : kind === "transfer"
          ? !accountId || !toAccountId || accountId === toAccountId
            ? "transfer"
            : null
          : !articleId || !fitting.some((a) => String(a.id) === articleId)
            ? "article"
            : kind !== "accrual" && !accountId
              ? "account"
              : null;

  const save = () => {
    if (problem) return;
    const data = {
      kind,
      occurred_on: day,
      amount,
      account_id: kind === "accrual" ? null : accountId || null,
      to_account_id: kind === "transfer" ? toAccountId || null : null,
      article_id: kind === "transfer" ? null : articleId || null,
      counterparty: counterparty.trim() || null,
      comment: comment.trim() || null,
      branch_id: branchId || null,
    };
    const options = {
      onSuccess: () => {
        notify("finance.transaction.saved", { type: "info" });
        refresh();
        onOpenChange(false);
      },
      onError: (error: any) =>
        notify(error?.message || "ra.notification.http_error", {
          type: "error",
        }),
    };
    if (record) {
      update(
        "finance_transactions",
        {
          id: record.id,
          data: linked
            ? {
                account_id: data.account_id,
                article_id: data.article_id,
                comment: data.comment,
                branch_id: data.branch_id,
                counterparty: data.counterparty,
              }
            : data,
          previousData: record,
        },
        options,
      );
    } else {
      create("finance_transactions", { data }, options);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto rounded-[28px] sm:max-w-lg"
        data-testid="finance-transaction-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[24px] font-normal">
            {translate(
              record ? "finance.transaction.edit" : "finance.transaction.new",
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              linked
                ? "finance.transaction.linked_hint"
                : "finance.transaction.hint",
            )}
          </DialogDescription>
        </DialogHeader>
        {!linked ? (
          <Pills
            label={translate("finance.transaction.kind")}
            value={kind}
            options={KINDS.map((value) => ({
              value,
              label: translate(`finance.transaction.kinds.${value}`),
            }))}
            onChange={(value) => {
              setKind(value as FinanceTransactionKind);
              setArticleId("");
            }}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("finance.transaction.amount")}
            </span>
            <Input
              inputMode="numeric"
              value={amountText}
              disabled={linked}
              onChange={(event) => setAmountText(event.target.value)}
              aria-label={translate("finance.transaction.amount")}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("finance.transaction.day")}
            </span>
            <Input
              type="date"
              value={day}
              disabled={linked}
              onChange={(event) => setDay(event.target.value)}
              aria-label={translate("finance.transaction.day")}
            />
          </label>
        </div>
        {kind !== "accrual" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate(
                kind === "transfer"
                  ? "finance.transaction.from_account"
                  : "finance.transaction.account",
              )}
            </span>
            <NativeSelect
              value={accountId}
              onChange={setAccountId}
              aria-label={translate(
                kind === "transfer"
                  ? "finance.transaction.from_account"
                  : "finance.transaction.account",
              )}
            >
              <option value="">—</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {kind === "transfer" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("finance.transaction.to_account")}
            </span>
            <NativeSelect
              value={toAccountId}
              onChange={setToAccountId}
              aria-label={translate("finance.transaction.to_account")}
            >
              <option value="">—</option>
              {activeAccounts
                .filter((a) => String(a.id) !== accountId)
                .map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
            </NativeSelect>
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("finance.transaction.article")}
            </span>
            <NativeSelect
              value={articleId}
              onChange={setArticleId}
              aria-label={translate("finance.transaction.article")}
            >
              <option value="">—</option>
              {fitting.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {kind === "accrual" ? (
          <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            {translate("finance.transaction.accrual_hint")}
          </p>
        ) : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("finance.transaction.counterparty")}
          </span>
          <Input
            value={counterparty}
            onChange={(event) => setCounterparty(event.target.value)}
            aria-label={translate("finance.transaction.counterparty")}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("finance.transaction.comment")}
          </span>
          <Input
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            aria-label={translate("finance.transaction.comment")}
          />
        </label>
        {branchesOn ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {translate("finance.period.branch")}
            </span>
            <NativeSelect
              value={branchId}
              onChange={setBranchId}
              aria-label={translate("finance.period.branch")}
            >
              <option value="">
                {translate("finance.transaction.no_branch")}
              </option>
              {branches.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {problem && amountText ? (
          <p className="text-xs text-tone-red">
            {translate(`finance.transaction.problems.${problem}`)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            disabled={!!problem || creating || updating}
            onClick={save}
            data-testid="finance-transaction-save"
          >
            {translate("ra.action.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
