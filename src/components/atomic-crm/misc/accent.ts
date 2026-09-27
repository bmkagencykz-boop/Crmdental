/**
 * Accents of the Katana-like design: stage colors, avatars, states. Colors
 * stored with the previous pastel palette are shown with their new accent.
 */
export const ACCENTS = [
  "#FFE500",
  "#2F6BFF",
  "#C6F432",
  "#FFFFFF",
  "#FF8A3D",
  "#9B7BFF",
  "#3DD6D0",
  "#FF5CA8",
  "#FF453A",
  "#8E8E93",
];

const LEGACY: Record<string, string> = {
  "#83A2DB": "#2F6BFF",
  "#9DB5E4": "#2F6BFF",
  "#A9C7E8": "#3DD6D0",
  "#C9B3D0": "#9B7BFF",
  "#FFCE87": "#FFE500",
  "#F7B98C": "#FF8A3D",
  "#FD8E8C": "#FF453A",
  "#8CC9A7": "#C6F432",
  "#262E3F": "#FFFFFF",
};

export const accent = (color?: string | null) =>
  color ? (LEGACY[color.toUpperCase()] ?? color) : ACCENTS[3];

/** Black text on light accents (yellow, lime, white), white on the others */
export const onAccent = (color?: string | null) => {
  const hex = accent(color).replace("#", "");
  if (hex.length !== 6) return "#000000";
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
};
