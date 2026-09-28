import type { Identifier } from "ra-core";

import { lineTotal } from "../treatment/planMath";
import type { TreatmentPlan, TreatmentPlanItem } from "../treatment/types";
import { planCharges } from "./paymentMath";
import type { AccountOperation } from "./types";

/**
 * The data of the printed documents of the cash desk (stage 36): the
 * receipt of an operation and «Акт выполненных работ» of a patient.
 */

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** A line of the act: a done item, a visit, the discount of a plan */
export type ActLine = {
  name: string;
  tooth?: string | null;
  quantity: number;
  date?: string | null;
  amount: number;
  /** A plan discount line (negative amount) */
  discount?: boolean;
};

type VisitLike = {
  id: Identifier;
  patient_id: Identifier;
  deal_id?: Identifier | null;
  service_id?: Identifier | null;
  status: string;
  source?: string;
  starts_at: string;
};
type ServiceLike = { id: Identifier; name: string; price?: number | null };

/**
 * The works done for a patient (optionally of one deal): the done items of
 * the plans that are not declined, a discount line per plan so that the
 * total is what the account charges, the completed priced visits of deals
 * without a plan. The same scope as patient_accounts.charged.
 */
export const actLines = ({
  patientId,
  dealId,
  plans,
  items,
  visits,
  services,
}: {
  patientId: Identifier;
  dealId?: Identifier | null;
  plans: TreatmentPlan[];
  items: TreatmentPlanItem[];
  visits: VisitLike[];
  services: ServiceLike[];
}): ActLine[] => {
  const lines: ActLine[] = [];
  const own = plans
    .filter(
      (plan) =>
        same(plan.patient_id, patientId) &&
        plan.status !== "declined" &&
        (dealId == null || same(plan.deal_id, dealId)),
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const plan of own) {
    const done = items
      .filter((item) => same(item.plan_id, plan.id) && item.done)
      .sort((a, b) => a.stage_no - b.stage_no || a.position - b.position);
    if (!done.length) continue;
    let subtotal = 0;
    for (const item of done) {
      const amount =
        item.line_total ??
        lineTotal(item.quantity, item.unit_price, item.discount_percent);
      subtotal += amount;
      lines.push({
        name: item.name,
        tooth: item.tooth ?? null,
        quantity: item.quantity,
        date: item.done_at ?? null,
        amount,
      });
    }
    const discount = subtotal - planCharges(plan, items).done;
    if (discount > 0) {
      lines.push({
        name: plan.name,
        quantity: 1,
        amount: -discount,
        discount: true,
      });
    }
  }
  const planned = (deal: Identifier | null | undefined) =>
    plans.some(
      (plan) => same(plan.deal_id, deal) && plan.status !== "declined",
    );
  for (const visit of visits
    .filter(
      (v) =>
        same(v.patient_id, patientId) &&
        v.status === "completed" &&
        (v.source ?? "crm") === "crm" &&
        (dealId == null || same(v.deal_id, dealId)) &&
        !planned(v.deal_id),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const service = services.find((s) => same(s.id, visit.service_id));
    const price = Math.round(Number(service?.price ?? 0));
    if (!service || price <= 0) continue;
    lines.push({
      name: service.name,
      quantity: 1,
      date: visit.starts_at,
      amount: price,
    });
  }
  return lines;
};

export const actTotal = (lines: ActLine[]) =>
  lines.reduce((sum, line) => sum + line.amount, 0);

/** The title of a receipt: payment, deposit, payment from it, refund */
export const receiptTitleKey = (
  op: Pick<AccountOperation, "kind" | "account" | "method">,
) =>
  op.kind === "refund"
    ? op.method === "deposit"
      ? "payments.receipt.title_refund_deposit"
      : "payments.receipt.title_refund"
    : op.kind === "deposit"
      ? "payments.receipt.title_deposit"
      : op.kind === "deposit_payment"
        ? "payments.receipt.title_deposit_payment"
        : op.kind === "correction"
          ? "payments.receipt.title_correction"
          : "payments.receipt.title_payment";

/** «Квитанция 125 — Нурланова Асель.pdf», safe for a file system */
export const documentFileName = (...parts: (string | number)[]) =>
  `${parts
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(" — ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120)}.pdf`;
