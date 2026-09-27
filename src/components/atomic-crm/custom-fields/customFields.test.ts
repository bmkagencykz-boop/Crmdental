import type { CustomField, Stage } from "../types";
import {
  cardFields,
  checkRequiredFields,
  cleanOptions,
  containsValues,
  customCsvColumns,
  customFieldText,
  customFieldVars,
  customValuesDiff,
  customValuesProblem,
  dealChecksRequired,
  definitionProblem,
  displayCustomValue,
  filterableFields,
  findFieldByName,
  missingRequiredField,
  normalizeCustomValue,
  normalizeDefinition,
  parseCustomFilter,
  sanitizeCustomValues,
  toCustomFilter,
} from "./customFields";

const field = (
  id: number,
  name: string,
  type: CustomField["type"],
  extra: Partial<CustomField> = {},
): CustomField => ({
  id,
  entity: "deal",
  name,
  type,
  options: [],
  required: false,
  position: id,
  is_active: true,
  show_on_card: false,
  ...extra,
});

const complaint = field(1, "Жалоба", "textarea");
const found = field(2, "Откуда узнал", "select", {
  options: ["Инстаграм", "2GIS", "Рекомендация", "Реклама"],
});
const ct = field(3, "Есть снимок КТ", "checkbox");
const policy = field(4, "Полис ДМС", "text");
const installment = field(5, "Сумма рассрочки", "money");
const teeth = field(6, "Зубов", "number");
const shot = field(7, "Дата снимка", "date");
const call = field(8, "Созвон", "datetime");
const allergies = field(9, "Аллергии", "multiselect", {
  options: ["Лидокаин", "Латекс", "Пенициллин"],
});
const relative = field(10, "Телефон родственника", "phone");
const site = field(11, "Сайт", "url");
const fields = [
  complaint,
  found,
  ct,
  policy,
  installment,
  teeth,
  shot,
  call,
  allergies,
  relative,
  site,
];

describe("normalizeCustomValue (same as private.custom_value)", () => {
  it("reads text", () => {
    expect(normalizeCustomValue(policy, "  AB-123 ")).toBe("AB-123");
    expect(normalizeCustomValue(policy, "  ")).toBeNull();
    expect(normalizeCustomValue(policy, 42)).toBe("42");
    expect(normalizeCustomValue(policy, null)).toBeNull();
    expect(() => normalizeCustomValue(policy, "x".repeat(1001))).toThrow(
      "Поле «Полис ДМС»: ожидается текст до 1000 символов",
    );
    expect(() => normalizeCustomValue(policy, { a: 1 })).toThrow();
    expect(normalizeCustomValue(complaint, "Болит зуб\nслева")).toBe(
      "Болит зуб\nслева",
    );
  });

  it("reads numbers and money", () => {
    expect(normalizeCustomValue(teeth, "1 234,5")).toBe(1234.5);
    expect(normalizeCustomValue(teeth, -3)).toBe(-3);
    expect(normalizeCustomValue(teeth, "2.50")).toBe(2.5);
    expect(() => normalizeCustomValue(teeth, "два")).toThrow(
      "Поле «Зубов»: ожидается число",
    );
    expect(normalizeCustomValue(installment, "150 000 ₸")).toBe(150000);
    expect(normalizeCustomValue(installment, "25 000 тг")).toBe(25000);
    expect(normalizeCustomValue(installment, "12\u00a0000")).toBe(12000);
    expect(normalizeCustomValue(installment, 1500.6)).toBe(1501);
    expect(() => normalizeCustomValue(installment, -5)).toThrow(
      "Поле «Сумма рассрочки»: ожидается сумма в тенге",
    );
  });

  it("reads dates and moments", () => {
    expect(normalizeCustomValue(shot, "2026-03-01")).toBe("2026-03-01");
    expect(() => normalizeCustomValue(shot, "2026-02-30")).toThrow();
    expect(() => normalizeCustomValue(shot, "01.03.2026")).toThrow();
    expect(normalizeCustomValue(call, "2026-03-01T10:00:00+05:00")).toBe(
      "2026-03-01T05:00:00.000Z",
    );
    expect(normalizeCustomValue(call, "2026-03-01 10:00+05")).toBe(
      "2026-03-01T05:00:00.000Z",
    );
    expect(() => normalizeCustomValue(call, "2026-03-01T10:00")).toThrow(
      "Поле «Созвон»: ожидается дата и время",
    );
  });

  it("reads checkboxes", () => {
    expect(normalizeCustomValue(ct, true)).toBe(true);
    expect(normalizeCustomValue(ct, "Да")).toBe(true);
    expect(normalizeCustomValue(ct, "нет")).toBe(false);
    expect(normalizeCustomValue(ct, false)).toBe(false);
    expect(normalizeCustomValue(ct, "")).toBeNull();
    expect(() => normalizeCustomValue(ct, "может быть")).toThrow(
      "ожидается да или нет",
    );
  });

  it("reads lists: the option as written in the list", () => {
    expect(normalizeCustomValue(found, " инстаграм")).toBe("Инстаграм");
    expect(() => normalizeCustomValue(found, "Telegram")).toThrow(
      "ожидается значение из списка",
    );
    expect(
      normalizeCustomValue(allergies, ["пенициллин", "Лидокаин", "Лидокаин"]),
    ).toEqual(["Лидокаин", "Пенициллин"]);
    expect(normalizeCustomValue(allergies, "латекс")).toEqual(["Латекс"]);
    expect(normalizeCustomValue(allergies, [])).toBeNull();
    expect(() => normalizeCustomValue(allergies, ["Мёд"])).toThrow(
      "ожидается значения из списка",
    );
  });

  it("reads phones and links", () => {
    expect(normalizeCustomValue(relative, "8 701 111 22 33")).toBe(
      "+77011112233",
    );
    expect(() => normalizeCustomValue(relative, "12345")).toThrow(
      "ожидается номер телефона",
    );
    expect(normalizeCustomValue(site, "clinic.kz/about")).toBe(
      "https://clinic.kz/about",
    );
    expect(normalizeCustomValue(site, "http://clinic.kz")).toBe(
      "http://clinic.kz",
    );
    expect(() => normalizeCustomValue(site, "не ссылка")).toThrow(
      "ожидается ссылка",
    );
  });
});

