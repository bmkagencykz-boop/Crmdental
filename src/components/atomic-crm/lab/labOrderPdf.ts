import { jsPDF } from "jspdf";

import { chartRows } from "../dental-chart/teeth";
import { formatTenge } from "../onboarding/servicePresets";
import type { Clinic } from "../payments/receiptPdf";
import { FONT_NAME, type EstimateFonts } from "../treatment/estimatePdf";
import { orderCost, shortDay, teethText } from "./labMath";

/**
 * «Заказ-наряд» for the lab (stage 40): an A4 PDF built in the browser with
 * jsPDF and the DejaVu Sans fonts of the estimate (Cyrillic, «₸»), like the
 * receipts of stage 36 and the consents of stage 37: the clinic, the order
 * number and date, patient, doctor, lab, technician, shade and material,
 * the teeth on a small FDI chart, the works (with the lab prices when the
 * employee sees them), the dates, the comment and the signatures.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type LabOrderPdfData = {
  clinic: Clinic;
  number: number;
  /** YYYY-MM-DD */
  createdAt: string;
  patientName: string;
  patientPhone?: string | null;
  doctorName?: string | null;
  labName?: string | null;
  technicianName?: string | null;
  shade?: string | null;
  material?: string | null;
  teeth: number[];
  sentAt?: string | null;
  fitting1At?: string | null;
  fitting2At?: string | null;
  dueAt?: string | null;
  comment?: string | null;
  /** price: null — the prices are not printed */
  lines: Array<{ name: string; qty: number; price?: number | null }>;
  withPrices: boolean;
};

const PAGE = { width: 210, height: 297, margin: 16 };
const INK = 20;
const MUTED = 110;
const RULE = 200;

const money = (amount: number) => `${formatTenge(amount)} ₸`;

