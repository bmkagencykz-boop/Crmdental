import { describe, expect, it } from "vitest";

import {
  buildBatchRows,
  errorRowsCsv,
  guessField,
  guessMapping,
  guessMode,
  initialResolutions,
  isAmoCrmExport,
  parseAmount,
  parseDateCell,
  parsePhones,
  parseRows,
  rowErrors,
  sampleCsv,
  splitFullName,
  unresolvedValues,
  effectiveMapping,
  type ImportDictionaries,
} from "./importMapping";
import type { CustomField } from "../types";

const dictionaries: ImportDictionaries = {
  pipelines: [
    { id: 1, name: "Основная", is_default: true },
    { id: 2, name: "Ортодонтия" },
  ],
  stages: [
    { id: 10, pipeline_id: 1, name: "Новый лид", kind: "open", position: 0 },
    { id: 11, pipeline_id: 1, name: "Записан", kind: "open", position: 1 },
    {
      id: 12,
      pipeline_id: 1,
      name: "Лечение завершено",
      kind: "won",
      position: 2,
    },
    { id: 13, pipeline_id: 1, name: "Отказ", kind: "lost", position: 3 },
    { id: 20, pipeline_id: 2, name: "Новый лид", kind: "open", position: 0 },
    { id: 21, pipeline_id: 2, name: "Успешно", kind: "won", position: 1 },
    { id: 22, pipeline_id: 2, name: "Отказ", kind: "lost", position: 2 },
  ],
  sources: [
    { id: 1, name: "Instagram" },
    { id: 2, name: "Сайт" },
  ],
  services: [
    { id: 1, name: "Имплантация" },
    { id: 2, name: "Ортодонтия" },
  ],
  lostReasons: [{ id: 1, name: "Дорого" }],
  sales: [
    {
      id: 7,
      first_name: "Айгерим",
      last_name: "Сапарова",
      email: "aigerim@clinic.kz",
    },
  ],
  tags: [],
};

describe("guessField", () => {
  it.each([
    ["ФИО", "full_name"],
    ["Имя", "first_name"],
    ["Фамилия", "last_name"],
    ["Отчество", "middle_name"],
    ["Телефон", "phone"],
    ["Моб. телефон", "phone"],
    ["E-mail", "email"],
    ["Дата рождения", "birth_date"],
    ["Источник", "source"],
    ["Услуга", "service"],
    ["Этап/Статус", "stage"],
    ["Статус", "stage"],
    ["Ответственный", "responsible"],
    ["Бюджет", "plan_amount"],
    ["Сумма", "plan_amount"],
    ["Оплачено", "paid_amount"],
    ["Теги", "tags"],
    ["Комментарий", "comment"],
    ["Дата создания", "created_at"],
    ["Full name", "full_name"],
    ["Phone", "phone"],
    ["Created at", "created_at"],
    ["Responsible", "responsible"],
    ["Paid", "paid_amount"],
    ["ID", "external_id"],
  ])("%s → %s", (header, field) => {
    expect(guessField(header)).toBe(field);
  });

  it("leaves unknown columns out", () => {
    expect(guessField("Любимый цвет")).toBeNull();
    expect(guessField("  ")).toBeNull();
  });
});

const amoHeaders = [
  "ID",
  "Название сделки",
  "Бюджет",
  "Ответственный",
  "Этап сделки",
  "Воронка",
  "Полное имя контакта",
  "Рабочий телефон (контакт)",
  "Мобильный телефон (контакт)",
  "Должность (контакт)",
  "Теги сделки",
  "Дата создания",
];

describe("guessMapping", () => {
  it("maps the columns of a clinic's own file", () => {
    const { mapping, system } = guessMapping([
      "ФИО",
      "Телефон",
      "Второй телефон",
      "Услуга",
      "Этап",
      "Бюджет",
      "Что-то ещё",
    ]);
    expect(system).toBe("excel");
    expect(mapping).toEqual([
      "full_name",
      "phone",
      "phone",
      "service",
      "stage",
      "plan_amount",
      null,
    ]);
    expect(guessMode(mapping)).toBe("deals");
  });

  it("does not map two columns to a single field", () => {
    const { mapping } = guessMapping(["Имя", "Имя"]);
    expect(mapping).toEqual(["first_name", null]);
  });

  it("suggests patients only without deal columns", () => {
    const { mapping } = guessMapping(["ФИО", "Телефон", "Дата рождения"]);
    expect(guessMode(mapping)).toBe("patients");
  });

  it("detects an amoCRM export and applies its preset", () => {
    expect(isAmoCrmExport(amoHeaders)).toBe(true);
    expect(isAmoCrmExport(["ФИО", "Телефон"])).toBe(false);
    const { mapping, system } = guessMapping(amoHeaders);
    expect(system).toBe("amocrm");
    expect(mapping).toEqual([
      "external_id",
      "deal_name",
      "plan_amount",
      "responsible",
      "stage",
      "pipeline",
      "full_name",
      "phone",
      "phone",
      null,
      "tags",
      "created_at",
    ]);
  });
});