describe("sanitizeCustomValues (same as private.handle_custom_values)", () => {
  it("normalizes, drops empty values and unknown keys", () => {
    expect(
      sanitizeCustomValues({
        fields,
        entity: "deal",
        next: {
          "2": "инстаграм",
          "5": "200 000",
          "4": "",
          "999": "?",
          abc: 1,
        },
      }),
    ).toEqual({ "2": "Инстаграм", "5": 200000 });
  });

  it("keeps unchanged values and the values of archived fields", () => {
    const narrowed = { ...found, options: ["2GIS"] };
    const archived = { ...installment, is_active: false };
    expect(
      sanitizeCustomValues({
        fields: [narrowed, archived, policy],
        entity: "deal",
        previous: { "2": "Инстаграм", "5": 200000 },
        next: { "2": "Инстаграм", "5": 1, "4": "AB-7" },
      }),
    ).toEqual({ "2": "Инстаграм", "5": 200000, "4": "AB-7" });
  });

  it("ignores the fields of the other entity", () => {
    const patientField = { ...policy, id: 20, entity: "patient" as const };
    expect(
      sanitizeCustomValues({
        fields: [patientField],
        entity: "deal",
        next: { "20": "x" },
      }),
    ).toEqual({});
  });
});

describe("required fields", () => {
  const required = [
    { ...complaint, required: true },
    { ...ct, required: true },
    policy,
  ];
  it("finds the first empty required field; a checkbox must be ticked", () => {
    expect(missingRequiredField(required, "deal", {})?.name).toBe("Жалоба");
    expect(
      missingRequiredField(required, "deal", { "1": "Болит", "3": false })
        ?.name,
    ).toBe("Есть снимок КТ");
    expect(
      missingRequiredField(required, "deal", { "1": "Болит", "3": true }),
    ).toBeUndefined();
    expect(() => checkRequiredFields(required, "deal", {})).toThrow(
      "Заполните поле «Жалоба»",
    );
  });

  it("archived fields are never required", () => {
    expect(
      missingRequiredField(
        [{ ...complaint, required: true, is_active: false }],
        "deal",
        {},
      ),
    ).toBeUndefined();
  });

  const stages = [
    { id: 1, pipeline_id: 1, position: 0, kind: "open" },
    { id: 2, pipeline_id: 1, position: 1, kind: "open" },
    { id: 3, pipeline_id: 1, position: 2, kind: "lost" },
  ] as Pick<Stage, "id" | "pipeline_id" | "position" | "kind">[];
  const check = (
    stage_id: number,
    changes: Partial<{
      isNew: boolean;
      stageChanged: boolean;
      valuesChanged: boolean;
    }>,
  ) =>
    dealChecksRequired({
      stages,
      deal: { pipeline_id: 1, stage_id },
      isNew: false,
      stageChanged: false,
      valuesChanged: false,
      ...changes,
    });

  it("deals: outside the first stage, not refused, when something moves", () => {
    expect(check(1, { isNew: true, valuesChanged: true })).toBe(false);
    expect(check(2, { stageChanged: true })).toBe(true);
    expect(check(2, { isNew: true })).toBe(true);
    expect(check(2, { valuesChanged: true })).toBe(true);
    expect(check(2, {})).toBe(false);
    expect(check(3, { stageChanged: true })).toBe(false);
  });

  it("checks a form", () => {
    expect(
      customValuesProblem(required, "deal", { "1": "Болит", "3": true }),
    ).toBeUndefined();
    expect(customValuesProblem(required, "deal", {})).toBe(
      "Заполните поле «Жалоба»",
    );
    expect(
      customValuesProblem(required, "deal", {}, { required: false }),
    ).toBeUndefined();
    expect(customValuesProblem(fields, "deal", { "6": "два" })).toBe(
      "Поле «Зубов»: ожидается число",
    );
  });
});

