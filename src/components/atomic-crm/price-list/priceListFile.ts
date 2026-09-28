import { toCsv } from "../import/importMapping";
import type { ServiceUnit } from "../treatment/priceList";
import { sortPriceRows } from "./priceListMath";
import type { PriceListRow, ServiceCategory } from "./types";

/** The words of the units in a price list file (the import reads them back) */
export const UNIT_WORDS: Record<ServiceUnit, string> = {
  tooth: "зуб",
  jaw: "челюсть",
  visit: "посещение",
  service: "услуга",
};

const HEADER = [
  "Код",
  "Наименование",
  "Раздел / Подраздел",
  "Цена, ₸",
  "Ед. изм.",
  "Длительность, мин",
  "Направление",
  "Материалы",
];
const COST_HEADER = "Себестоимость, ₸";

const money = (value: number | null | undefined) =>
  value != null ? String(Math.round(value)) : "";

/**
 * The price list as a CSV file (Excel opens it; the import of the page and
 * of stage 29 reads it back): the active services in the order of the tree,
 * the category as «Раздел / Подраздел». The cost price only for those who
 * see it.
 */
export const priceListExportCsv = (
  rows: PriceListRow[],
  categories: ServiceCategory[],
  { withCost = false }: { withCost?: boolean } = {},
) =>
  toCsv([
    withCost ? [...HEADER, COST_HEADER] : HEADER,
    ...sortPriceRows(
      rows.filter((row) => !row.is_archived),
      categories,
      { field: "position", order: "ASC" },
    ).map((row) => {
      const line = [
        row.code ?? "",
        row.name,
        row.category ?? "",
        money(row.price),
        UNIT_WORDS[row.unit ?? "service"],
        row.duration_minutes != null ? String(row.duration_minutes) : "",
        row.specialty ?? "",
        row.materials_note ?? "",
      ];
      return withCost ? [...line, money(row.cost_price)] : line;
    }),
  ]);

/** «Шаблон»: the columns of the file with two example rows */
export const priceListTemplateCsv = () =>
  toCsv([
    [...HEADER, COST_HEADER],
    [
      "TH-04",
      "Лечение поверхностного кариеса",
      "Терапия / Лечение кариеса",
      "25000",
      "зуб",
      "45",
      "Терапевт",
      "Filtek Z550",
      "6000",
    ],
    [
      "IM-01",
      "Имплант Osstem (Корея)",
      "Имплантация / Импланты",
      "180000",
      "зуб",
      "60",
      "Имплантолог",
      "",
      "",
    ],
  ]);