describe("values", () => {
  it("splits a full name in Russian order", () => {
    expect(splitFullName("Нурланова Асель Маратовна")).toEqual({
      last_name: "Нурланова",
      first_name: "Асель",
      middle_name: "Маратовна",
    });
    expect(splitFullName("Асель")).toEqual({ first_name: "Асель" });
  });

  it("normalizes phones and reports the bad ones", () => {
    expect(
      parsePhones([
        "8 701 111 22 33",
        "+7 (702) 222-33-44, 7012223344",
        "12345",
      ]),
    ).toEqual({
      phones: ["+77011112233", "+77022223344", "+77012223344"],
      invalid: ["12345"],
    });
    expect(parsePhones([87011112233, null, ""]).phones).toEqual([
      "+77011112233",
    ]);
  });

  it("reads amounts", () => {
    expect(parseAmount("450 000 ₸")).toBe(450000);
    expect(parseAmount("1 200,50")).toBe(1201);
    expect(parseAmount(900000)).toBe(900000);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("много")).toBeNaN();
    expect(parseAmount("-5")).toBeNaN();
  });

  it("reads dates", () => {
    expect(parseDateCell("01.03.2026")).toEqual({
      date: "2026-03-01",
      time: null,
    });
    expect(parseDateCell("01.03.2026 10:15")).toEqual({
      date: "2026-03-01",
      time: "10:15",
    });
    expect(parseDateCell("2026-03-01")).toEqual({
      date: "2026-03-01",
      time: null,
    });
    expect(parseDateCell(new Date(Date.UTC(1990, 1, 14)))).toEqual({
      date: "1990-02-14",
      time: null,
    });
    expect(parseDateCell(46082)).toEqual({ date: "2026-03-01", time: null });
    expect(parseDateCell("")).toBeNull();
    expect(parseDateCell("31.02.2026")).toBeUndefined();
    expect(parseDateCell("вчера")).toBeUndefined();
  });
});