describe("texts (same as private.custom_field_text)", () => {
  it("formats every type for the templates", () => {
    expect(customFieldText("money", 1250000)).toBe("1 250 000 ₸");
    expect(customFieldText("money", 500)).toBe("500 ₸");
    expect(customFieldText("date", "2026-03-01")).toBe("01.03.2026");
    expect(
      customFieldText("datetime", "2026-03-12T09:30:00.000Z", "Asia/Almaty"),
    ).toBe("12 марта в 14:30");
    expect(customFieldText("checkbox", true)).toBe("да");
    expect(customFieldText("checkbox", false)).toBe("нет");
    expect(customFieldText("multiselect", ["Латекс", "Пенициллин"])).toBe(
      "Латекс, Пенициллин",
    );
    expect(customFieldText("multiselect", [])).toBeNull();
    expect(customFieldText("number", 2.5)).toBe("2.5");
    expect(customFieldText("text", undefined)).toBeNull();
  });

  it("gives the {поле:Название} variables", () => {
    expect(
      customFieldVars(
        [found, installment, complaint, { ...policy, entity: "patient" }],
        "deal",
        { "2": "Инстаграм", "5": 1250000 },
      ),
    ).toEqual({
      "поле:Откуда узнал": "Инстаграм",
      "поле:Сумма рассрочки": "1 250 000 ₸",
      "поле:Жалоба": null,
    });
  });

  it("shows values on the screens", () => {
    const money = (n: number) => `${n} KZT`;
    expect(displayCustomValue(ct, true)).toBe("Да");
    expect(displayCustomValue(ct, false, { no: "No" })).toBe("No");
    expect(displayCustomValue(installment, 1000, { formatMoney: money })).toBe(
      "1000 KZT",
    );
    expect(displayCustomValue(policy, "")).toBeNull();
    expect(displayCustomValue(shot, "2026-03-01")).toBe("01.03.2026");
  });

  it("builds the CSV columns by field name, archived fields included", () => {
    expect(
      customCsvColumns(
        [found, { ...ct, is_active: false }, { ...policy, entity: "patient" }],
        "deal",
        { "2": "2GIS", "3": true },
      ),
    ).toEqual({ "Откуда узнал": "2GIS", "Есть снимок КТ": "да" });
  });
});

