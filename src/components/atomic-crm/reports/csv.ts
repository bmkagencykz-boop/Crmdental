import jsonExport from "jsonexport/dist";
import { downloadCSV } from "ra-core";
import type { ReactNode } from "react";

export type ReportColumn<Row> = {
  label: string;
  /** Shown in the table */
  render: (row: Row) => ReactNode;
  /** Written to the CSV file (defaults to the rendered text) */
  csv?: (row: Row) => string | number | null;
  numeric?: boolean;
  /** Share of the largest value, drawn as a bar behind the cell (0..1) */
  bar?: (row: Row) => number;
};

/** Rows as CSV: one column per header, `;` for spreadsheets in Russian */
export const toCsvRows = <Row>(columns: ReportColumn<Row>[], rows: Row[]) =>
  rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => {
        const value = column.csv ? column.csv(row) : column.render(row);
        return [
          column.label,
          typeof value === "number" || typeof value === "string" ? value : "",
        ];
      }),
    ),
  );

export const exportCsv = async <Row>(
  filename: string,
  columns: ReportColumn<Row>[],
  rows: Row[],
) => {
  const csv = await jsonExport(toCsvRows(columns, rows), {
    rowDelimiter: ";",
    headers: columns.map((column) => column.label),
  });
  downloadCSV(csv, filename);
};
