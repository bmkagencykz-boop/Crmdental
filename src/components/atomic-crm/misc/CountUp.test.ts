import { describe, expect, it } from "vitest";

import { formatLike, parseNumber } from "./CountUp";

describe("CountUp numbers", () => {
  it("keeps the unit, the decimal comma and the grouping of the text", () => {
    const parsed = parseNumber("29,48 млн ₸")!;
    expect(parsed.value).toBe(29.48);
    expect(formatLike(parsed, 12.3)).toBe("12,30 млн ₸");
    const money = parseNumber("1 250 000 ₸")!;
    expect(money.value).toBe(1250000);
    expect(formatLike(money, 1234.4)).toBe("1 234 ₸");
    const nbsp = parseNumber("40\u00a0000 ₸")!;
    expect(formatLike(nbsp, 12000)).toBe("12\u00a0000 ₸");
  });

  it("reads signs, percents and plain counts", () => {
    expect(parseNumber("-8 000 ₸")!.value).toBe(-8000);
    expect(formatLike(parseNumber("86%")!, 43.2)).toBe("43%");
    expect(formatLike(parseNumber("7")!, 3.6)).toBe("4");
    expect(parseNumber("—")).toBeNull();
  });
});
