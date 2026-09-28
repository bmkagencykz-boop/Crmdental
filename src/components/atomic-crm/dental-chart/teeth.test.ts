import { describe, expect, it } from "vitest";

import {
  ALL_TEETH,
  areaOf,
  chartRows,
  jawOf,
  parseTeeth,
  preferredDentition,
  rootCount,
  selectionTargets,
  teethOfArea,
  toothKind,
} from "./teeth";

describe("chartRows", () => {
  it("lays out the permanent teeth in FDI order, the patient's right on the left", () => {
    const rows = chartRows("permanent");
    expect(rows.upper).toEqual([
      18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
    ]);
    expect(rows.lower).toEqual([
      48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
    ]);
  });

  it("lays out the primary teeth", () => {
    const rows = chartRows("primary");
    expect(rows.upper).toEqual([55, 54, 53, 52, 51, 61, 62, 63, 64, 65]);
    expect(rows.lower).toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75]);
    expect(ALL_TEETH).toHaveLength(52);
  });
});

describe("tooth kinds", () => {
  it("tells incisors, canines, premolars and molars apart", () => {
    expect([11, 12, 13, 14, 15, 16, 17, 18].map(toothKind)).toEqual([
      "incisor",
      "incisor",
      "canine",
      "premolar",
      "premolar",
      "molar",
      "molar",
      "molar",
    ]);
    expect([51, 52, 53, 54, 55].map(toothKind)).toEqual([
      "incisor",
      "incisor",
      "canine",
      "molar",
      "molar",
    ]);
  });

  it("knows the jaw and the roots", () => {
    expect(jawOf(26)).toBe("upper");
    expect(jawOf(36)).toBe("lower");
    expect(jawOf(65)).toBe("upper");
    expect(jawOf(75)).toBe("lower");
    expect(rootCount(16)).toBe(3);
    expect(rootCount(46)).toBe(2);
    expect(rootCount(14)).toBe(2);
    expect(rootCount(44)).toBe(1);
    expect(rootCount(11)).toBe(1);
  });
});

describe("parseTeeth", () => {
  it("reads single teeth, lists and ranges", () => {
    expect(parseTeeth("36")).toEqual([36]);
    expect(parseTeeth(" 25, 26 ")).toEqual([25, 26]);
    expect(parseTeeth("36 37")).toEqual([36, 37]);
    expect(parseTeeth("11-13")).toEqual([13, 12, 11]);
    expect(parseTeeth("13 – 23").sort()).toEqual([11, 12, 13, 21, 22, 23]);
    expect(parseTeeth("54; 65")).toEqual([54, 65]);
  });

  it("ignores what is not a tooth and the areas", () => {
    expect(parseTeeth("")).toEqual([]);
    expect(parseTeeth(null)).toEqual([]);
    expect(parseTeeth("19, 36")).toEqual([36]);
    expect(parseTeeth("Верхняя челюсть")).toEqual([]);
    expect(parseTeeth("зуб 36")).toEqual([36]);
  });
});

describe("areas", () => {
  it("reads the area texts", () => {
    expect(areaOf("Верхняя челюсть")).toBe("upper");
    expect(areaOf("нижняя челюсть")).toBe("lower");
    expect(areaOf("Ротовая полость")).toBe("mouth");
    expect(areaOf("36")).toBeNull();
    expect(teethOfArea("upper")).toContain(18);
    expect(teethOfArea("upper")).toContain(65);
    expect(teethOfArea("upper")).not.toContain(36);
    expect(teethOfArea("mouth")).toHaveLength(52);
  });
});

describe("selectionTargets", () => {
  it("gives one line per tooth in chart order, then the areas", () => {
    expect(selectionTargets([36, 11, 16, 46], ["mouth", "upper"])).toEqual([
      "16",
      "11",
      "46",
      "36",
      "Верхняя челюсть",
      "Ротовая полость",
    ]);
    expect(selectionTargets([99, 36, 36])).toEqual(["36"]);
  });

  it("opens the chart on the primary teeth when only they are named", () => {
    expect(preferredDentition([54, 65])).toBe("primary");
    expect(preferredDentition([54, 36])).toBe("permanent");
    expect(preferredDentition([])).toBe("permanent");
  });
});
