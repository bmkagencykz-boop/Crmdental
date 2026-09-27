import type { Deal, DealFile, Message } from "../../../types";
import type { Db } from "./types";

/*
 * Demo files (stage 22): drawn inline (SVG) or built here (PDF), never
 * fetched from another host. The demo keeps every file as a data: URL.
 */

const svg = (body: string, width = 640, height = 360) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )}`;

const teeth = (y: number, height: number, flip = false) =>
  Array.from({ length: 14 }, (_, index) => {
    const x = 70 + index * 36;
    const h = height - Math.abs(index - 6.5) * 4;
    return `<rect x="${x}" y="${flip ? y : y - h}" width="28" height="${h}" rx="12" fill="white" fill-opacity="${0.55 + (index % 3) * 0.12}"/>`;
  }).join("");

/** A panoramic X-ray, as the clinic's own image */
export const DEMO_XRAY = svg(
  `<rect width="640" height="360" fill="black"/>` +
    `<ellipse cx="320" cy="180" rx="290" ry="150" fill="dimgray" fill-opacity="0.35"/>` +
    teeth(175, 90) +
    teeth(190, 80, true) +
    `<text x="24" y="340" font-family="sans-serif" font-size="16" fill="white" fill-opacity="0.7">ОПТГ · Жемчуг Дентал</text>`,
);

/** A photo the patient took of their tooth */
export const DEMO_TOOTH_PHOTO = svg(
  `<rect width="480" height="360" fill="rosybrown"/>` +
    `<ellipse cx="240" cy="200" rx="200" ry="120" fill="indianred"/>` +
    `<rect x="100" y="120" width="280" height="70" rx="20" fill="ivory"/>` +
    `<rect x="180" y="126" width="46" height="60" rx="14" fill="burlywood"/>` +
    `<circle cx="203" cy="150" r="9" fill="saddlebrown"/>`,
  480,
  360,
);

/** A photo of the smile before treatment */
export const DEMO_SMILE_PHOTO = svg(
  `<rect width="480" height="320" fill="peachpuff"/>` +
    `<path d="M60 150 Q240 300 420 150 Q240 200 60 150 Z" fill="firebrick"/>` +
    `<path d="M90 160 Q240 215 390 160 L390 175 Q240 235 90 175 Z" fill="ivory"/>`,
  480,
  320,
);

const pdf = (title: string, lines: string[]) => {
  const text = [
    `BT /F1 22 Tf 72 770 Td (${title}) Tj ET`,
    ...lines.map(
      (line, index) => `BT /F1 13 Tf 72 ${730 - index * 22} Td (${line}) Tj ET`,
    ),
  ].join("\n");
  const source = [
    "%PDF-1.4",
    "1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj",
    "2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj",
    "3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj",
    `4 0 obj <</Length ${text.length}>> stream\n${text}\nendstream endobj`,
    "5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj",
    "trailer <</Root 1 0 R>>",
    "%%EOF",
  ].join("\n");
  return `data:application/pdf;base64,${btoa(source)}`;
};

/** Treatment plan (Latin letters: the built-in PDF font has no Cyrillic) */
export const DEMO_PLAN_PDF = pdf("Treatment plan", [
  "Zhemchug Dental clinic",
  "1. Consultation and CT scan - 15 000 KZT",
  "2. Implant placement - 280 000 KZT",
  "3. Crown - 120 000 KZT",
]);

export const DEMO_ANALYSIS_PDF = pdf("Lab results", [
  "Complete blood count: normal",
  "Glucose: 5.1 mmol/l",
]);

const size = (url: string) =>
  Math.round(decodeURIComponent(url.split(",")[1] ?? "").length * 0.75);

type DemoFile = { name: string; mime: string; path: string };

const XRAY: DemoFile = {
  name: "Панорамный снимок.svg",
  mime: "image/svg+xml",
  path: DEMO_XRAY,
};
const SMILE: DemoFile = {
  name: "Фото до лечения.svg",
  mime: "image/svg+xml",
  path: DEMO_SMILE_PHOTO,
};
const PLAN: DemoFile = {
  name: "План лечения.pdf",
  mime: "application/pdf",
  path: DEMO_PLAN_PDF,
};
const TOOTH: DemoFile = {
  name: "photo.svg",
  mime: "image/svg+xml",
  path: DEMO_TOOTH_PHOTO,
};
const ANALYSIS: DemoFile = {
  name: "Анализы.pdf",
  mime: "application/pdf",
  path: DEMO_ANALYSIS_PDF,
};

/**
 * Files of the demo deals: uploads on the «Файлы» tab, and in some
 * conversations a photo from the patient and a treatment plan sent back.
 */
export const generateDealFiles = (db: Db) => {
  db.deal_files = [];
  let fileId = 0;
  const addFile = (
    deal: Deal,
    file: DemoFile,
    at: string,
    salesId: Deal["sales_id"] | null,
    messageId: Message["id"] | null = null,
  ): DealFile => {
    const row: DealFile = {
      id: fileId++,
      deal_id: deal.id,
      patient_id: deal.patient_id,
      path: file.path,
      name: file.name,
      size: size(file.path),
      mime: file.mime,
      sales_id: salesId ?? null,
      message_id: messageId,
      created_at: at,
    };
    db.deal_files.push(row);
    return row;
  };

  const withMessages = [...new Set(db.messages.map((m) => m.deal_id))]
    .map((id) => db.deals.find((deal) => deal.id === id))
    .filter((deal): deal is Deal => deal != null);
  let messageId =
    db.messages.reduce(
      (max, message) => Math.max(max, Number(message.id)),
      -1,
    ) + 1;

  // A photo from the patient, then the plan sent back (the last in the chat)
  withMessages.slice(0, 4).forEach((deal, index) => {
    const conversation = db.messages
      .filter((message) => message.deal_id === deal.id)
      .sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const last = conversation.at(-1)!;
    const lastAt = new Date(last.sent_at).getTime();
    const inAt = new Date(lastAt + 60 * 1000).toISOString();
    const outAt = new Date(
      Math.min(lastAt + 4 * 60 * 1000, Date.now() - 30 * 1000),
    ).toISOString();
    const photo = index % 2 === 0 ? TOOTH : ANALYSIS;
    const incoming: Message = {
      ...last,
      id: messageId++,
      direction: "in",
      sales_id: null,
      text:
        photo === TOOTH
          ? "Вот фото, болит вот этот зуб"
          : "Отправляю анализы, как просили",
      content_type: photo === TOOTH ? "image" : "document",
      status: "inbound",
      sent_at: inAt,
      read_at: inAt,
      automessage_id: null,
      attachment_path: photo.path,
      attachment_name: photo.name,
      attachment_mime: photo.mime,
      attachment_size: size(photo.path),
    };
    const outgoing: Message = {
      ...incoming,
      id: messageId++,
      direction: "out",
      sales_id: deal.sales_id ?? null,
      text: "Спасибо! Отправляю предварительный план лечения",
      content_type: "document",
      status: "read",
      sent_at: outAt,
      read_at: null,
      attachment_path: PLAN.path,
      attachment_name: PLAN.name,
      attachment_mime: PLAN.mime,
      attachment_size: size(PLAN.path),
    };
    db.messages.push(incoming, outgoing);
    addFile(deal, photo, inAt, null, incoming.id);
    addFile(deal, PLAN, outAt, deal.sales_id, outgoing.id);
  });

  // Uploaded on the «Файлы» tab: an X-ray and a photo before treatment
  db.deals
    .filter((deal) => deal.sales_id != null)
    .slice(0, 8)
    .forEach((deal, index) => {
      const at = new Date(
        Math.max(
          new Date(deal.created_at).getTime() + 2 * 60 * 60 * 1000,
          Date.now() - (index + 2) * 24 * 60 * 60 * 1000,
        ),
      );
      const when = new Date(
        Math.min(at.getTime(), Date.now() - 60 * 60 * 1000),
      );
      addFile(deal, XRAY, when.toISOString(), deal.sales_id);
      if (index % 2 === 0) {
        addFile(
          deal,
          SMILE,
          new Date(when.getTime() + 5 * 60 * 1000).toISOString(),
          deal.sales_id,
        );
      }
    });
};
