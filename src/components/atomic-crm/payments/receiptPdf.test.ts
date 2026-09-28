import { beforeAll, describe, expect, it } from "vitest";

import { russianCrmMessages } from "../providers/commons/russianCrmMessages";
import { loadEstimateFonts } from "../treatment/estimateFonts";
import type { EstimateFonts } from "../treatment/estimatePdf";
import { buildActPdf, buildReceiptPdf } from "./receiptPdf";

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

const clinic = {
  name: "Жемчуг Дентал",
  city: "Алматы",
  address: "пр. Абая, 10",
  phone: "+77272000000",
};
const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("receipt and act PDF", () => {
  it("builds a receipt of a mixed payment with change", () => {
    const bytes = buildReceiptPdf(
      {
        clinic,
        operation: {
          id: 125,
          patient_id: 7,
          kind: "payment",
          account: "services",
          amount: 70000,
          method: "mixed",
          parts: [
            { method: "card", amount: 40000 },
            { method: "cash", amount: 30000 },
          ],
          cash_received: 50000,
          occurred_at: "2026-09-28T10:15:00Z",
          patient_name: "Нурланова Асель",
          cashier_name: "Айгерим Садыкова",
          deal_name: "Имплантация",
        },
        account: { deposit: 20000, debt: 15000 },
      },
      fonts,
      translate,
      { compress: false },
    );
    expect(text(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
  });

  it("builds an act with a plan discount line", () => {
    const bytes = buildActPdf(
      {
        clinic,
        patient: { id: 7, name: "Нурланова Асель", phone: "+77011234567" },
        lines: [
          { name: "Имплант Osstem", tooth: "36", quantity: 1, amount: 180000 },
          { name: "План", quantity: 1, amount: -9000, discount: true },
        ],
        paid: 100000,
        date: new Date("2026-09-28T10:00:00Z"),
      },
      fonts,
      translate,
      { compress: false },
    );
    expect(text(bytes.slice(0, 5))).toBe("%PDF-");
  });
});
