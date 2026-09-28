/**
 * The dental chart, pure layout (no React): FDI numbering of the permanent
 * and the primary teeth, the kind of every tooth (its silhouette), the jaws,
 * and the tooth text of a plan item («36», «11-13», «25, 26», «Верхняя
 * челюсть») read back into teeth. Used by DentalChart.tsx; the patient card
 * can reuse the same module.
 */

export type Dentition = "permanent" | "primary";
export type Jaw = "upper" | "lower";
export type ToothKind = "incisor" | "canine" | "premolar" | "molar";
/** A whole jaw or the mouth: an item for more than one tooth */
export type Area = "upper" | "lower" | "mouth";

/** Quadrants in the order of the chart: the patient's right is on the left */
const QUADRANTS: Record<
  Dentition,
  { upper: [number, number]; lower: [number, number] }
> = {
  permanent: { upper: [1, 2], lower: [4, 3] },
  primary: { upper: [5, 6], lower: [8, 7] },
};
const SIZE: Record<Dentition, number> = { permanent: 8, primary: 5 };

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

/**
 * The rows of the chart as they are drawn: upper 18…11 21…28, lower 48…41
 * 31…38 (primary: 55…51 61…65, 85…81 71…75).
 */
export const chartRows = (dentition: Dentition): Record<Jaw, number[]> => {
  const size = SIZE[dentition];
  const row = ([left, right]: [number, number]) => [
    ...range(size)
      .reverse()
      .map((n) => left * 10 + n),
    ...range(size).map((n) => right * 10 + n),
  ];
  return {
    upper: row(QUADRANTS[dentition].upper),
    lower: row(QUADRANTS[dentition].lower),
  };
};

export const ALL_TEETH: number[] = [
  ...Object.values(chartRows("permanent")).flat(),
  ...Object.values(chartRows("primary")).flat(),
];

/** Is this an FDI tooth number (11–48, 51–85)? */
export const isTooth = (tooth: number) => ALL_TEETH.includes(tooth);

export const quadrantOf = (tooth: number) => Math.floor(tooth / 10);
export const dentitionOf = (tooth: number): Dentition =>
  quadrantOf(tooth) >= 5 ? "primary" : "permanent";
export const jawOf = (tooth: number): Jaw =>
  [1, 2, 5, 6].includes(quadrantOf(tooth)) ? "upper" : "lower";

/**
 * The silhouette of a tooth: 1–2 incisors, 3 canine, 4–5 premolars and 6–8
 * molars; the primary 4–5 are molars.
 */
export const toothKind = (tooth: number): ToothKind => {
  const n = tooth % 10;
  if (n <= 2) return "incisor";
  if (n === 3) return "canine";
  if (dentitionOf(tooth) === "primary") return "molar";
  return n <= 5 ? "premolar" : "molar";
};

/** Roots drawn: upper molars three, lower molars two, the first upper premolar two */
export const rootCount = (tooth: number) => {
  const kind = toothKind(tooth);
  if (kind === "molar") return jawOf(tooth) === "upper" ? 3 : 2;
  if (kind === "premolar" && tooth % 10 === 4 && jawOf(tooth) === "upper")
    return 2;
  return 1;
};

/** The texts of the areas, as they are written in the «Зуб» of an item */
export const AREA_TEXT: Record<Area, string> = {
  upper: "Верхняя челюсть",
  lower: "Нижняя челюсть",
  mouth: "Ротовая полость",
};

export const areaOf = (text: string | null | undefined): Area | null => {
  const value = (text ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("верх")) return "upper";
  if (value.startsWith("ниж")) return "lower";
  if (value.startsWith("рот") || value.includes("полость")) return "mouth";
  return null;
};

/** The teeth of a jaw (both dentitions) or of the whole mouth */
export const teethOfArea = (area: Area): number[] =>
  area === "mouth" ? ALL_TEETH : ALL_TEETH.filter((t) => jawOf(t) === area);

/** Neighbours in the order of the chart row, for ranges like «13-11», «11-13» or «14-24» */
const rowRange = (from: number, to: number): number[] => {
  for (const dentition of ["permanent", "primary"] as Dentition[]) {
    for (const row of Object.values(chartRows(dentition))) {
      const a = row.indexOf(from);
      const b = row.indexOf(to);
      if (a >= 0 && b >= 0) {
        return row.slice(Math.min(a, b), Math.max(a, b) + 1);
      }
    }
  }
  return [from, to].filter(isTooth);
};

/**
 * The teeth named by the tooth text of an item: «36» → [36], «25, 26» →
 * [25, 26], «11-13» → [11, 12, 13], «13–23» → the front of the upper jaw.
 * An area («Верхняя челюсть») gives no single teeth: see areaOf().
 * Unknown numbers are ignored.
 */
export const parseTeeth = (text: string | null | undefined): number[] => {
  const value = text ?? "";
  if (areaOf(value)) return [];
  const teeth = new Set<number>();
  const parts = value.replace(/\s*[-–—]\s*/g, "-").split(/[,;\s]+/);
  for (const part of parts) {
    const match = part.match(/^(\d{2})(?:-(\d{2}))?$/);
    if (!match) {
      // Text around the numbers: every number alone
      for (const n of part.match(/\d{2}/g) ?? []) {
        if (isTooth(Number(n))) teeth.add(Number(n));
      }
      continue;
    }
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    for (const tooth of rowRange(from, to)) teeth.add(tooth);
  }
  return [...teeth];
};

/**
 * The tooth texts of the items added for a selection: one per tooth in the
 * order of the chart, or one area text.
 */
export const selectionTargets = (
  teeth: number[],
  areas: Area[] = [],
): string[] => {
  const order = (tooth: number) => {
    const index = ALL_TEETH.indexOf(tooth);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [
    ...[...new Set(teeth)]
      .filter(isTooth)
      .sort((a, b) => order(a) - order(b))
      .map(String),
    ...(["upper", "lower", "mouth"] as Area[])
      .filter((area) => areas.includes(area))
      .map((area) => AREA_TEXT[area]),
  ];
};

/** The dentition to open the chart on: the primary one when only primary teeth are named */
export const preferredDentition = (teeth: number[]): Dentition =>
  teeth.length > 0 && teeth.every((t) => dentitionOf(t) === "primary")
    ? "primary"
    : "permanent";
