import type { Identifier } from "ra-core";

/**
 * Colors of the schedule columns: saturated and far apart, so that every
 * doctor is told at a glance (like the paper book of a clinic, one color
 * per doctor). A doctor without a color takes one by position.
 */
export const DOCTOR_COLORS = [
  "#4E9F6E",
  "#2F55D4",
  "#E0245E",
  "#8BC34A",
  "#3A3A40",
  "#F2B705",
  "#1FA3A3",
  "#7B4FD6",
  "#E07A2E",
  "#C2185B",
];

/** Color used for visits without a doctor / chair, and for chairs */
export const NEUTRAL_COLOR = "#8A8F98";

const isHex = (value?: string | null): value is string =>
  !!value && /^#[0-9a-f]{6}$/i.test(value);

/** Color of a doctor: its own, else by its place in the list */
export const doctorColor = (
  doctor: { id: Identifier; color?: string | null } | undefined,
  ordered: { id: Identifier }[],
) => {
  if (!doctor) return NEUTRAL_COLOR;
  if (isHex(doctor.color)) return doctor.color;
  const index = ordered.findIndex(
    (item) => String(item.id) === String(doctor.id),
  );
  return DOCTOR_COLORS[(index < 0 ? 0 : index) % DOCTOR_COLORS.length];
};

/** Dark text on light colors (lime, amber), white on the others */
export const textOn = (color: string) => {
  if (!isHex(color)) return "#FFFFFF";
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(color.slice(i, i + 2), 16) / 255,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#1A1517" : "#FFFFFF";
};
