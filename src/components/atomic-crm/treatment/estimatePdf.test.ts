import { beforeAll, describe, expect, it } from "vitest";

import { russianCrmMessages } from "../providers/commons/russianCrmMessages";
import { loadEstimateFonts } from "./estimateFonts";
import {
  buildEstimatePdf,
  FONT_NAME,
  type EstimateData,
  type EstimateFonts,
} from "./estimatePdf";
import { estimateFileName, formatDate } from "./format";
import type { TreatmentPlanItem } from "./types";

// The same fonts as the app, fetched by the browser the tests run in
let fonts: EstimateFonts;
beforeAll(async () => {
  fonts = await loadEstimateFonts();
});

/** The Russian catalog with %{name} interpolation, like the app */
const translate = (key: string, options: Record<string, unknown> = {}) => {
  const value = key
    .split(".")
    .reduce<any>((node, part) => node?.[part], russianCrmMessages);
  if (typeof value !== "string") throw new Error(`Missing message ${key}`);
  return value.replace(/%\{(\w+)\}/g, (_, name) => String(options[name] ?? ""));
};

const item = (
  id: number,
  patch: Partial<TreatmentPlanItem>,
): TreatmentPlanItem => ({
  id,
  plan_id: 7,
  stage_no: 1,
  name: "",
  quantity: 1,
  unit_price: 0,
  discount_percent: 0,
  done: false,
  position: id,
  ...patch,
});

const data: EstimateData = {
  clinic: {
    name: "Жемчуг Дентал",
    city: "Алматы",
    address: "пр. Абая, 10",
    phone: "+77272000000",
  },
  patient: { name: "Нурланова Асель", phone: "+77011234567" },
  plan: {
    id: 7,
    name: "Вариант премиум",
    discount_percent: 5,
    discount_amount: 10000,
    note: "Сначала лечение, затем имплантация.",
  },
  doctor: "Ахметова Айгуль",
  date: new Date(2026, 9, 1),
  items: [
    item(1, { name: "Имплант Osstem", tooth: "36", unit_price: 180000 }),
    item(2, {
      stage_no: 2,
      name: "Коронка циркониевая на имплант",
      tooth: "36",
      unit_price: 120000,
      discount_percent: 10,
    }),
  ],
};

/** Every hex glyph → unicode pair of the ToUnicode maps of the file */
const unicodeMap = (pdf: string) =>
  new Set(
    [...pdf.matchAll(/<([0-9a-f]{4})><([0-9a-f]{4})>/gi)].map((match) =>
      String.fromCharCode(parseInt(match[2], 16)),
    ),
  );

describe("buildEstimatePdf", () => {
  it("produces an A4 PDF with the Cyrillic font embedded", () => {
    const bytes = buildEstimatePdf(data, fonts, translate, { compress: false });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(5000);
    const pdf = new TextDecoder("latin1").decode(bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain(`/BaseFont /${FONT_NAME}`);
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    // The texts are drawn with the embedded font: its glyphs map back to
    // the Cyrillic letters of the patient, the services and the totals
    const glyphs = unicodeMap(pdf);
    for (const text of [
      "Нурланова Асель",
      "Коронка циркониевая",
      "Смета действительна",
      "₸",
    ]) {
      for (const char of text.replace(/\s/g, "")) {
        expect(glyphs.has(char), `glyph for «${char}» of «${text}»`).toBe(true);
      }
    }
  });

  it("stays small: only the used glyphs are embedded", () => {
    const bytes = buildEstimatePdf(data, fonts, translate);
    expect(bytes.length).toBeLessThan(200_000);
  });

  it("breaks long plans into pages", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      item(index + 1, {
        stage_no: 1 + Math.floor(index / 20),
        name: `Лечение кариеса, поверхность ${index + 1}`,
        unit_price: 25000,
      }),
    );
    const pdf = new TextDecoder("latin1").decode(
      buildEstimatePdf({ ...data, items: many }, fonts, translate, {
        compress: false,
      }),
    );
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  });

  it("prints the stages with their names, doctors and deadlines (stage 34)", () => {
    const keys: string[] = [];
    const spy = (key: string, options: Record<string, unknown> = {}) => {
      keys.push(key);
      return translate(key, options);
    };
    const bytes = buildEstimatePdf(
      {
        ...data,
        plan: { ...data.plan, discount_percent: 10, discount_amount: 0 },
        items: data.items.map((i) => ({ ...i, stage_id: i.stage_no })),
        stages: [
          {
            id: 1,
            position: 1,
            status: "new",
            discount_percent: 5,
            name: "Хирургия",
            doctor: "Ахметова Айгуль",
            deadline: "2026-10-15",
          },
          {
            id: 2,
            position: 2,
            status: "cancelled",
            discount_percent: 0,
            name: "Отменённый",
          },
        ],
      },
      fonts,
      spy,
    );
    expect(bytes.length).toBeGreaterThan(5000);
    expect(keys).toContain("plan_editor.pdf.deadline");
    expect(keys).toContain("plan_editor.pdf.stage_discount");
    expect(keys).toContain("plan_editor.totals.extra_discount");
    expect(keys).toContain("plan_editor.totals.total_with_discount");
  });
});

describe("estimate helpers", () => {
  it("names the file after the plan and the patient", () => {
    expect(estimateFileName("План: эконом/1", "Нурланова Асель")).toBe(
      "Смета — План эконом 1 — Нурланова Асель.pdf",
    );
  });

  it("prints dates as dd.mm.yyyy", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("05.01.2026");
  });
});