describe("rows", () => {
  const headers = [
    "ФИО",
    "Телефон",
    "Email",
    "Дата рождения",
    "Источник",
    "Услуга",
    "Этап",
    "Ответственный",
    "Бюджет",
    "Оплачено",
    "Теги",
    "Комментарий",
    "Дата создания",
  ];
  const { mapping } = guessMapping(headers);
  const sheet = [
    headers,
    [
      "Нурланова Асель",
      "8 701 111 22 33",
      "asel@example.kz",
      "14.02.1990",
      "Instagram",
      "Имплантация",
      "Записан",
      "aigerim@clinic.kz",
      "450 000",
      "150000",
      "VIP, Боится",
      "Первичная",
      "01.03.2026 10:00",
    ],
    ["", "", "", "", "", "", "", "", "", "", "", "", ""],
    [
      "Ахметов Ерлан",
      "123",
      "",
      "",
      "Реклама",
      "",
      "Думает",
      "Иван",
      "",
      "",
      "",
      "",
      "",
    ],
  ];

  it("reads a row and keeps its errors", () => {
    const rows = parseRows(sheet, mapping);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      line: 2,
      last_name: "Нурланова",
      first_name: "Асель",
      phones: ["+77011112233"],
      email: "asel@example.kz",
      birth_date: "1990-02-14",
      plan_amount: 450000,
      paid_amount: 150000,
      tags: ["VIP", "Боится"],
      created_at: "2026-03-01T10:00:00+05:00",
      errors: [],
    });
    expect(rows[1].line).toBe(4);
    expect(rows[1].errors).toEqual([{ code: "bad_phone", value: "123" }]);
  });

  it("maps known values and asks about the others", () => {
    const rows = parseRows(sheet, mapping);
    const resolutions = initialResolutions(rows, "deals", dictionaries);
    expect(resolutions.stage).toEqual({ Записан: 11 });
    expect(resolutions.source).toEqual({ Instagram: 1 });
    expect(resolutions.responsible).toEqual({
      "aigerim@clinic.kz": 7,
      Иван: null,
    });
    expect(unresolvedValues(rows, "deals", resolutions)).toEqual([
      { kind: "stage", values: ["Думает"] },
      { kind: "source", values: ["Реклама"] },
    ]);
    expect(rowErrors(rows[1], "deals", resolutions)).toEqual([
      { code: "bad_phone", value: "123" },
      { code: "unknown_stage", value: "Думает" },
      { code: "unknown_value", kind: "source", value: "Реклама" },
    ]);
    // Patients only: stages do not matter
    expect(
      rowErrors(
        rows[1],
        "patients",
        initialResolutions(rows, "patients", dictionaries),
      ),
    ).toEqual([
      { code: "bad_phone", value: "123" },
      { code: "unknown_value", kind: "source", value: "Реклама" },
    ]);
  });

  it("builds the rows of import_batch", () => {
    const rows = parseRows(sheet, mapping);
    const resolutions = initialResolutions(rows, "deals", dictionaries);
    const { ready, rejected } = buildBatchRows({
      rows,
      mode: "deals",
      system: "excel",
      resolutions,
      dictionaries,
      tagIds: { vip: 3, боится: 4 },
    });
    expect(rejected.map(({ row }) => row.line)).toEqual([4]);
    expect(ready).toEqual([
      {
        index: 2,
        system: "excel",
        patient: {
          external_id: null,
          first_name: "Асель",
          last_name: "Нурланова",
          middle_name: null,
          phones: ["+77011112233"],
          birth_date: "1990-02-14",
          city: null,
          source_id: 1,
          sales_id: 7,
          tags: [],
          background: "Email: asel@example.kz",
          created_at: "2026-03-01T10:00:00+05:00",
          custom_values: {},
        },
        deal: {
          external_id: null,
          name: "Имплантация",
          stage_id: 11,
          source_id: 1,
          service_id: 1,
          plan_amount: 450000,
          paid_amount: 150000,
          sales_id: 7,
          lost_reason_id: null,
          tags: [3, 4],
          description: "Первичная",
          created_at: "2026-03-01T10:00:00+05:00",
          custom_values: {},
        },
      },
    ]);
  });

  it("imports patients only", () => {
    const rows = parseRows(sheet, mapping);
    const { ready } = buildBatchRows({
      rows: rows.slice(0, 1),
      mode: "patients",
      system: "excel",
      resolutions: initialResolutions(rows, "patients", dictionaries),
      dictionaries,
      tagIds: { vip: 3 },
    });
    expect(ready[0].deal).toBeUndefined();
    expect(ready[0].patient.tags).toEqual([3]);
    expect(ready[0].patient.background).toBe(
      "Email: asel@example.kz\nПервичная",
    );
  });
});

describe("amoCRM preset", () => {
  const sheet = [
    amoHeaders,
    [
      "1001",
      "Имплантация",
      "450000",
      "Айгерим Сапарова",
      "Успешно реализовано",
      "Ортодонтия",
      "Нурланова Асель",
      "+7 701 111 22 33",
      "",
      "Врач",
      "VIP",
      "01.03.2026 10:00:00",
    ],
    [
      "1002",
      "",
      "",
      "",
      "Закрыто и не реализовано",
      "Основная",
      "Ерлан",
      "",
      "8 702 222 33 44",
      "",
      "",
      "",
    ],
  ];

  it("maps amoCRM stages, pipelines and responsibles; the deal id is external", () => {
    const { mapping, system } = guessMapping(amoHeaders);
    const rows = parseRows(sheet, mapping);
    const resolutions = initialResolutions(rows, "deals", dictionaries);
    expect(resolutions.stage).toEqual({
      "Ортодонтия / Успешно реализовано": 21,
      "Основная / Закрыто и не реализовано": 13,
    });
    const { ready, rejected } = buildBatchRows({
      rows,
      mode: "deals",
      system,
      resolutions,
      dictionaries,
      tagIds: { vip: 3 },
    });
    expect(rejected).toEqual([]);
    expect(ready.map((row) => row.system)).toEqual(["amocrm", "amocrm"]);
    expect(ready[0].deal).toMatchObject({
      external_id: "1001",
      name: "Имплантация",
      stage_id: 21,
      sales_id: 7,
      plan_amount: 450000,
      tags: [3],
    });
    expect(ready[0].patient.external_id).toBeNull();
    expect(ready[1].deal).toMatchObject({
      external_id: "1002",
      name: "Обращение",
      stage_id: 13,
    });
    expect(ready[1].patient).toMatchObject({
      first_name: "Ерлан",
      phones: ["+77022223344"],
    });
  });
});

