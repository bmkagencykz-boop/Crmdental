import { describe, expect, it } from "vitest";

import type { Service } from "../types";
import {
  ADDRESS_PLACEHOLDER,
  buildServiceRows,
  fillPlaceholder,
  formatTenge,
  isConsultation,
  parsePrice,
  PRICE_PLACEHOLDER,
  SERVICE_PRESETS,
  serviceToggle,
} from "./servicePresets";

const service = (
  id: number,
  name: string,
  extra: Partial<Service> = {},
): Service => ({ id, name, position: id, is_archived: false, ...extra });

// The default services of a new clinic (private.seed_organization)
const DEFAULTS = [
  "Имплантация",
  "Ортодонтия",
  "Терапия",
  "Гигиена",
  "Протезирование",
  "Хирургия",
  "Детская стоматология",
  "Другое",
].map((name, index) => service(index + 1, name));

describe("SERVICE_PRESETS", () => {
  it("lists the common dental services once each", () => {
    const names = SERVICE_PRESETS.map((preset) => preset.name);
    expect(names).toEqual([
      "Консультация",
      "Профгигиена",
      "Лечение кариеса",
      "Лечение каналов",
      "Удаление",
      "Имплантация",
      "All-on-4",
      "Коронка",
      "Виниры",
      "Брекеты / элайнеры",
      "Отбеливание",
      "Детский приём",
    ]);
    expect(new Set(SERVICE_PRESETS.map((p) => p.key)).size).toBe(names.length);
  });
});

describe("buildServiceRows", () => {
  it("ticks the presets a new clinic already has, by name or alias", () => {
    const rows = buildServiceRows(DEFAULTS);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(byKey.implants).toMatchObject({ checked: true, serviceId: 1 });
    expect(byKey.hygiene).toMatchObject({
      checked: true,
      serviceId: 4,
      name: "Гигиена",
    });
    expect(byKey.braces).toMatchObject({ checked: true, serviceId: 2 });
    expect(byKey.children).toMatchObject({ checked: true, serviceId: 7 });
    expect(byKey.consultation).toMatchObject({
      checked: false,
      serviceId: null,
      name: "Консультация",
    });
    expect(byKey.veneers.checked).toBe(false);
    // What no preset matches stays as the clinic's own service
    const own = rows.filter((row) => !row.preset);
    expect(own.map((row) => row.name)).toEqual(["Другое"]);
    expect(own[0]).toMatchObject({ checked: true, key: "service-8" });
  });

  it("prefers an exact name to an alias and matches a service once", () => {
    const rows = buildServiceRows([
      service(1, "Хирургия"),
      service(2, "удаление"),
    ]);
    const extraction = rows.find((row) => row.key === "extraction")!;
    expect(extraction.serviceId).toBe(2);
    // «Хирургия» is then free: it stays the clinic's own service
    expect(rows.filter((row) => !row.preset).map((row) => row.name)).toEqual([
      "Хирургия",
    ]);
  });

  it("keeps archived services unticked, with their price", () => {
    const rows = buildServiceRows([
      service(1, "Консультация", { is_archived: true, price: 5000 }),
      service(2, "Старая услуга", { is_archived: true }),
    ]);
    expect(rows.find((row) => row.key === "consultation")).toMatchObject({
      checked: false,
      serviceId: 1,
      price: 5000,
    });
    expect(rows.some((row) => row.name === "Старая услуга")).toBe(false);
  });

  it("matches names regardless of case, ё and spaces", () => {
    const rows = buildServiceRows([service(1, "  детский   ПРИЕМ ")]);
    expect(rows.find((row) => row.key === "children")?.serviceId).toBe(1);
  });
});

describe("serviceToggle", () => {
  const rows = buildServiceRows(DEFAULTS);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it("creates a missing service when ticked", () => {
    expect(
      serviceToggle({ ...row("veneers"), price: 90000 }, true, 12),
    ).toEqual({
      type: "create",
      data: { name: "Виниры", position: 12, price: 90000 },
    });
    expect(serviceToggle(row("veneers"), false, 12)).toEqual({ type: "none" });
  });

  it("archives and restores an existing service", () => {
    expect(serviceToggle(row("implants"), false, 0)).toEqual({
      type: "update",
      id: 1,
      data: { is_archived: true },
    });
    expect(
      serviceToggle({ ...row("implants"), checked: false }, true, 0),
    ).toEqual({ type: "update", id: 1, data: { is_archived: false } });
    expect(serviceToggle(row("implants"), true, 0)).toEqual({ type: "none" });
  });
});

describe("prices", () => {
  it("parses what the owner types", () => {
    expect(parsePrice("5 000")).toBe(5000);
    expect(parsePrice("5000 ₸")).toBe(5000);
    expect(parsePrice("12500,50")).toBe(12501);
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("бесплатно")).toBeNull();
    expect(parsePrice("-5")).toBeNull();
  });

  it("formats tenge like the database", () => {
    expect(formatTenge(5000)).toBe("5 000");
    expect(formatTenge(1250000.4)).toBe("1 250 000");
    expect(formatTenge(900)).toBe("900");
  });
});

describe("quick reply placeholders", () => {
  it("fills the address and the price", () => {
    expect(
      fillPlaceholder(
        `Наш адрес: ${ADDRESS_PLACEHOLDER}.`,
        ADDRESS_PLACEHOLDER,
        " Абая, 10 ",
      ),
    ).toBe("Наш адрес: Абая, 10.");
    expect(
      fillPlaceholder(
        `стоит ${PRICE_PLACEHOLDER} ₸`,
        PRICE_PLACEHOLDER,
        "5 000",
      ),
    ).toBe("стоит 5 000 ₸");
  });

  it("leaves the text alone for a blank value", () => {
    const text = `Наш адрес: ${ADDRESS_PLACEHOLDER}.`;
    expect(fillPlaceholder(text, ADDRESS_PLACEHOLDER, "  ")).toBe(text);
    expect(fillPlaceholder(text, ADDRESS_PLACEHOLDER, null)).toBe(text);
  });

  it("recognizes the consultation service", () => {
    expect(isConsultation("Консультация")).toBe(true);
    expect(isConsultation("консультация ортодонта")).toBe(true);
    expect(isConsultation("Лечение кариеса")).toBe(false);
  });
});
