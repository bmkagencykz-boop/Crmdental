import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";

import { cellText, type Cell } from "./importMapping";

/** Excel saves CSV in windows-1251 in Russian locales; others use UTF-8 */
const decode = (buffer: ArrayBuffer) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1251").decode(buffer);
  }
};

export const isSupportedFile = (name: string) =>
  /\.(xlsx|csv|txt)$/i.test(name);

/**
 * The first sheet of an .xlsx file, or a .csv file (delimiter guessed), as
 * rows of cells. Empty rows before the header are dropped: rows[0] is the
 * header.
 */
export const readImportFile = async (file: File): Promise<Cell[][]> => {
  let rows: Cell[][];
  if (/\.xlsx$/i.test(file.name)) {
    rows = (await readSheet(file)) as Cell[][];
  } else {
    const text = decode(await file.arrayBuffer()).replace(/^\ufeff/, "");
    rows = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
  }
  const first = rows.findIndex((row) => row.some((cell) => cellText(cell)));
  return first < 0 ? [] : rows.slice(first);
};
