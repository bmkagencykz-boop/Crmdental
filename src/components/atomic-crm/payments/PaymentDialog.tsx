import {
  useCreate,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { Visit } from "../schedule/types";
import type { TreatmentPlan, TreatmentPlanItem } from "../treatment/types";
import type { Deal, Service } from "../types";
import {
  changeDue,
  checkOperation,
  itemsAmount,
  normalizeOperation,
  parseAmount,
  partsRemainder,
} from "./paymentMath";
import {
  PAYMENT_METHODS,
  type AccountOperation,
  type MethodPart,
  type OperationKind,
  type OperationMethod,
  type PaymentMethod,
  type TreatmentPlanPayment,
} from "./types";
import {
  money,
  useMoneyDocuments,
  usePatientAccount,
  usePaymentRights,
  useRefreshMoney,
} from "./usePayments";

export type PaymentMode = "payment" | "deposit" | "refund" | "correction";

const pad = (n: number) => String(n).padStart(2, "0");
/** «2026-09-28T14:05» of now, for a datetime-local input */
const localNow = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const NONE = "";

/**
 * «Принять оплату», «Пополнить депозит», «Возврат», «Корректировка»: one
 * operation of the patient account. A payment picks the deal, its plan and
 * items (their amount with the plan discount) or a visit, one method or a
 * mixed payment split across methods, the cash received and the change;
 * it can be paid from the deposit. After it: «Квитанция PDF».
 */
export const PaymentDialog = ({
  open,
  onOpenChange,
  patientId,
  dealId: initialDeal,
  mode: initialMode = "payment",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: Identifier;
  dealId?: Identifier | null;
  mode?: PaymentMode;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefreshMoney();
  const { receipt } = useMoneyDocuments();
  const rights = usePaymentRights();
  const [create, { isPending }] = useCreate<AccountOperation>();
  const { data: account } = usePatientAccount(open ? patientId : null);

  const [mode, setMode] = useState<PaymentMode>(initialMode);
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<OperationMethod>("cash");
  const [parts, setParts] = useState<MethodPart[]>([
    { method: "card", amount: 0 },
    { method: "cash", amount: 0 },
  ]);
  const [cashText, setCashText] = useState("");
  const [dealId, setDealId] = useState<string>(
    initialDeal != null ? String(initialDeal) : NONE,
  );
  const [planId, setPlanId] = useState<string>(NONE);
  const [itemIds, setItemIds] = useState<Identifier[]>([]);
  const [visitId, setVisitId] = useState<string>(NONE);
  const [occurredAt, setOccurredAt] = useState(localNow);
  const [comment, setComment] = useState("");
  const [prepayment, setPrepayment] = useState(false);
  // Refund: from the paid services or from the deposit; to money or deposit
  const [refundFrom, setRefundFrom] = useState<"services" | "deposit">(
    "services",
  );
  const [correctionAccount, setCorrectionAccount] = useState<
    "services" | "deposit"
  >("deposit");
  const [decrease, setDecrease] = useState(false);
  const [done, setDone] = useState<AccountOperation | null>(null);

  // A fresh form each time it opens
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setAmountText("");
    setMethod("cash");
    setParts([
      { method: "card", amount: 0 },
      { method: "cash", amount: 0 },
    ]);
    setCashText("");
    setDealId(initialDeal != null ? String(initialDeal) : NONE);
    setPlanId(NONE);
    setItemIds([]);
    setVisitId(NONE);
    setOccurredAt(localNow());
    setComment("");
    setPrepayment(false);
    setRefundFrom("services");
    setCorrectionAccount("deposit");
    setDecrease(false);
    setDone(null);
  }, [open, initialMode, initialDeal]);

  const { data: deals = [] } = useGetList<Deal>(
    "deals",
    {
      filter: { patient_id: patientId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: open },
  );
  // A patient with deals pays for one: the latest by default
  useEffect(() => {
    if (open && dealId === NONE && initialDeal == null && deals.length) {
      setDealId(String(deals[0].id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deals.length]);

  const { data: plans = [] } = useGetList<TreatmentPlan>(
    "treatment_plans",
    {
      filter: { deal_id: dealId },
      sort: { field: "created_at", order: "DESC" },
      pagination: { page: 1, perPage: 50 },
    },
    { enabled: open && dealId !== NONE },
  );
  const activePlans = plans.filter((plan) => plan.status !== "declined");
  useEffect(() => {
    const main = activePlans.find((plan) => plan.is_main);
    setPlanId(main ? String(main.id) : NONE);
    setItemIds([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, plans.length]);
  const plan = activePlans.find((p) => String(p.id) === planId);
  const { data: items = [] } = useGetList<TreatmentPlanItem>(
    "treatment_plan_items",
    {
      filter: { plan_id: planId },
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
    { enabled: open && planId !== NONE },
  );
  const { data: planPayments = [] } = useGetList<TreatmentPlanPayment>(
    "treatment_plan_payments",
    {
      filter: { deal_id: dealId },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "id", order: "ASC" },
    },
    { enabled: open && dealId !== NONE },
  );
  const planPayment = planPayments.find((p) => String(p.id) === planId);
  const { data: visits = [] } = useGetList<Visit>(
    "visits",
    {
      filter: {
        patient_id: patientId,
        "status@in": "(arrived,completed)",
      },
      sort: { field: "starts_at", order: "DESC" },
      pagination: { page: 1, perPage: 10 },
    },
    { enabled: open && mode === "payment" },
  );
  const { data: services = [] } = useGetList<Service>(
    "services",
    { pagination: { page: 1, perPage: 500 } },
    { enabled: open && visits.length > 0 },
  );
  const deal = deals.find((d) => String(d.id) === dealId);

  // The kind and the fields of the operation
  const kind: OperationKind =
    mode === "payment"
      ? method === "deposit"
        ? "deposit_payment"
        : "payment"
      : mode;
  const amount = Math.abs(parseAmount(amountText));
  const operation = normalizeOperation({
    kind,
    account:
      mode === "refund"
        ? refundFrom
        : mode === "correction"
          ? correctionAccount
          : mode === "deposit"
            ? "deposit"
            : "services",
    method:
      mode === "refund" && refundFrom === "deposit" && method === "deposit"
        ? "cash"
        : method,
    amount: mode === "correction" && decrease ? -amount : amount,
    parts: method === "mixed" ? parts : null,
  });
  const cashReceived = cashText.trim() ? parseAmount(cashText) : null;
  const change = changeDue(operation, cashReceived);
  const deposit = account?.deposit ?? 0;
  const paidScope =
    dealId !== NONE ? Number(deal?.paid_amount ?? 0) : (account?.paid ?? 0);
  const problem = checkOperation(
    { ...operation, cash_received: cashReceived },
    { deposit, paid: paidScope },
  );
  const remainder = method === "mixed" ? partsRemainder(amount, parts) : 0;

  // Items chosen: their amount is proposed
  const chooseItems = (next: Identifier[]) => {
    setItemIds(next);
    if (plan && next.length) {
      setAmountText(String(itemsAmount(plan, items, next)));
    }
  };
  const chooseVisit = (value: string) => {
    setVisitId(value);
    const visit = visits.find((v) => String(v.id) === value);
    if (!visit) return;
    if (visit.deal_id != null) setDealId(String(visit.deal_id));
    const price = services.find((s) => s.id === visit.service_id)?.price;
    if (price && !amountText.trim()) setAmountText(String(Math.round(price)));
  };

  const methods: OperationMethod[] =
    mode === "payment"
      ? [
          ...PAYMENT_METHODS,
          "mixed",
          ...(deposit > 0 ? ["deposit" as const] : []),
        ]
      : mode === "deposit"
        ? [...PAYMENT_METHODS, "mixed"]
        : mode === "refund"
          ? refundFrom === "services"
            ? [...PAYMENT_METHODS, "deposit"]
            : [...PAYMENT_METHODS]
          : [];

  const submit = () => {
    if (problem || !amount) return;
    create(
      "account_operations",
      {
        data: {
          patient_id: patientId,
          kind,
          account: operation.account,
          amount: operation.amount,
          method: operation.method,
          parts: operation.parts,
          cash_received: change != null ? cashReceived : null,
          prepayment: kind === "payment" && prepayment,
          occurred_at: new Date(occurredAt).toISOString(),
          deal_id: mode === "deposit" ? null : (deal?.id ?? null),
          plan_id:
            mode === "deposit" || mode === "correction"
              ? null
              : (plan?.id ?? null),
          plan_item_ids: mode === "payment" && plan ? itemIds : [],
          visit_id:
            mode === "payment"
              ? (visits.find((v) => String(v.id) === visitId)?.id ?? null)
              : null,
          comment: comment.trim() || null,
        },
      },
      {
        onSuccess: (data) => {
          setDone(data);
          refresh();
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  };

  const modes: PaymentMode[] = [
    "payment",
    "deposit",
    ...(rights.canRefund ? (["refund"] as const) : []),
    ...(rights.canCorrect ? (["correction"] as const) : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[28px] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[26px] font-normal tracking-[-0.02em]">
            {translate(`payments.dialog.title_${mode}`)}
          </DialogTitle>
          <DialogDescription>
            {account
              ? translate("payments.dialog.summary", {
                  deposit: money(account.deposit),
                  debt: money(account.debt),
                })
              : " "}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <DoneStep
            operation={done}
            change={change}
            onReceipt={() => receipt(done.id)}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {modes.length > 1 ? (
              <Pills
                label={translate("payments.dialog.operation")}
                value={mode}
                options={modes.map((value) => ({
                  value,
                  label: translate(`payments.dialog.mode_${value}`),
                }))}
                onChange={(value) => {
                  setMode(value as PaymentMode);
                  setMethod("cash");
                }}
              />
            ) : null}

            {mode === "refund" ? (
              <Pills
                label={translate("payments.dialog.refund_from")}
                value={refundFrom}
                options={(["services", "deposit"] as const).map((value) => ({
                  value,
                  label: translate(`payments.accounts.${value}`),
                }))}
                onChange={(value) => {
                  setRefundFrom(value as "services" | "deposit");
                  setMethod("cash");
                }}
              />
            ) : null}
            {mode === "correction" ? (
              <div className="flex flex-wrap gap-4">
                <Pills
                  label={translate("payments.dialog.correction_account")}
                  value={correctionAccount}
                  options={(["deposit", "services"] as const).map((value) => ({
                    value,
                    label: translate(`payments.accounts.${value}`),
                  }))}
                  onChange={(value) =>
                    setCorrectionAccount(value as "services" | "deposit")
                  }
                />
                <Pills
                  label={translate("payments.dialog.correction_sign")}
                  value={decrease ? "down" : "up"}
                  options={[
                    {
                      value: "up",
                      label: translate("payments.dialog.increase"),
                    },
                    {
                      value: "down",
                      label: translate("payments.dialog.decrease"),
                    },
                  ]}
                  onChange={(value) => setDecrease(value === "down")}
                />
              </div>
            ) : null}

            {mode !== "deposit" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={translate("payments.dialog.deal")}>
                  <NativeSelect
                    value={dealId}
                    onChange={setDealId}
                    aria-label={translate("payments.dialog.deal")}
                  >
                    <option value={NONE}>
                      {translate("payments.dialog.no_deal")}
                    </option>
                    {deals.map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        {d.name || translate("crm.deals.untitled")}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {mode !== "correction" && activePlans.length ? (
                  <Field label={translate("payments.dialog.plan")}>
                    <NativeSelect
                      value={planId}
                      onChange={(value) => {
                        setPlanId(value);
                        setItemIds([]);
                      }}
                      aria-label={translate("payments.dialog.plan")}
                    >
                      <option value={NONE}>
                        {translate("payments.dialog.no_plan")}
                      </option>
                      {activePlans.map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
              </div>
            ) : null}

            {planPayment && mode === "payment" ? (
              <p className="-mt-2 text-sm text-muted-foreground">
                {translate("payments.dialog.plan_paid", {
                  paid: money(planPayment.paid_amount),
                  total: money(planPayment.total_amount),
                })}
                {planPayment.debt_amount > 0
                  ? ` · ${translate("payments.dialog.plan_debt", {
                      amount: money(planPayment.debt_amount),
                    })}`
                  : ""}
              </p>
            ) : null}

            {mode === "payment" && plan && items.length ? (
              <fieldset className="rounded-2xl bg-muted/60 p-3">
                <legend className="px-1 text-xs text-muted-foreground">
                  {translate("payments.dialog.items")}
                </legend>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                  {items.map((item) => {
                    const checked = itemIds.some((id) => id === item.id);
                    return (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-card">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              chooseItems(
                                value
                                  ? [...itemIds, item.id]
                                  : itemIds.filter((id) => id !== item.id),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {item.name}
                            {item.tooth ? (
                              <span className="text-muted-foreground">
                                {" "}
                                · {item.tooth}
                              </span>
                            ) : null}
                          </span>
                          {item.done ? (
                            <span className="rounded-full bg-tone-green/15 px-2 py-0.5 text-[11px]">
                              {translate("payments.dialog.item_done")}
                            </span>
                          ) : null}
                          <span className="tabular-nums">
                            {money(item.line_total ?? 0)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 px-2 text-xs text-muted-foreground">
                  {translate("payments.dialog.items_hint")}
                </p>
              </fieldset>
            ) : null}

            {mode === "payment" && visits.length ? (
              <Field label={translate("payments.dialog.visit")}>
                <NativeSelect
                  value={visitId}
                  onChange={chooseVisit}
                  aria-label={translate("payments.dialog.visit")}
                >
                  <option value={NONE}>
                    {translate("payments.dialog.no_visit")}
                  </option>
                  {visits.map((visit) => (
                    <option key={visit.id} value={String(visit.id)}>
                      {new Date(visit.starts_at).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {visit.service_id != null
                        ? ` · ${services.find((s) => s.id === visit.service_id)?.name ?? ""}`
                        : ""}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}

            <Field label={translate("payments.dialog.amount")}>
              <Input
                inputMode="numeric"
                autoFocus
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                placeholder="0 ₸"
                className="h-14 rounded-full px-6 text-[28px] font-light tabular-nums"
                aria-label={translate("payments.dialog.amount")}
              />
            </Field>

            {methods.length ? (
              <Pills
                label={translate("payments.dialog.method")}
                value={method}
                options={methods.map((value) => ({
                  value,
                  label:
                    value === "deposit"
                      ? mode === "refund"
                        ? translate("payments.dialog.to_deposit")
                        : translate("payments.dialog.from_deposit", {
                            amount: money(deposit),
                          })
                      : translate(`payments.methods.${value}`),
                }))}
                onChange={(value) => setMethod(value as OperationMethod)}
              />
            ) : null}

            {method === "mixed" ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-muted/60 p-3">
                {parts.map((part, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <NativeSelect
                      value={part.method}
                      onChange={(value) =>
                        setParts(
                          parts.map((p, i) =>
                            i === index
                              ? { ...p, method: value as PaymentMethod }
                              : p,
                          ),
                        )
                      }
                      aria-label={translate("payments.dialog.method")}
                    >
                      {PAYMENT_METHODS.map((value) => (
                        <option key={value} value={value}>
                          {translate(`payments.methods.${value}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      inputMode="numeric"
                      value={part.amount ? String(part.amount) : ""}
                      placeholder={
                        remainder > 0 ? String(remainder + part.amount) : "0"
                      }
                      onChange={(event) =>
                        setParts(
                          parts.map((p, i) =>
                            i === index
                              ? {
                                  ...p,
                                  amount: parseAmount(event.target.value),
                                }
                              : p,
                          ),
                        )
                      }
                      onFocus={() => {
                        // The rest goes to the part being filled
                        if (!part.amount && remainder > 0) {
                          setParts(
                            parts.map((p, i) =>
                              i === index ? { ...p, amount: remainder } : p,
                            ),
                          );
                        }
                      }}
                      className="w-40 tabular-nums"
                      aria-label={translate("payments.dialog.part_amount")}
                    />
                    {parts.length > 2 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setParts(parts.filter((_, i) => i !== index))
                        }
                      >
                        {translate("ra.action.remove")}
                      </Button>
                    ) : null}
                  </div>
                ))}
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setParts([...parts, { method: "kaspi_qr", amount: 0 }])
                    }
                  >
                    {translate("payments.dialog.add_part")}
                  </Button>
                  <span
                    className={cn(
                      "text-sm tabular-nums",
                      remainder === 0
                        ? "text-muted-foreground"
                        : "text-tone-red",
                    )}
                  >
                    {remainder >= 0
                      ? translate("payments.dialog.remainder", {
                          amount: money(remainder),
                        })
                      : translate("payments.dialog.over", {
                          amount: money(-remainder),
                        })}
                  </span>
                </div>
              </div>
            ) : null}

            {(mode === "payment" || mode === "deposit") &&
            (method === "cash" ||
              (method === "mixed" &&
                parts.some((p) => p.method === "cash"))) ? (
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <Field label={translate("payments.dialog.cash_received")}>
                  <Input
                    inputMode="numeric"
                    value={cashText}
                    onChange={(event) => setCashText(event.target.value)}
                    className="tabular-nums"
                    aria-label={translate("payments.dialog.cash_received")}
                  />
                </Field>
                <div
                  className={cn(
                    "flex h-11 items-center justify-between rounded-full px-5",
                    change != null && change >= 0
                      ? "bg-neon text-neon-ink"
                      : "bg-muted text-muted-foreground",
                  )}
                  data-testid="payment-change"
                >
                  <span className="text-sm">
                    {translate("payments.dialog.change")}
                  </span>
                  <span className="text-lg font-light tabular-nums">
                    {change != null ? money(change) : "—"}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={translate("payments.dialog.occurred_at")}>
                <Input
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(event) => setOccurredAt(event.target.value)}
                  aria-label={translate("payments.dialog.occurred_at")}
                />
              </Field>
              <Field label={translate("payments.dialog.comment")}>
                <Input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  aria-label={translate("payments.dialog.comment")}
                />
              </Field>
            </div>
            {mode === "payment" && method !== "deposit" && dealId !== NONE ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={prepayment}
                  onCheckedChange={(value) => setPrepayment(!!value)}
                />
                {translate("payments.dialog.prepayment")}
              </label>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-3">
              {amount && problem ? (
                <p className="mr-auto text-sm text-tone-red" role="alert">
                  {translate(problem)}
                </p>
              ) : null}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {translate("ra.action.cancel")}
              </Button>
              <Button
                disabled={!amount || !!problem || isPending}
                onClick={submit}
              >
                {translate(`payments.dialog.submit_${mode}`, {
                  amount: money(amount),
                })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const DoneStep = ({
  operation,
  change,
  onReceipt,
  onClose,
}: {
  operation: AccountOperation;
  change: number | null;
  onReceipt: () => void;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[24px] bg-muted p-6">
        <p className="text-sm text-muted-foreground">
          {translate(`payments.kinds.${operation.kind}`)}
        </p>
        <p className="text-[44px] leading-none font-light tracking-[-0.04em] tabular-nums">
          {money(operation.amount)}
        </p>
        {change != null && change > 0 ? (
          <p className="mt-3 inline-flex rounded-full bg-neon px-4 py-1.5 text-sm text-neon-ink">
            {translate("payments.dialog.done_change", {
              amount: money(change),
            })}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={onReceipt}>
          {translate("payments.dialog.print")}
        </Button>
        <Button onClick={onClose}>{translate("payments.dialog.close")}</Button>
      </div>
    </div>
  );
};

/** Pills: one choice among a few, black when chosen */
export const Pills = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-xs text-muted-foreground">{label}</span>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-4 py-2 text-sm transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-foreground hover:bg-pill",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex min-w-0 flex-col gap-1.5">
    <span className="text-xs text-muted-foreground">{label}</span>
    {children}
  </label>
);

/** A native select styled as a pill (short lists) */
export const NativeSelect = ({
  value,
  onChange,
  children,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  "aria-label"?: string;
}) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className="h-11 min-w-0 rounded-full border-0 bg-muted px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    {...rest}
  >
    {children}
  </select>
);
