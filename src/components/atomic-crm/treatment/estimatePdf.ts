import { jsPDF } from "jspdf";

import { formatTenge } from "../onboarding/servicePresets";
import { formatDate } from "./format";
import { lineTotal, planTotals } from "./planMath";
import type { TreatmentPlan, TreatmentPlanItem } from "./types";

/**
 * «Смета PDF»: a clean A4 estimate built in the browser with jsPDF. The
 * text uses an embedded TrueType font with Cyrillic and «₸» (DejaVu Sans,
 * loaded by estimateFonts.ts); jsPDF embeds only the glyphs used.
 */

export type EstimateFonts = {
  /** TrueType fonts, base64 */
  regular: string;
  bold: string;
};

export type EstimateData = {
  clinic: {
    name: string;
    city?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  patient: { name: string; phone?: string | null };
  plan: Pick<
    TreatmentPlan,
    "id" | "name" | "discount_percent" | "discount_amount" | "note"
  >;
  items: TreatmentPlanItem[];
  doctor?: string | null;
  date: Date;
  /** «Смета действительна N дней» */
  validDays?: number;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const FONT_NAME = "DejaVuSans";

const PAGE = { width: 210, height: 297, margin: 15 };
const INK = 20;
const MUTED = 110;
const LINE = 200;

const money = (amount: number) => `${formatTenge(amount)} ₸`;
const percent = (value: number) =>
  `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;

export const buildEstimatePdf = (
  data: EstimateData,
  fonts: EstimateFonts,
  translate: Translate,
  { compress = true }: { compress?: boolean } = {},
): Uint8Array => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress });
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fonts.regular);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal");
  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold");
  doc.setProperties({
    title: translate("treatment.pdf.title"),
    subject: data.plan.name,
    creator: data.clinic.name,
  });

  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  let y = PAGE.margin;

  const font = (size: number, bold = false, gray = INK) => {
    doc.setFont(FONT_NAME, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray);
  };
  const rule = (at: number, gray = LINE) => {
    doc.setDrawColor(gray);
    doc.setLineWidth(0.2);
    doc.line(left, at, right, at);
  };

  // Header: the clinic on the left, the number and the date on the right
  font(13, true);
  doc.text(data.clinic.name, left, y + 4);
  font(8.5, false, MUTED);
  const contacts = [
    [data.clinic.city, data.clinic.address].filter(Boolean).join(", "),
    data.clinic.phone,
  ].filter(Boolean) as string[];
  contacts.forEach((line, index) => doc.text(line, left, y + 9 + index * 4));
  font(9, false, MUTED);
  doc.text(
    translate("treatment.pdf.number", { id: data.plan.id }),
    right,
    y + 4,
    { align: "right" },
  );
  doc.text(formatDate(data.date), right, y + 9, { align: "right" });
  y += 11 + contacts.length * 4;
  rule(y);
  y += 9;

  font(16, true);
  doc.text(translate("treatment.pdf.title"), left, y);
  y += 6;
  font(10, false, MUTED);
  doc.text(data.plan.name, left, y);
  y += 8;

  // Patient, doctor, date
  const facts: [string, string][] = [
    [translate("treatment.pdf.patient"), data.patient.name],
    ...(data.patient.phone
      ? ([[translate("treatment.pdf.phone"), data.patient.phone]] as [
          string,
          string,
        ][])
      : []),
    ...(data.doctor
      ? ([[translate("treatment.pdf.doctor"), data.doctor]] as [
          string,
          string,
        ][])
      : []),
    [translate("treatment.pdf.date"), formatDate(data.date)],
  ];
  for (const [label, value] of facts) {
    font(9.5, false, MUTED);
    doc.text(label, left, y);
    font(9.5, false);
    doc.text(value, left + 28, y);
    y += 5;
  }
  y += 4;

  // Table
  const columns = [
    { key: "no", width: 9, align: "left" as const },
    { key: "service", width: 77, align: "left" as const },
    { key: "tooth", width: 20, align: "left" as const },
    { key: "qty", width: 13, align: "right" as const },
    { key: "price", width: 24, align: "right" as const },
    { key: "discount", width: 14, align: "right" as const },
    { key: "sum", width: 23, align: "right" as const },
  ];
  const columnX = (index: number) => {
    const start =
      left + columns.slice(0, index).reduce((sum, c) => sum + c.width, 0);
    return columns[index].align === "right"
      ? start + columns[index].width
      : start;
  };
  const header = () => {
    font(8, true, MUTED);
    columns.forEach((column, index) =>
      doc.text(
        translate(`treatment.pdf.columns.${column.key}`),
        columnX(index),
        y,
        { align: column.align },
      ),
    );
    y += 2;
    rule(y, 150);
    y += 4.5;
  };
  const ensureSpace = (needed: number, withHeader = true) => {
    if (y + needed <= PAGE.height - PAGE.margin - 8) return;
    doc.addPage();
    y = PAGE.margin + 4;
    if (withHeader) header();
  };

  header();
  const totals = planTotals(data.plan, data.items);
  let number = 0;
  for (const stage of totals.stages) {
    ensureSpace(12);
    font(9, true);
    doc.text(translate("treatment.stage", { n: stage.stage_no }), left, y);
    font(9, false, MUTED);
    doc.text(money(stage.subtotal), right, y, { align: "right" });
    y += 5;
    for (const item of stage.items) {
      number++;
      font(9, false);
      const nameLines = doc.splitTextToSize(
        item.name,
        columns[1].width - 2,
      ) as string[];
      const height = Math.max(1, nameLines.length) * 4.2 + 1.3;
      ensureSpace(height);
      font(9, false);
      const cells = [
        String(number),
        nameLines,
        item.tooth ?? "",
        String(item.quantity),
        money(item.unit_price),
        Number(item.discount_percent) > 0 ? percent(item.discount_percent) : "",
        money(lineTotal(item.quantity, item.unit_price, item.discount_percent)),
      ];
      cells.forEach((cell, index) =>
        doc.text(cell, columnX(index), y, { align: columns[index].align }),
      );
      y += height;
      rule(y - 3.3, 230);
    }
    y += 2;
  }

  // Totals
  ensureSpace(34, false);
  y += 2;
  const totalLine = (label: string, value: string, bold = false) => {
    font(bold ? 11 : 9.5, bold, bold ? INK : MUTED);
    doc.text(label, right - 45, y, { align: "right" });
    font(bold ? 11 : 9.5, bold);
    doc.text(value, right, y, { align: "right" });
    y += bold ? 7 : 5;
  };
  totalLine(translate("treatment.totals.gross"), money(totals.gross));
  if (totals.itemsDiscount > 0) {
    totalLine(
      translate("treatment.totals.items_discount"),
      `− ${money(totals.itemsDiscount)}`,
    );
  }
  if (totals.planDiscount > 0) {
    const parts = [
      Number(data.plan.discount_percent) > 0
        ? percent(data.plan.discount_percent)
        : null,
      Number(data.plan.discount_amount) > 0
        ? money(data.plan.discount_amount)
        : null,
    ].filter(Boolean);
    totalLine(
      `${translate("treatment.totals.plan_discount")} (${parts.join(" + ")})`,
      `− ${money(totals.planDiscount)}`,
    );
  }
  y += 1;
  doc.setDrawColor(150);
  doc.line(right - 80, y - 4, right, y - 4);
  totalLine(translate("treatment.totals.total"), money(totals.total), true);

  // Note, validity, signatures
  y += 2;
  if (data.plan.note?.trim()) {
    font(9, false);
    const lines = doc.splitTextToSize(data.plan.note.trim(), width) as string[];
    ensureSpace(lines.length * 4.2 + 4, false);
    doc.text(lines, left, y);
    y += lines.length * 4.2 + 2;
  }
  ensureSpace(40, false);
  font(9, false, MUTED);
  doc.text(
    translate("treatment.pdf.valid", { days: data.validDays ?? 30 }),
    left,
    y,
  );
  y += 5;
  doc.text(translate("treatment.pdf.disclaimer"), left, y);
  y += 16;
  const signature = (
    label: string,
    name: string | null | undefined,
    x: number,
  ) => {
    doc.setDrawColor(120);
    doc.line(x, y, x + 78, y);
    font(8.5, false, MUTED);
    doc.text(label, x, y + 4.5);
    if (name) doc.text(name, x + 78, y + 4.5, { align: "right" });
  };
  signature(translate("treatment.pdf.sign_doctor"), data.doctor, left);
  signature(
    translate("treatment.pdf.sign_patient"),
    data.patient.name,
    right - 78,
  );
  y += 12;
  font(8.5, false, MUTED);
  doc.text(translate("treatment.pdf.acknowledged"), left, y);

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    font(7.5, false, MUTED);
    doc.text(
      `${data.clinic.name} · ${translate("treatment.pdf.page", { page, pages })}`,
      PAGE.width / 2,
      PAGE.height - 8,
      { align: "center" },
    );
  }

  return new Uint8Array(doc.output("arraybuffer"));
};
