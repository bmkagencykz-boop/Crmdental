import { describe, expect, it } from "vitest";

import { toCsvRows, type ReportColumn } from "./csv";

describe("toCsvRows", () => {
  it("writes one column per header, raw values where given", () => {
    type Row = { name: string | null; paid: number };
    const columns: ReportColumn<Row>[] = [
      { label: "Услуга", render: (row) => row.name ?? "Без услуги" },
      {
        label: "Оплачено",
        render: (row) => `${row.paid} ₸`,
        csv: (row) => row.paid,
      },
    ];
    expect(
      toCsvRows(columns, [
        { name: "Имплантация", paid: 100000 },
        { name: null, paid: 0 },
      ]),
    ).toEqual([
      { Услуга: "Имплантация", Оплачено: 100000 },
      { Услуга: "Без услуги", Оплачено: 0 },
    ]);
  });
});
