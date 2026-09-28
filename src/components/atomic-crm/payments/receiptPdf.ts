import { jsPDF } from "jspdf";

import { formatTenge } from "../onboarding/servicePresets";
import { FONT_NAME, type EstimateFonts } from "../treatment/estimatePdf";
import { formatDate } from "../treatment/format";
import { actTotal, receiptTitleKey, type ActLine } from "./documents";
import { changeDue, methodParts } from "./paymentMath";
import type { AccountOperationSummary } from "./types";

/**
 * The printed documents of the cash desk (stage 36), A4 built in the
 * browser with jsPDF and the fonts of the estimate (DejaVu Sans: Cyrillic
 * and «₸», estimateFonts.ts): «Квитанция» of an operation and «Акт
 * выполненных работ» of a patient.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type Clinic = {
  name: string;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
};

export type ReceiptData = {
  clinic: Clinic;
  operation: AccountOperationSummary;
  /** The account after the operation */
  account?: { deposit: number; debt: number } | null;
};

export type ActData = {
  clinic: Clinic;
  patient: { id: string | number; name: string; phone?: string | null };
  lines: ActLine[];
  paid: number;
  date: Date;
  doctor?: string | null;
};

const PAGE = { width: 210, height: 297, margin: 15 };
const INK = 20;
const MUTED = 110;
const LINE = 200;

const money = (amount: number) =>
  `${amount < 0 ? "− " : ""}${formatTenge(Math.abs(amount))} ₸`;
const pad = (n: number) => String(n).padStart(2, "0");
const dateTime = (value: string) => {
  const date = new Date(value);
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A page with the clinic header; returns the drawing helpers */
const start = (
  fonts: EstimateFonts,
  clinic: Clinic,
  title: string,
  number: string,
  when: string,
  compress: boolean,
) => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress });
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fonts.regular);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal");
  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold");
  doc.setProperties({ title, creator: clinic.name });
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
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
  let y = PAGE.margin;
  font(13, true);
  doc.text(clinic.name, left, y + 4);
  font(8.5, false, MUTED);
  const contacts = [
    [clinic.city, clinic.address].filter(Boolean).join(", "),
    clinic.phone,
  ].filter(Boolean) as string[];
  contacts.forEach((line, index) => doc.text(line, left, y + 9 + index * 4));
  font(9, false, MUTED);
  doc.text(number, right, y + 4, { align: "right" });
  doc.text(when, right, y + 9, { align: "right" });
  y += 11 + contacts.length * 4;
  rule(y);
  y += 10;
  font(16, true);
  doc.text(title, left, y);
  y += 9;
  return { doc, font, rule, left, right, y };
};

const facts = (
  ctx: ReturnType<typeof start>,
  rows: [string, string | null | undefined][],
) => {
  for (const [label, value] of rows) {
    if (!value) continue;
    ctx.font(9.5, false, MUTED);
    ctx.doc.text(label, ctx.left, ctx.y);
    ctx.font(9.5, false);
    ctx.doc.text(value, ctx.left + 32, ctx.y);
    ctx.y += 5.5;
  }
};

const signature = (
  ctx: ReturnType<typeof start>,
  label: string,
  name: string | null | undefined,
  x: number,
) => {
  ctx.doc.setDrawColor(120);
  ctx.doc.line(x, ctx.y, x + 78, ctx.y);
  ctx.font(8.5, false, MUTED);
  ctx.doc.text(label, x, ctx.y + 4.5);
  if (name) ctx.doc.text(name, x + 78, ctx.y + 4.5, { align: "right" });
};

/** «Квитанция»: the operation, its methods, the change, the account after */
export const buildReceiptPdf = (
  data: ReceiptData,
  fonts: EstimateFonts,
  translate: Translate,
  { compress = true }: { compress?: boolean } = {},
): Uint8Array => {
  const op = data.operation;
  const ctx = start(
    fonts,
    data.clinic,
    translate(receiptTitleKey(op)),
    translate("payments.receipt.number", { id: op.id }),
    dateTime(op.occurred_at),
    compress,
  );
  const { doc, font, rule, left, right } = ctx;
  facts(ctx, [
    [translate("payments.receipt.patient"), op.patient_name],
    [translate("payments.receipt.phone"), op.patient_phone],
    [translate("payments.receipt.deal"), op.deal_name],
    [translate("payments.receipt.plan"), op.plan_name],
    [translate("payments.receipt.branch"), op.branch_name],
    [translate("payments.receipt.cashier"), op.cashier_name],
  ]);
  ctx.y += 4;

  // Methods and amounts
  font(8, true, MUTED);
  doc.text(translate("payments.receipt.method"), left, ctx.y);
  doc.text(translate("payments.receipt.amount"), right, ctx.y, {
    align: "right",
  });
  ctx.y += 2;
  rule(ctx.y, 150);
  ctx.y += 5;
  const parts = methodParts(op);
  const rows = parts.length
    ? parts.map(
        (part) =>
          [translate(`payments.methods.${part.method}`), part.amount] as const,
      )
    : ([
        [
          translate(`payments.methods.${op.method}`, { _: op.method }),
          Math.abs(op.amount),
        ],
      ] as const);
  for (const [label, amount] of rows) {
    font(10, false);
    doc.text(label, left, ctx.y);
    doc.text(money(amount), right, ctx.y, { align: "right" });
    ctx.y += 6;
  }
  rule(ctx.y - 3.5, 230);
  ctx.y += 2;
  const total = (label: string, value: string, bold = false) => {
    font(bold ? 12 : 9.5, bold, bold ? INK : MUTED);
    doc.text(label, right - 50, ctx.y, { align: "right" });
    font(bold ? 12 : 9.5, bold);
    doc.text(value, right, ctx.y, { align: "right" });
    ctx.y += bold ? 8 : 5.5;
  };
  total(translate("payments.receipt.total"), money(op.amount), true);
  const change = changeDue(op, op.cash_received);
  if (op.cash_received != null && change != null) {
    total(translate("payments.receipt.cash_received"), money(op.cash_received));
    total(translate("payments.receipt.change"), money(change));
  }
  if (data.account) {
    total(
      translate("payments.receipt.deposit_after"),
      money(data.account.deposit),
    );
    if (data.account.debt > 0) {
      total(translate("payments.receipt.debt_after"), money(data.account.debt));
    }
  }
  if (op.comment?.trim()) {
    ctx.y += 3;
    font(9, false);
    const lines = doc.splitTextToSize(
      op.comment.trim(),
      right - left,
    ) as string[];
    doc.text(lines, left, ctx.y);
    ctx.y += lines.length * 4.2;
  }
  ctx.y += 18;
  signature(
    ctx,
    translate("payments.receipt.sign_cashier"),
    op.cashier_name,
    left,
  );
  signature(
    ctx,
    translate("payments.receipt.sign_patient"),
    op.patient_name,
    right - 78,
  );
  return new Uint8Array(doc.output("arraybuffer"));
};

