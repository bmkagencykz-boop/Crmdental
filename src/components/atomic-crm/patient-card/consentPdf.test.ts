import { beforeAll, describe, expect, it } from "vitest";

import { russianCrmMessages } from "../providers/commons/russianCrmMessages";
import { loadEstimateFonts } from "../treatment/estimateFonts";
import type { EstimateFonts } from "../treatment/estimatePdf";
import { buildConsentPdf } from "./consentPdf";
import { consentValues, renderConsent } from "./consents";

// The same fonts as the app, fetched by the browser the tests run in
let fonts: EstimateFonts;
beforeAll(async () => {
  fonts = await loadEstimateFonts();
});

const translate = (key: string, options: Record<string, unknown> = {}) => {
  const value = key
    .split(".")
    .reduce<any>((node, part) => node?.[part], russianCrmMessages);
  if (typeof value !== "string") throw new Error(`Missing message ${key}`);
  return value.replace(/%\{(\w+)\}/g, (_, name) => String(options[name] ?? ""));
};

const clinic = {
  name: "Жемчуг Дентал",
  city: "Алматы",
  address: "пр. Абая, 10",
  phone: "+77272000000",
};
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("consent PDF", () => {
  it("builds a signed consent with the Cyrillic font", () => {
    const body = renderConsent(
      "Я, {пациент}, ИИН {иин}, даю согласие на лечение.\n\nДата: {дата}",
      consentValues({ patientName: "Нурланова Асель", iin: "900515400123" }),
    );
    const bytes = buildConsentPdf(
      {
        clinic,
        title: "Информированное согласие",
        body,
        patientName: "Нурланова Асель",
        signedAt: "2026-09-20",
      },
      fonts,
      translate,
      { compress: false },
    );
    const pdf = text(bytes);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("DejaVuSans");
    expect(pdf).toContain("/Title (");
  });

  it("splits a long consent into pages", () => {
    const body = Array.from(
      { length: 120 },
      (_, i) => `Пункт ${i + 1}. Мне разъяснены возможные осложнения лечения.`,
    ).join("\n");
    const pdf = text(
      buildConsentPdf(
        { clinic, title: "Согласие", body, patientName: "Омаров Ерлан" },
        fonts,
        translate,
        { compress: false },
      ),
    );
    expect(pdf.match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