export const buildLabOrderPdf = (
  data: LabOrderPdfData,
  fonts: EstimateFonts,
  translate: Translate,
  { compress = true }: { compress?: boolean } = {},
): Uint8Array => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress });
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fonts.regular);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal");
  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold");
  const title = translate("lab.pdf.title", { number: data.number });
  doc.setProperties({ title, creator: data.clinic.name });
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
  const room = (needed: number) => {
    if (y + needed > PAGE.height - PAGE.margin - 8) {
      doc.addPage();
      y = PAGE.margin;
    }
  };

  // The clinic
  font(12, true);
  doc.text(data.clinic.name || "", left, y + 4);
  font(8.5, false, MUTED);
  const contacts = [
    [data.clinic.city, data.clinic.address].filter(Boolean).join(", "),
    data.clinic.phone,
  ].filter(Boolean) as string[];
  contacts.forEach((line, index) => doc.text(line, left, y + 9 + index * 4));
  y += 12 + contacts.length * 4;
  rule(y);
  y += 10;

  // Title
  font(16, true);
  doc.text(title, left, y);
  font(9.5, false, MUTED);
  doc.text(
    translate("lab.pdf.from", { date: shortDay(data.createdAt, true) }),
    right,
    y,
    { align: "right" },
  );
  y += 9;

  // Details: two columns of «label: value»
  const details: Array<[string, string]> = [
    [
      translate("lab.fields.patient"),
      [data.patientName, data.patientPhone].filter(Boolean).join(", "),
    ],
    [translate("lab.fields.doctor"), data.doctorName ?? "—"],
    [translate("lab.fields.lab"), data.labName ?? "—"],
    [translate("lab.fields.technician"), data.technicianName ?? "—"],
    [translate("lab.fields.shade"), data.shade ?? "—"],
    [translate("lab.fields.material"), data.material ?? "—"],
    [translate("lab.fields.teeth"), teethText(data.teeth) || "—"],
    [translate("lab.fields.sent_at"), shortDay(data.sentAt, true)],
    [translate("lab.fields.fitting1_at"), shortDay(data.fitting1At, true)],
    [translate("lab.fields.fitting2_at"), shortDay(data.fitting2At, true)],
    [translate("lab.fields.due_at"), shortDay(data.dueAt, true)],
  ];
  const column = width / 2;
  details.forEach(([label, value], index) => {
    const x = left + (index % 2) * column;
    const rowY = y + Math.floor(index / 2) * 11;
    font(7.5, false, MUTED);
    doc.text(label.toUpperCase(), x, rowY);
    font(10.5);
    const lines: string[] = doc.splitTextToSize(value || "—", column - 6);
    doc.text(lines[0] ?? "", x, rowY + 5);
  });
  y += Math.ceil(details.length / 2) * 11 + 2;

  // The teeth on the chart (FDI, permanent or primary)
  const primary = data.teeth.some((tooth) => tooth >= 51);
  const rows = chartRows(primary ? "primary" : "permanent");
  const cell = primary ? 9 : 8.5;
  const chartWidth = rows.upper.length * cell;
  const chartLeft = left + (width - chartWidth) / 2;
  room(30);
  font(7.5, false, MUTED);
  doc.text(translate("lab.pdf.chart").toUpperCase(), left, y + 2);
  y += 5;
  (["upper", "lower"] as const).forEach((jaw, row) => {
    rows[jaw].forEach((tooth, index) => {
      const x = chartLeft + index * cell;
      const top = y + row * (cell + 1.5);
      const selected = data.teeth.includes(tooth);
      doc.setDrawColor(selected ? 20 : 190);
      doc.setLineWidth(0.25);
      if (selected) {
        doc.setFillColor(20, 20, 22);
        doc.roundedRect(x + 0.4, top, cell - 0.8, cell, 1.2, 1.2, "FD");
      } else {
        doc.roundedRect(x + 0.4, top, cell - 0.8, cell, 1.2, 1.2, "S");
      }
      font(7.5, selected, selected ? 255 : MUTED);
      doc.text(String(tooth), x + cell / 2, top + cell / 2 + 1.3, {
        align: "center",
      });
    });
  });
  // The midline
  doc.setDrawColor(150);
  doc.line(
    chartLeft + chartWidth / 2,
    y - 1,
    chartLeft + chartWidth / 2,
    y + cell * 2 + 2.5,
  );
  y += cell * 2 + 10;

  // Works
  room(20);
  const cols = data.withPrices
    ? {
        no: left,
        name: left + 9,
        qty: right - 62,
        price: right - 32,
        sum: right,
      }
    : { no: left, name: left + 9, qty: right, price: 0, sum: 0 };
  font(7.5, false, MUTED);
  doc.text("№", cols.no, y);
  doc.text(translate("lab.pdf.work").toUpperCase(), cols.name, y);
  doc.text(translate("lab.fields.qty").toUpperCase(), cols.qty, y, {
    align: "right",
  });
  if (data.withPrices) {
    doc.text(translate("lab.pdf.price").toUpperCase(), cols.price, y, {
      align: "right",
    });
    doc.text(translate("lab.pdf.sum").toUpperCase(), cols.sum, y, {
      align: "right",
    });
  }
  y += 2.5;
  rule(y);
  y += 5.5;
  data.lines.forEach((line, index) => {
    const nameWidth = cols.qty - 16 - cols.name;
    const nameLines: string[] = doc.splitTextToSize(line.name, nameWidth);
    room(nameLines.length * 5 + 3);
    font(10);
    doc.text(String(index + 1), cols.no, y);
    doc.text(nameLines, cols.name, y);
    doc.text(String(line.qty), cols.qty, y, { align: "right" });
    if (data.withPrices) {
      doc.text(money(Number(line.price ?? 0)), cols.price, y, {
        align: "right",
      });
      doc.text(money(Number(line.qty) * Number(line.price ?? 0)), cols.sum, y, {
        align: "right",
      });
    }
    y += nameLines.length * 5 + 2;
  });
  if (!data.lines.length) {
    font(10, false, MUTED);
    doc.text("—", cols.name, y);
    y += 7;
  }
  rule(y - 2);
  if (data.withPrices) {
    y += 4;
    font(11, true);
    doc.text(translate("lab.pdf.total"), cols.price, y, { align: "right" });
    doc.text(money(orderCost(data.lines)), cols.sum, y, { align: "right" });
    y += 4;
  }
  y += 6;

  // Comment
  if (data.comment) {
    const lines: string[] = doc.splitTextToSize(data.comment, width);
    room(lines.length * 5 + 10);
    font(7.5, false, MUTED);
    doc.text(translate("lab.fields.comment").toUpperCase(), left, y);
    y += 5;
    font(10);
    for (const line of lines) {
      room(6);
      doc.text(line, left, y);
      y += 5;
    }
    y += 4;
  }

  // Signatures
  room(26);
  y += 8;
  const signatures = [
    translate("lab.pdf.sign_doctor"),
    translate("lab.pdf.sign_technician"),
    translate("lab.pdf.sign_received"),
  ];
  const third = width / 3;
  signatures.forEach((label, index) => {
    const x = left + index * third;
    doc.setDrawColor(120);
    doc.line(x, y, x + third - 8, y);
    font(8, false, MUTED);
    doc.text(label, x, y + 4.5);
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    font(8, false, 150);
    doc.text(
      `${translate("lab.pdf.title", { number: data.number })} · ${page} / ${pages}`,
      right,
      PAGE.height - 8,
      { align: "right" },
    );
  }
  return new Uint8Array(doc.output("arraybuffer"));
};
