/**
 * Accents of the design (Smile Sales Agency brand): stage colors, avatars,
 * states. The brand pink and its shades, warm neutrals; colors stored with
 * the previous palettes are shown with their new accent.
 */
export const ACCENTS = [
  "#F8B4C6",
  "#F47C9C",
  "#EF3B6E",
  "#D96C8E",
  "#B23A5B",
  "#C58FA6",
  "#E8A87C",
  "#F6F4F1",
  "#9D8189",
  "#6E6468",
];

/** States of a deal on the board */
export const OVERDUE_COLOR = "#FF5C77";
export const NO_TASK_COLOR = "#E8A87C";

const LEGACY: Record<string, string> = {
  // First pastel palette (also the template of existing clinics)
  "#83A2DB": "#F8B4C6",
  "#9DB5E4": "#F47C9C",
  "#FFCE87": "#E8A87C",
  "#F7B98C": "#C58FA6",
  "#C9B3D0": "#D96C8E",
  "#A9C7E8": "#EF3B6E",
  "#8CC9A7": "#F6F4F1",
  "#FD8E8C": "#6E6468",
  "#262E3F": "#F6F4F1",
  // Bright palette of the first dark design
  "#FFE500": "#E8A87C",
  "#2F6BFF": "#F47C9C",
  "#C6F432": "#F6F4F1",
  "#FFFFFF": "#F6F4F1",
  "#FF8A3D": "#C58FA6",
  "#9B7BFF": "#D96C8E",
  "#3DD6D0": "#EF3B6E",
  "#FF5CA8": "#EF3B6E",
  "#FF453A": "#6E6468",
  "#8E8E93": "#6E6468",
};

export const accent = (color?: string | null) =>
  color ? (LEGACY[color.toUpperCase()] ?? color) : ACCENTS[7];

/** Dark text on light accents, light text on the others */
export const onAccent = (color?: string | null) => {
  const hex = accent(color).replace("#", "");
  if (hex.length !== 6) return "#1A1517";
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#1A1517" : "#FFFFFF";
};
