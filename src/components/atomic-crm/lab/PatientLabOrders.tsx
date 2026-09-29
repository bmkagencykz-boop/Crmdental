import { useGetList, useTranslate, type Identifier } from "ra-core";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

import { OverdueChip, PlusGlyph, StatusChip } from "./LabBits";
import { LabOrderDialog } from "./LabOrderDialog";
import { shortDay } from "./labMath";
import type { LabOrderSummary } from "./types";
import { useLabRights } from "./useLab";

/**
 * «Заказ-наряды» of the patient card (stage 40): the patient's lab work
 * orders with their status and due date, «Новый наряд» with the patient
 * filled in. Not for the integrator (medical data).
 */
export const PatientLabOrders = ({ patientId }: { patientId: Identifier }) => {
  const translate = useTranslate();
  const rights = useLabRights();
  const [dialog, setDialog] = useState<{
    open: boolean;
    orderId: Identifier | null;
  }>({ open: false, orderId: null });
  const { data: orders = [] } = useGetList<LabOrderSummary>(
    "lab_orders_summary",
    {
      filter: { patient_id: patientId },
      pagination: { page: 1, perPage: 50 },
      sort: { field: "number", order: "DESC" },
    },
    { enabled: rights.canWrite },
  );
  if (!rights.canWrite) return null;
  return (
    <section
      className="flex flex-col gap-4 rounded-[28px] bg-card p-6"
      aria-label={translate("lab.patient.title")}
      data-testid="patient-lab-orders"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("lab.patient.title")}
        </h2>
        <Link
          to="/lab"
          className="text-sm text-muted-foreground no-underline hover:underline"
        >
          {translate("lab.patient.open")}
        </Link>
        <Button
          size="sm"
          className="ml-auto"
          onClick={() => setDialog({ open: true, orderId: null })}
        >
          <PlusGlyph className="size-3.5" />
          {translate("lab.patient.new")}
        </Button>
      </div>
      {orders.length ? (
        <ul className="flex flex-col gap-2">
          {orders.map((order) => (
            <li key={order.id}>
              <button
                type="button"
                onClick={() => setDialog({ open: true, orderId: order.id })}
                className="flex w-full flex-wrap items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-left transition-colors hover:bg-pill"
              >
                <span className="text-sm tabular-nums">
                  {translate("lab.card.order", { number: order.number })}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {order.works ?? translate("lab.card.no_works")}
                  <span className="text-muted-foreground">
                    {order.lab_name ? ` · ${order.lab_name}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {translate("lab.card.due")}: {shortDay(order.due_at, true)}
                </span>
                <OverdueChip days={order.overdue_days} />
                <StatusChip status={order.status} className="h-8" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("lab.patient.empty")}
        </p>
      )}
      <LabOrderDialog
        open={dialog.open}
        orderId={dialog.orderId}
        patientId={patientId}
        onClose={() => setDialog({ open: false, orderId: null })}
      />
    </section>
  );
};