describe("logs and filters", () => {
  it("diffs the values per field", () => {
    expect(
      customValuesDiff({ "2": "2GIS", "5": 1 }, { "2": "2GIS", "4": "AB" }),
    ).toEqual({ "cf:4": [null, "AB"], "cf:5": [1, null] });
    expect(customValuesDiff({ "9": ["Латекс"] }, { "9": ["Латекс"] })).toEqual(
      {},
    );
  });

  it("builds and reads the custom_values@cs filter", () => {
    expect(toCustomFilter({ "2": "Инстаграм", "3": null, "9": [] })).toBe(
      '{"2":"Инстаграм"}',
    );
    expect(toCustomFilter({})).toBeUndefined();
    expect(parseCustomFilter('{"2":"Инстаграм","3":true}')).toEqual({
      "2": "Инстаграм",
      "3": true,
    });
    expect(parseCustomFilter("{1,2}")).toEqual({});
    expect(parseCustomFilter(undefined)).toEqual({});
  });

  it("matches like jsonb containment", () => {
    const values = { "2": "Инстаграм", "3": true, "9": ["Латекс", "Лидокаин"] };
    expect(containsValues(values, { "2": "Инстаграм" })).toBe(true);
    expect(containsValues(values, { "2": "2GIS" })).toBe(false);
    expect(containsValues(values, { "9": ["Лидокаин"] })).toBe(true);
    expect(containsValues(values, { "3": true, "2": "Инстаграм" })).toBe(true);
    expect(containsValues({}, { "3": false })).toBe(false);
  });

  it("lists the filterable and the card fields", () => {
    expect(filterableFields(fields).map((f) => f.name)).toEqual([
      "Откуда узнал",
      "Есть снимок КТ",
      "Аллергии",
    ]);
    expect(
      cardFields([
        { ...policy, show_on_card: true },
        { ...found, show_on_card: true },
        { ...ct, show_on_card: true, is_active: false },
      ]).map((f) => f.name),
    ).toEqual(["Откуда узнал", "Полис ДМС"]);
  });
});

describe("definitions (same as private.handle_custom_field_write)", () => {
  it("cleans the options and the card flag", () => {
    expect(cleanOptions([" Инстаграм ", "2GIS", "инстаграм", ""])).toEqual([
      "Инстаграм",
      "2GIS",
    ]);
    expect(
      normalizeDefinition({
        entity: "patient",
        name: "  Полис ",
        type: "text",
        options: ["x"],
        show_on_card: true,
        is_active: true,
      }),
    ).toEqual({
      entity: "patient",
      name: "Полис",
      type: "text",
      options: [],
      show_on_card: false,
      is_active: true,
    });
  });

  it("refuses bad definitions", () => {
    const base = {
      entity: "deal" as const,
      type: "text" as const,
      options: [],
      show_on_card: false,
      is_active: true,
    };
    expect(definitionProblem({ ...base, name: " " }, fields)).toBe(
      "custom_fields.errors.name_required",
    );
    expect(definitionProblem({ ...base, name: "A{b}" }, fields)).toBe(
      "custom_fields.errors.name_braces",
    );
    expect(definitionProblem({ ...base, name: "жалоба" }, fields)).toBe(
      "custom_fields.errors.name_taken",
    );
    expect(
      definitionProblem({ ...base, name: "жалоба", id: 1 }, fields),
    ).toBeUndefined();
    expect(
      definitionProblem({ ...base, name: "Список", type: "select" }, fields),
    ).toBe("custom_fields.errors.options_required");
    const onCard = fields.map((f) =>
      f.id === 2 || f.id === 3 ? { ...f, show_on_card: true } : f,
    );
    expect(
      definitionProblem(
        { ...base, name: "Третье", show_on_card: true },
        onCard,
      ),
    ).toBe("custom_fields.errors.card_limit");
    expect(
      definitionProblem(
        { ...base, id: 2, name: "Откуда узнал", show_on_card: true },
        onCard,
      ),
    ).toBeUndefined();
  });

  it("finds a field by a column name", () => {
    expect(findFieldByName(fields, "deal", " откуда узнал ")?.id).toBe(2);
    expect(findFieldByName(fields, "patient", "Откуда узнал")).toBeUndefined();
  });
});
