/** Formats of the treatment plans shared by the screens and the estimate */

const pad = (n: number) => String(n).padStart(2, "0");
export const formatDate = (date: Date) =>
  `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;

/** «Смета — План лечения — Нурланова Асель.pdf», safe for a file system */
export const estimateFileName = (
  planName: string,
  patientName: string,
  prefix = "Смета",
) =>
  `${[prefix, planName, patientName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" — ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120)}.pdf`;
