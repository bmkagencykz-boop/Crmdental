import { jsPDF } from "jspdf";

import { formatTenge } from "../onboarding/servicePresets";
import type { Clinic } from "../payments/receiptPdf";
import { FONT_NAME, type EstimateFonts } from "../treatment/estimatePdf";
import { shortDay } from "./labMath";
import type { LabReconciliation, LabReconciliationLine } from "./types";

/**
 * «Акт сверки» with a lab (stage 43): an A4 PDF built in the browser with
 * jsPDF and the DejaVu fonts of the estimate (Cyrillic, «₸»), like the
 * order PDF: the clinic, the lab and the period, the opening balance, the
 * works billed and the payments by date, the totals, the closing balance
 * and the signatures of both sides.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PAGE = { width: 210, height: 297, margin: 16 };
const INK = 20;
const MUTED = 110;
const RULE = 200;

const money = (amount: number) => `${formatTenge(Math.round(amount))} ₸`;

/** The document of a line: «Наряд № 12», «Переделка № 12», «Оплата» */
export const actDocument = (
  line: LabReconciliationLine,
  translate: Translate,
) =>
  line.kind === "payment"
    ? translate("lab_plus.act.payment_doc", {
        method: translate(
          line.method === "other"
            ? "cash_out.lab.methods.other"
            : `payments.methods.${line.method}`,
        ),
      })
    : translate(
        line.kind === "remake"
          ? "lab_plus.act.remake_doc"
          : "lab_plus.act.order_doc",
        { number: line.number ?? "" },
      );

/** What a line is about: the patient and the works, or the payment */
export const actBasis = (line: LabReconciliationLine, translate: Translate) =>
  line.kind === "payment"
    ? [
        line.orders
          ? translate("lab_plus.act.for_orders", { orders: line.orders })
          : null,
        line.comment,
      ]
        .filter(Boolean)
        .join(" · ")
    : [line.patient_name, line.works].filter(Boolean).join(" · ");

export const buildLabActPdf = (
  act: LabReconciliation,
  clinic: Clinic,
  fonts: EstimateFonts,
  translate: Translate,
  { compress = true }: { compress?: boolean } = {},
): Uint8Array => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress });
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fonts.regular);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal");
  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold");
  const title = translate("lab_plus.act.title");
  doc.setProperties({ title, creator: clinic.name });
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  const font = (size: number, bold = false, gray = INK) => {
    doc.setFont(FONT_NAME, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray);
  };
  const rule = (at: number) => {
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.line(left, at, right, at);
  };
  let y = PAGE.margin;

  // The clinic
  font(12, true);
  doc.text(clinic.name || "", left, y + 4);
  font(8.5, false, MUTED);
  const contacts = [
    [clinic.city, clinic.address].filter(Boolean).join(", "),
    clinic.phone,
  ].filter(Boolean) as string[];
  contacts.forEach((line, index) => doc.text(line, left, y + 9 + index * 4));
  y += 12 + contacts.length * 4;
  rule(y);
  y += 10;

  font(16, true);
  doc.text(title, left, y);
  y += 7;
  font(10, false, MUTED);
  doc.text(
    translate("lab_plus.act.subtitle", {
      lab: act.lab_name,
      from: shortDay(act.period_from, true),
      to: shortDay(act.period_to, true),
    }),
    left,
    y,
  );
  y += 10;

  // The table
  const cols = {
    day: left,
    doc: left + 22,
    basis: left + 62,
    debit: right - 30,
    credit: right,
  };
  const header = () => {
    font(7.5, false, MUTED);
    doc.text(translate("lab_plus.act.day").toUpperCase(), cols.day, y);
    doc.text(translate("lab_plus.act.document").toUpperCase(), cols.doc, y);
    doc.text(translate("lab_plus.act.basis").toUpperCase(), cols.basis, y);
    doc.text(translate("lab_plus.act.debit").toUpperCase(), cols.debit, y, {
      align: "right",
    });
    doc.text(translate("lab_plus.act.credit").toUpperCase(), cols.credit, y, {
      align: "right",
    });
    y += 2.5;
    rule(y);
    y += 5.5;
  };
  const room = (needed: number) => {
    if (y + needed > PAGE.height - PAGE.margin - 10) {
      doc.addPage();
      y = PAGE.margin;
      header();
    }
  };
  header();
  const summaryRow = (label: string, debit: number, credit: number) => {
    room(8);
    font(9.5, true);
    doc.text(label, cols.doc, y);
    if (debit) doc.text(money(debit), cols.debit, y, { align: "right" });
    if (credit) doc.text(money(credit), cols.credit, y, { align: "right" });
    y += 6.5;
  };
  summaryRow(
    translate("lab_plus.act.opening"),
    Math.max(act.opening, 0),
    Math.max(-act.opening, 0),
  );
  for (const line of act.lines) {
    const basis: string[] = doc.splitTextToSize(
      actBasis(line, translate) || "—",
      cols.debit - 26 - cols.basis,
    );
    room(basis.length * 4.5 + 3);
    font(9);
    doc.text(shortDay(line.day, true), cols.day, y);
    doc.text(actDocument(line, translate), cols.doc, y);
    font(8.5, false, 60);
    doc.text(basis, cols.basis, y);
    font(9);
    if (line.debit)
      doc.text(money(line.debit), cols.debit, y, { align: "right" });
    if (line.credit) {
      doc.text(money(line.credit), cols.credit, y, { align: "right" });
    }
    y += basis.length * 4.5 + 2;
  }
  if (!act.lines.length) {
    font(9, false, MUTED);
    doc.text(translate("lab_plus.act.no_lines"), cols.doc, y);
    y += 6;
  }
  rule(y - 2);
  y += 3;
  summaryRow(translate("lab_plus.act.turnover"), act.charged, act.paid);
  summaryRow(
    translate("lab_plus.act.closing"),
    Math.max(act.closing, 0),
    Math.max(-act.closing, 0),
  );
  y += 4;
  room(14);
  font(10);
  const verdict =
    act.closing > 0
      ? translate("lab_plus.act.clinic_owes", { amount: money(act.closing) })
      : act.closing < 0
        ? translate("lab_plus.act.lab_owes", { amount: money(-act.closing) })
        : translate("lab_plus.act.settled");
  doc.text(doc.splitTextToSize(verdict, width), left, y);
  y += 16;

  // Signatures
  room(24);
  const half = width / 2;
  [
    translate("lab_plus.act.sign_clinic"),
    translate("lab_plus.act.sign_lab"),
  ].forEach((label, index) => {
    const x = left + index * half;
    font(8.5, false, MUTED);
    doc.text(label, x, y);
    doc.setDrawColor(120);
    doc.line(x, y + 12, x + half - 10, y + 12);
    font(7.5, false, MUTED);
    doc.text(translate("lab_plus.act.sign_hint"), x, y + 16);
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    font(8, false, 150);
    doc.text(
      `${title} · ${act.lab_name} · ${page} / ${pages}`,
      right,
      PAGE.height - 8,
      {
        align: "right",
      },
    );
  }
  return new Uint8Array(doc.output("arraybuffer"));
};
