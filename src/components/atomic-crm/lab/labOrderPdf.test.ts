import { beforeAll, describe, expect, it } from "vitest";

import { russianCrmMessages } from "../providers/commons/russianCrmMessages";
import { loadEstimateFonts } from "../treatment/estimateFonts";
import type { EstimateFonts } from "../treatment/estimatePdf";
import { buildLabOrderPdf, type LabOrderPdfData } from "./labOrderPdf";

// The fonts of the app: fetched by the browser the tests run in, or read
// from node_modules when the tests run in Node
let fonts: EstimateFonts;
beforeAll(async () => {
  if (typeof document === "undefined") {
    const fsModule = "node:fs";
    const { readFileSync } = await import(/* @vite-ignore */ fsModule);
    const read = (file: string) =>
      readFileSync(`node_modules/dejavu-fonts-ttf/ttf/${file}`).toString(
        "base64",
      );
    fonts = {
      regular: read("DejaVuSans.ttf"),
      bold: read("DejaVuSans-Bold.ttf"),
    };
  } else {
    fonts = await loadEstimateFonts();
  }
});

const translate = (key: string, options: Record<string, unknown> = {}) => {
  const value = key
    .split(".")
    .reduce<any>((node, part) => node?.[part], russianCrmMessages);
  if (typeof value !== "string") throw new Error(`Missing message ${key}`);
  return value.replace(/%\{(\w+)\}/g, (_, name) => String(options[name] ?? ""));
};

const data: LabOrderPdfData = {
  clinic: {
    name: "Жемчуг Дентал",
    city: "Алматы",
    address: "пр. Абая, 10",
    phone: "+77272000000",
  },
  number: 27,
  createdAt: "2026-09-20",
  patientName: "Нурланова Асель",
  patientPhone: "+77011234567",
  doctorName: "Сериков Бахыт",
  labName: "Дентал-Арт",
  technicianName: "Серик Абенов",
  shade: "A2",
  material: "Диоксид циркония",
  teeth: [36, 37],
  sentAt: "2026-09-21",
  fitting1At: "2026-09-25",
  dueAt: "2026-10-02",
  comment: "Контакт с 35 плотный",
  lines: [
    { name: "Коронка из диоксида циркония", qty: 2, price: 35000 },
    { name: "Временная коронка", qty: 2, price: 5000 },
  ],
  withPrices: true,
};

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("lab work order PDF", () => {
  it("builds the order with the Cyrillic font and the prices", () => {
    const pdf = text(
      buildLabOrderPdf(data, fonts, translate, { compress: false }),
    );
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("DejaVuSans");
    expect(pdf).toContain("/Title (");
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("builds a long order without prices over pages", () => {
    const pdf = text(
      buildLabOrderPdf(
        {
          ...data,
          withPrices: false,
          lines: Array.from({ length: 60 }, (_, i) => ({
            name: `Коронка металлокерамическая ${i + 1}`,
            qty: 1,
            price: null,
          })),
        },
        fonts,
        translate,
        { compress: false },
      ),
    );
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
