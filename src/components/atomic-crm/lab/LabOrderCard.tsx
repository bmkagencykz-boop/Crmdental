import { useTranslate } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ChevronGlyph, Fact, OverdueChip, StatusMenu } from "./LabBits";
import { initials, localDay, shortDay, teethText, tenge } from "./labMath";
import type { LabOrderSummary, LabStatus } from "./types";

/**
 * A work order on the board, like the reference: the doctor with the
 * avatar, the date and «№», the patient, the technician, the work, the
 * fittings and the due date; the status chip (a menu), the overdue chip,
 * «Подробнее» and «Закрыть наряд».
 */
export const LabOrderCard = ({
  order,
  today,
  canWrite,
  seesMoney,
  onStatus,
  onClose,
  onEdit,
  onPdf,
}: {
  order: LabOrderSummary;
  today: string;
  canWrite: boolean;
  seesMoney: boolean;
  onStatus: (order: LabOrderSummary, status: LabStatus) => void;
  onClose: (order: LabOrderSummary) => void;
  onEdit: (order: LabOrderSummary) => void;
  onPdf: (order: LabOrderSummary) => void;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const overdue = order.overdue_days > 0;
  // Today's fitting in pink, an overdue due date in red
  const dates = [
    {
      label: translate("lab.card.fitting1"),
      day: order.fitting1_at,
      tone: order.fitting1_at === today ? "today" : null,
    },
    {
      label: translate("lab.card.fitting2"),
      day: order.fitting2_at,
      tone: order.fitting2_at === today ? "today" : null,
    },
    {
      label: translate("lab.card.due"),
      day: order.due_at,
      tone: overdue ? "late" : order.due_at === today ? "today" : null,
    },
  ];
  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-[28px] bg-card p-5",
        overdue && "ring-2 ring-tone-red/50",
      )}
      data-testid="lab-order-card"
      aria-label={translate("lab.pdf.title", { number: order.number })}
    >
      <header className="flex items-start gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
          aria-hidden
        >
          {initials(order.doctor_name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">
            {order.doctor_name ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate("lab.fields.doctor")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {shortDay(localDay(new Date(order.created_at)), true)}
          </p>
          <p className="text-sm font-medium tabular-nums">
            {translate("lab.card.order", { number: order.number })}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label={translate("lab.card.patient")} className="col-span-2">
          {order.patient_id != null ? (
            <Link
              to={`/patients/${order.patient_id}/show`}
              className="text-[17px] leading-tight font-normal tracking-[-0.01em] text-foreground no-underline hover:underline"
            >
              {order.patient_name ?? "—"}
            </Link>
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={translate("lab.card.technician")}>
          {order.technician_name ?? order.lab_name ?? "—"}
        </Fact>
        <Fact label={translate("lab.card.work")}>
          <span title={order.works ?? undefined}>
            {order.works ?? translate("lab.card.no_works")}
          </span>
        </Fact>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {dates.map(({ label, day, tone }) => (
          <div
            key={label}
            className={cn(
              "rounded-2xl px-3 py-2",
              tone === "late"
                ? "bg-tone-red/10"
                : tone === "today"
                  ? "bg-neon-soft"
                  : "bg-muted",
            )}
          >
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p
              className={cn(
                "text-sm tabular-nums",
                tone === "late" && "text-tone-red",
              )}
            >
              {shortDay(day)}
            </p>
          </div>
        ))}
      </div>

      {open ? (
        <div
          className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-muted/60 p-4"
          data-testid="lab-order-details"
        >
          <Fact label={translate("lab.fields.lab")}>
            {order.lab_name ?? "—"}
          </Fact>
          <Fact label={translate("lab.fields.teeth")}>
            {teethText(order.teeth) || "—"}
          </Fact>
          <Fact label={translate("lab.fields.shade")}>
            {order.shade ?? "—"}
          </Fact>
          <Fact label={translate("lab.fields.material")}>
            {order.material ?? "—"}
          </Fact>
          <Fact label={translate("lab.fields.sent_at")}>
            {shortDay(order.sent_at, true)}
          </Fact>
          <Fact label={translate("lab.fields.responsible")}>
            {order.responsible_name ?? "—"}
          </Fact>
          {order.remake_count > 0 ? (
            <Fact label={translate("lab.statuses.remake")}>
              {translate("lab.card.remakes", { count: order.remake_count })}
            </Fact>
          ) : null}
          {seesMoney ? (
            <Fact label={translate("lab.card.lab_cost")}>
              <span className="tabular-nums">{tenge(order.lab_cost)}</span>
            </Fact>
          ) : null}
          {order.comment ? (
            <Fact
              label={translate("lab.fields.comment")}
              className="col-span-2"
            >
              <span className="whitespace-pre-line">{order.comment}</span>
            </Fact>
          ) : null}
          <div className="col-span-2 flex flex-wrap gap-2 pt-1">
            {canWrite ? (
              <Button variant="outline" size="sm" onClick={() => onEdit(order)}>
                {translate("lab.card.edit")}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onPdf(order)}>
              {translate("lab.card.pdf")}
            </Button>
          </div>
        </div>
      ) : null}

      <footer className="mt-auto flex flex-wrap items-center gap-2">
        <StatusMenu
          status={order.status}
          disabled={!canWrite}
          onChange={(status) => onStatus(order, status)}
        />
        <OverdueChip days={order.overdue_days} />
        {order.status === "delivered" && order.delivered_at ? (
          <span className="text-xs text-muted-foreground">
            {translate("lab.card.closed", {
              date: shortDay(order.delivered_at, true),
            })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={translate(open ? "lab.card.collapse" : "lab.card.expand")}
          title={translate(open ? "lab.card.collapse" : "lab.card.expand")}
          className="ml-auto flex size-9 items-center justify-center rounded-full bg-muted transition-colors hover:bg-pill"
        >
          <ChevronGlyph open={open} />
        </button>
        {canWrite && order.status !== "delivered" ? (
          <Button
            size="sm"
            className="h-9"
            onClick={() => onClose(order)}
            data-testid="lab-close-order"
          >
            {translate("lab.card.close")}
          </Button>
        ) : null}
      </footer>
    </article>
  );
};
