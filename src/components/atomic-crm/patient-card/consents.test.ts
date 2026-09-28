import { describe, expect, it } from "vitest";

import {
  BLANK,
  consentFileName,
  consentValues,
  missingValues,
  renderConsent,
  ruDate,
} from "./consents";

const values = consentValues({
  patientName: "Нурланова Асель",
  birthDate: "1990-05-15",
  iin: "900515400123",
  phone: "+77015551234",
  clinic: "Жемчуг Дентал",
  doctor: "Ахметова Айгуль",
  date: new Date(2026, 8, 28),
});

describe("consent rendering", () => {
  it("fills the Russian and the English variables", () => {
    expect(
      renderConsent(
        "Я, {пациент}, {дата_рождения} г. р., ИИН {иин}, тел. {телефон} — «{клиника}», врач {врач}, {дата}. {Patient}",
        values,
      ),
    ).toBe(
      "Я, Нурланова Асель, 15.05.1990 г. р., ИИН 900515 400123, тел. +7 701 555 12 34 — «Жемчуг Дентал», врач Ахметова Айгуль, 28.09.2026. Нурланова Асель",
    );
  });

  it("leaves a blank for a value to write by hand, and unknown braces as they are", () => {
    const partial = consentValues({ patientName: "Омаров Ерлан" });
    expect(renderConsent("ИИН {иин}, {неизвестно}", partial)).toBe(
      `ИИН ${BLANK}, {неизвестно}`,
    );
    expect(missingValues("{пациент} {иин} {врач} {iin}", partial)).toEqual([
      "iin",
      "doctor",
    ]);
  });

  it("formats dates and file names", () => {
    expect(ruDate("2026-09-20")).toBe("20.09.2026");
    expect(ruDate(null)).toBeNull();
    expect(consentFileName("Согласие: анестезия", "Нурланова Асель")).toBe(
      "Согласие анестезия — Нурланова Асель.pdf",
    );
  });
});
