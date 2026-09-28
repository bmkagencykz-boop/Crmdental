import { describe, expect, it } from "vitest";

import { DENTAL_ICD10, icdLabel, normalizeIcdCode, searchIcd } from "./icd10";

describe("ICD-10 of dentistry", () => {
  it("covers K00–K14 with unique, valid codes", () => {
    const codes = DENTAL_ICD10.map((entry) => entry.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(normalizeIcdCode(code)).toBe(code);
    expect(codes).toContain("K02.1");
    expect(codes).toContain("K04.5");
    expect(codes.filter((code) => code.startsWith("K")).length).toBeGreaterThan(
      50,
    );
  });

  it("finds codes by code and by words of the name", () => {
    expect(searchIcd("k04.5")[0].code).toBe("K04.5");
    expect(searchIcd("K02").map((e) => e.code)).toEqual([
      "K02.0",
      "K02.1",
      "K02.2",
      "K02.3",
      "K02.8",
      "K02.9",
    ]);
    expect(searchIcd("кариес дент")[0].code).toBe("K02.1");
    expect(searchIcd("корневая киста").map((e) => e.code)).toEqual(["K04.8"]);
    expect(searchIcd("", 3)).toHaveLength(3);
  });

  it("normalizes a typed code", () => {
    expect(normalizeIcdCode(" k02,1 ")).toBe("K02.1");
    expect(normalizeIcdCode("кариес")).toBeNull();
    expect(icdLabel("K02.1")).toBe("K02.1 Кариес дентина");
    expect(icdLabel("S02.5")).toBe("S02.5");
  });
});
