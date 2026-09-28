import { jsPDF } from "jspdf";

import type { Clinic } from "../payments/receiptPdf";
import { FONT_NAME, type EstimateFonts } from "../treatment/estimatePdf";
import { ruDate } from "./consents";

/**
 * «Информированное согласие» as an A4 PDF built in the browser (jsPDF and
 * the DejaVu Sans fonts of the estimate: Cyrillic), like the receipts of
 * stage 36: the clinic header, the title, the text of the consent with its
 * variables filled in, split into pages, and the signed date when there is
 * one.
 */

export type ConsentPdfData = {
  clinic: Clinic;
  title: string;
  /** The rendered text (renderConsent) */
  body: string;
  patientName: string;
  /** YYYY-MM-DD */
  signedAt?: string | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

const PAGE = { width: 210, height: 297, margin: 18 };
const LINE_HEIGHT = 5.4;

export const buildConsentPdf = (
  data: ConsentPdfData,
  fonts: EstimateFonts,
  translate: Translate,
  { compress = true }: { compress?: boolean } = {},
): Uint8Array => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress });
  doc.addFileToVFS(`${FONT_NAME}.ttf`, fonts.regular);
  doc.addFont(`${FONT_NAME}.ttf`, FONT_NAME, "normal");
  doc.addFileToVFS(`${FONT_NAME}-Bold.ttf`, fonts.bold);
  doc.addFont(`${FONT_NAME}-Bold.ttf`, FONT_NAME, "bold");
  doc.setProperties({ title: data.title, creator: data.clinic.name });
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  const width = right - left;
  const font = (size: number, bold = false, gray = 20) => {
    doc.setFont(FONT_NAME, bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(gray);
  };

  let y = PAGE.margin;
  font(12, true);
  doc.text(data.clinic.name || "", left, y + 4);
  font(8.5, false, 110);
  const contacts = [
    [data.clinic.city, data.clinic.address].filter(Boolean).join(", "),
    data.clinic.phone,
  ].filter(Boolean) as string[];
  contacts.forEach((line, index) => doc.text(line, left, y + 9 + index * 4));
  y += 12 + contacts.length * 4;
  doc.setDrawColor(200);
  doc.setLineWidth(0.2);
  doc.line(left, y, right, y);
  y += 10;

  font(14, true);
  const titleLines: string[] = doc.splitTextToSize(data.title, width);
  doc.text(titleLines, left, y);
  y += titleLines.length * 6.5 + 4;

  font(10.5);
  const paragraphs = data.body.replace(/\r\n/g, "\n").split("\n");
  for (const paragraph of paragraphs) {
    const lines: string[] = paragraph.trim()
      ? doc.splitTextToSize(paragraph, width)
      : [""];
    for (const line of lines) {
      if (y > PAGE.height - PAGE.margin - 10) {
        doc.addPage();
        y = PAGE.margin;
        font(10.5);
      }
      doc.text(line, left, y);
      y += paragraph.trim() ? LINE_HEIGHT : LINE_HEIGHT * 0.6;
    }
  }

  if (data.signedAt) {
    y += 6;
    if (y > PAGE.height - PAGE.margin) {
      doc.addPage();
      y = PAGE.margin;
    }
    font(9.5, false, 110);
    doc.text(
      translate("patient_card.consents.signed_on", {
        date: ruDate(data.signedAt),
      }),
      left,
      y,
    );
  }

  // Page numbers: «1 / 2»
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    font(8, false, 150);
    doc.text(
      `${data.patientName} · ${page} / ${pages}`,
      right,
      PAGE.height - 8,
      { align: "right" },
    );
  }
  return new Uint8Array(doc.output("arraybuffer"));
};
