import {
  useDataProvider,
  useNotify,
  useTranslate,
  type Identifier,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import { localDay, shortDay } from "./labMath";
import { remakeIsPaid } from "./labPlusMath";
import { LAB_FAULTS, type LabFault, type LabStatus } from "./types";
import { useLabDictionaries, useRefreshLab } from "./useLab";

const OWN = "own";

/**
 * «Переделка» of an order (stage 43): the reason (the dictionary or its
 * own words), who is at fault — the lab, the clinic, the patient — and a
 * comment. Tells whether the lab charges it: the lab's fault and the
 * warranty are free (public.lab_order_remake).
 */
export const LabRemakeDialog = ({
  order,
  onClose,
  onDone,
}: {
  order: {
    id: Identifier;
    number: number;
    status: LabStatus;
    warranty_until?: string | null;
    first_delivered_at?: string | null;
  };
  onClose: () => void;
  onDone?: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshLab();
  const { reasons } = useLabDictionaries();
  const [reasonId, setReasonId] = useState<string>("");
  const [ownReason, setOwnReason] = useState("");
  const [fault, setFault] = useState<LabFault | "">("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  // A delivered work within its warranty: the remake is free
  const warranty =
    !!order.first_delivered_at &&
    !!order.warranty_until &&
    localDay() <= order.warranty_until;
  const paid = remakeIsPaid(fault || null, warranty);

  const save = async () => {
    setSaving(true);
    try {
      await dataProvider.labOrderRemake({
        order_id: order.id,
        reason_id: reasonId && reasonId !== OWN ? reasonId : null,
        reason: reasonId === OWN ? ownReason.trim() || null : null,
        fault: fault || null,
        comment: comment.trim() || null,
      });
      notify("lab_plus.remake.done", {
        type: "info",
        messageArgs: { number: order.number },
      });
      await refresh();
      onDone?.();
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
        data-testid="lab-remake-dialog"
      >
        <DialogHeader>
          <DialogTitle className="text-[24px] font-normal tracking-[-0.02em]">
            {translate("lab_plus.remake.title", { number: order.number })}
          </DialogTitle>
          <DialogDescription>
            {translate("lab_plus.remake.hint")}
          </DialogDescription>
        </DialogHeader>
        <ChoiceRow
          label={translate("lab_plus.remake.reason")}
          value={reasonId}
          onChange={setReasonId}
          options={[
            ...reasons
              .filter((reason) => reason.is_active)
              .map((reason) => ({
                value: String(reason.id),
                label: reason.name,
              })),
            { value: OWN, label: translate("lab_plus.remake.own_reason") },
          ]}
        />
        {reasonId === OWN ? (
          <Input
            value={ownReason}
            onChange={(event) => setOwnReason(event.target.value)}
            placeholder={translate("lab_plus.remake.own_placeholder")}
            aria-label={translate("lab_plus.remake.own_reason")}
            maxLength={200}
            autoFocus
          />
        ) : null}
        <ChoiceRow
          label={translate("lab_plus.remake.fault")}
          value={fault}
          onChange={(value) => setFault(value as LabFault | "")}
          options={[
            ...LAB_FAULTS.map((value) => ({
              value,
              label: translate(`lab_plus.faults.${value}`),
            })),
            { value: "", label: translate("lab_plus.faults.unknown") },
          ]}
        />
        <Textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={translate("lab_plus.remake.comment")}
          aria-label={translate("lab_plus.remake.comment")}
          rows={2}
          maxLength={2000}
          className="rounded-2xl"
        />
        <p
          className={cn(
            "rounded-2xl px-4 py-3 text-sm",
            paid ? "bg-tone-orange/15" : "bg-neon-soft",
          )}
          data-testid="lab-remake-money"
        >
          {warranty
            ? translate("lab_plus.remake.warranty", {
                date: shortDay(order.warranty_until, true),
              })
            : paid
              ? translate("lab_plus.remake.paid")
              : fault === "lab"
                ? translate("lab_plus.remake.free_lab")
                : translate("lab_plus.remake.free_unknown")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {translate("ra.action.cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={saving || (reasonId === OWN && !ownReason.trim())}
            data-testid="lab-remake-save"
          >
            {translate("lab_plus.remake.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/** A row of pill choices (the black pill is the chosen one) */
export const ChoiceRow = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) => (
  <div className="flex flex-col gap-2">
    <span className="text-xs text-muted-foreground">{label}</span>
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value || "none"}
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
