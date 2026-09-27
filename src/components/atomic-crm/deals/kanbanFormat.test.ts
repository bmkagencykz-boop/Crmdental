import { describe, expect, it } from "vitest";
import { formatCardDate, formatMoney } from "./kanbanFormat";

const labels = { today: "Сегодня", yesterday: "Вчера" };
const now = new Date(2026, 8, 27, 15, 0);

describe("formatCardDate", () => {
  it("shows the time for today and yesterday", () => {
    expect(
      formatCardDate(new Date(2026, 8, 27, 9, 5).toISOString(), labels, now),
    ).toBe("Сегодня 09:05");
    expect(
      formatCardDate(new Date(2026, 8, 26, 23, 59).toISOString(), labels, now),
    ).toBe("Вчера 23:59");
  });

  it("shows the date for older deals", () => {
    expect(
      formatCardDate(new Date(2026, 8, 19, 12, 0).toISOString(), labels, now),
    ).toBe("19.09.2026");
  });

  it("returns nothing for missing dates", () => {
    expect(formatCardDate(undefined, labels, now)).toBe("");
  });
});

describe("formatMoney", () => {
  it("formats tenge without decimals", () => {
    expect(formatMoney(900000, "KZT").replace(/\s/g, " ")).toBe("900 000 ₸");
  });
});
