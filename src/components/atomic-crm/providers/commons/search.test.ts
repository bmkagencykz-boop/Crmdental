import { describe, expect, it } from "vitest";
import { applySearch, phoneQueryDigits } from "./search";

describe("phoneQueryDigits", () => {
  it("keeps the digits of a Kazakh number without the trunk prefix", () => {
    expect(phoneQueryDigits("8 701 123 45 67")).toBe("7011234567");
    expect(phoneQueryDigits("+7 (701) 123-45-67")).toBe("7011234567");
    expect(phoneQueryDigits("701 12")).toBe("70112");
  });

  it("ignores names and too short queries", () => {
    expect(phoneQueryDigits("Асель")).toBeNull();
    expect(phoneQueryDigits("12")).toBeNull();
  });
});

describe("applySearch", () => {
  const search = applySearch(["first_name", "last_name"], "phone_fts");
  const params = (q?: string) => ({
    filter: { q, sales_id: 1 },
    pagination: { page: 1, perPage: 10 },
    sort: { field: "id", order: "ASC" as const },
  });

  it("searches names", () => {
    expect(search(params("асель")).filter).toEqual({
      sales_id: 1,
      "@or": { "first_name@ilike": "асель", "last_name@ilike": "асель" },
    });
  });

  it("searches phones by digits", () => {
    expect(search(params("8 701 123")).filter).toEqual({
      sales_id: 1,
      "@or": { "phone_fts@ilike": "701123" },
    });
  });

  it("leaves lists without a query untouched", () => {
    expect(search(params()).filter).toEqual({ q: undefined, sales_id: 1 });
  });
});