/** «Акт выполненных работ»: the works done, paid, the debt */
export const buildActPdf = (
  data: ActData,
  fonts: EstimateFonts,
  translate: Translate,
  { compress = true }: { compress?: boolean } = {},
): Uint8Array => {
  const ctx = start(
    fonts,
    data.clinic,
    translate("payments.act.title"),
    translate("payments.act.number", {
      id: `${data.patient.id}-${formatDate(data.date).replace(/\./g, "")}`,
    }),
    formatDate(data.date),
    compress,
  );
  const { doc, font, rule, left, right } = ctx;
  facts(ctx, [
    [translate("payments.receipt.patient"), data.patient.name],
    [translate("payments.receipt.phone"), data.patient.phone],
    [translate("payments.act.doctor"), data.doctor],
  ]);
  ctx.y += 4;

  const columns = [
    { key: "no", width: 9, align: "left" as const },
    { key: "service", width: 88, align: "left" as const },
    { key: "tooth", width: 20, align: "left" as const },
    { key: "qty", width: 12, align: "right" as const },
    { key: "date", width: 23, align: "right" as const },
    { key: "sum", width: 28, align: "right" as const },
  ];
  const columnX = (index: number) => {
    const from =
      left + columns.slice(0, index).reduce((sum, c) => sum + c.width, 0);
    return columns[index].align === "right"
      ? from + columns[index].width
      : from;
  };
  const header = () => {
    font(8, true, MUTED);
    columns.forEach((column, index) =>
      doc.text(
        translate(`payments.act.columns.${column.key}`),
        columnX(index),
        ctx.y,
        { align: column.align },
      ),
    );
    ctx.y += 2;
    rule(ctx.y, 150);
    ctx.y += 4.5;
  };
  const ensureSpace = (needed: number, withHeader = true) => {
    if (ctx.y + needed <= PAGE.height - PAGE.margin - 8) return;
    doc.addPage();
    ctx.y = PAGE.margin + 4;
    if (withHeader) header();
  };
  header();
  if (!data.lines.length) {
    font(9.5, false, MUTED);
    doc.text(translate("payments.act.empty"), left, ctx.y);
    ctx.y += 6;
  }
  let number = 0;
  for (const line of data.lines) {
    font(9, false);
    const name = line.discount
      ? translate("payments.act.plan_discount", { name: line.name })
      : line.name;
    const nameLines = doc.splitTextToSize(
      name,
      columns[1].width - 2,
    ) as string[];
    const height = Math.max(1, nameLines.length) * 4.2 + 1.3;
    ensureSpace(height);
    font(9, false, line.discount ? MUTED : INK);
    const cells = [
      line.discount ? "" : String(++number),
      nameLines,
      line.tooth ?? "",
      line.discount ? "" : String(line.quantity),
      line.date ? formatDate(new Date(line.date)) : "",
      money(line.amount),
    ];
    cells.forEach((cell, index) =>
      doc.text(cell, columnX(index), ctx.y, { align: columns[index].align }),
    );
    ctx.y += height;
    rule(ctx.y - 3.3, 230);
  }

  ensureSpace(40, false);
  ctx.y += 3;
  const done = actTotal(data.lines);
  const total = (label: string, value: string, bold = false) => {
    font(bold ? 11 : 9.5, bold, bold ? INK : MUTED);
    doc.text(label, right - 50, ctx.y, { align: "right" });
    font(bold ? 11 : 9.5, bold);
    doc.text(value, right, ctx.y, { align: "right" });
    ctx.y += bold ? 7 : 5.5;
  };
  total(translate("payments.act.total"), money(done), true);
  total(translate("payments.act.paid"), money(data.paid));
  if (done - data.paid > 0) {
    total(translate("payments.act.debt"), money(done - data.paid));
  } else if (data.paid - done > 0) {
    total(translate("payments.act.advance"), money(data.paid - done));
  }
  ctx.y += 4;
  font(9, false, MUTED);
  doc.text(translate("payments.act.statement"), left, ctx.y);
  ctx.y += 18;
  signature(ctx, translate("payments.act.sign_clinic"), null, left);
  signature(
    ctx,
    translate("payments.act.sign_patient"),
    data.patient.name,
    right - 78,
  );

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
