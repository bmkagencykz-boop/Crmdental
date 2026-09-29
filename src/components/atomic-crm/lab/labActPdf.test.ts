import { beforeAll, describe, expect, it } from "vitest";

import { russianCrmMessages } from "../providers/commons/russianCrmMessages";
import { loadEstimateFonts } from "../treatment/estimateFonts";
import type { EstimateFonts } from "../treatment/estimatePdf";
import { actBasis, actDocument, buildLabActPdf } from "./labActPdf";
import type { LabReconciliation } from "./types";

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

const act: LabReconciliation = {
  lab_id: 1,
  lab_name: "Дентал-Арт",
  period_from: "2026-09-01",
  period_to: "2026-09-29",
  opening: 4000,
  charged: 10000,
  paid: 12000,
  closing: 2000,
  lines: [
    {
      day: "2026-09-19",
      kind: "work",
      number: 12,
      patient_name: "Нурланова Асель",
      works: "Временная коронка × 2",
      debit: 10000,
      credit: 0,
    },
    {
      day: "2026-09-24",
      kind: "payment",
      method: "kaspi_transfer",
      orders: "№11, №12",
      comment: "Счёт 214",
      debit: 0,
      credit: 12000,
    },
  ],
};

const clinic = { name: "Жемчуг Дентал", city: "Алматы", phone: "+77272000000" };
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("reconciliation act PDF (stage 43)", () => {
  it("builds the act with the Cyrillic font", () => {
    const pdf = text(
      buildLabActPdf(act, clinic, fonts, translate, { compress: false }),
    );
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("DejaVuSans");
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  it("names the documents and their details", () => {
    expect(actDocument(act.lines[0], translate)).toBe("Наряд № 12");
    expect(actDocument(act.lines[1], translate)).toBe("Оплата, Kaspi перевод");
    expect(actBasis(act.lines[0], translate)).toBe(
      "Нурланова Асель · Временная коронка × 2",
    );
    expect(actBasis(act.lines[1], translate)).toBe(
      "за наряды №11, №12 · Счёт 214",
    );
  });

  it("goes over pages with many lines", () => {
    const pdf = text(
      buildLabActPdf(
        {
          ...act,
          lines: Array.from({ length: 80 }, (_, i) => ({
            ...act.lines[0],
            number: i + 1,
          })),
        },
        clinic,
        fonts,
        translate,
        { compress: false },
      ),
    );
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