describe("files", () => {
  it("writes the rows that failed with their error", () => {
    const csv = errorRowsCsv(
      ["ФИО", "Телефон"],
      [{ cells: ["Ахметов; Ерлан", 123], message: "Неверный телефон «123»" }],
      "Ошибка",
    );
    expect(csv).toBe(
      '\ufeffФИО;Телефон;Ошибка\r\n"Ахметов; Ерлан";123;Неверный телефон «123»\r\n',
    );
  });

  it("offers a sample that maps and parses without errors", () => {
    const lines = sampleCsv()
      .replace(/^\ufeff/, "")
      .trim()
      .split("\r\n");
    const sheet = lines.map((line) => line.split(";"));
    const { mapping } = guessMapping(sheet[0]);
    expect(mapping.every((field) => field != null)).toBe(true);
    const rows = parseRows(sheet, mapping);
    expect(rows).toHaveLength(3);
    expect(rows.flatMap((row) => row.errors)).toEqual([]);
  });
});

describe("custom fields (stage 19)", () => {
  const custom = (
    id: number,
    entity: CustomField["entity"],
    name: string,
    type: CustomField["type"],
    options: string[] = [],
  ): CustomField => ({
    id,
    entity,
    name,
    type,
    options,
    required: false,
    position: id,
    is_active: true,
    show_on_card: false,
  });
  const customFields = [
    custom(1, "deal", "Откуда узнал", "select", ["Инстаграм", "2GIS"]),
    custom(2, "deal", "Есть снимок КТ", "checkbox"),
    custom(3, "patient", "Полис ДМС", "text"),
    custom(4, "deal", "Дата снимка", "date"),
    custom(5, "deal", "Рассрочка", "money"),
    custom(6, "deal", "Аллергии", "multiselect", ["Латекс", "Лидокаин"]),
  ];
  const headers = [
    ...amoHeaders,
    "Откуда узнал",
    "Есть снимок КТ",
    "Полис ДМС (контакт)",
    "Дата снимка",
    "Рассрочка",
    "Аллергии",
    "Непонятная колонка",
  ];

  it("maps amoCRM extra columns to the fields of the same name", () => {
    const { mapping, system } = guessMapping(headers, customFields);
    expect(system).toBe("amocrm");
    expect(mapping.slice(amoHeaders.length)).toEqual([
      "custom:1",
      "custom:2",
      "custom:3",
      "custom:4",
      "custom:5",
      "custom:6",
      null,
    ]);
    // Without fields, nothing changes for the standard columns
    expect(guessMapping(headers).mapping.slice(0, amoHeaders.length)).toEqual(
      mapping.slice(0, amoHeaders.length),
    );
  });

  it("reads the values with the rules of the fields", () => {
    const { mapping } = guessMapping(headers, customFields);
    const base = amoHeaders.map(() => "");
    base[6] = "Нурланова Асель";
    const [row, bad] = parseRows(
      [
        headers,
        [
          ...base,
          "инстаграм",
          "да",
          "ДМС-123",
          "01.03.2026",
          "150 000 ₸",
          "Латекс, лидокаин",
          "x",
        ],
        [...base, "Telegram", "", "", "", "", "", ""],
      ],
      mapping,
      customFields,
    );
    expect(row.errors).toEqual([]);
    expect(row.custom).toEqual({
      patient: { "3": "ДМС-123" },
      deal: {
        "1": "Инстаграм",
        "2": true,
        "4": "2026-03-01",
        "5": 150000,
        "6": ["Латекс", "Лидокаин"],
      },
    });
    expect(bad.errors).toEqual([
      { code: "bad_custom", field: "Откуда узнал", value: "Telegram" },
    ]);
  });

  it("sends the values to import_batch; patients only drop the deal fields", () => {
    const { mapping } = guessMapping(headers, customFields);
    const base = amoHeaders.map(() => "");
    base[6] = "Нурланова Асель";
    const sheet = [
      headers,
      [...base, "2GIS", "нет", "ДМС-1", "", "", "", ""],
    ];
    const rows = parseRows(sheet, mapping, customFields);
    const { ready } = buildBatchRows({
      rows,
      mode: "deals",
      system: "amocrm",
      resolutions: initialResolutions(rows, "deals", dictionaries),
      dictionaries,
      tagIds: {},
    });
    expect(ready[0].patient.custom_values).toEqual({ "3": "ДМС-1" });
    expect(ready[0].deal?.custom_values).toEqual({ "1": "2GIS", "2": false });
    expect(
      effectiveMapping(mapping, "patients", customFields).slice(
        amoHeaders.length,
      ),
    ).toEqual([null, null, "custom:3", null, null, null, null]);
  });
});
