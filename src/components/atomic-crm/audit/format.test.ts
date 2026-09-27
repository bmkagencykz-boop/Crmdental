import { beforeAll, describe, expect, it } from "vitest";

import { i18nProvider } from "../providers/commons/i18nProvider";
import type { AuditLogEntry } from "../types";
import {
  auditActionLabel,
  auditActor,
  auditEntityLabel,
  auditEntityLink,
  auditSummary,
  describeAuditChanges,
  formatAuditTime,
  formatAuditValue,
  toAuditCsvRows,
  toAuditListFilter,
  type AuditLookups,
} from "./format";

const t = (key: string, options?: any) => i18nProvider.translate(key, options);

// Intl writes narrow no-break spaces in amounts: compare with plain spaces
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

const lookups: AuditLookups = {
  currency: "KZT",
  sales: [
    { id: 0, first_name: "Айгерим", last_name: "Садыкова" },
    { id: 1, first_name: "Иван", last_name: "Иванов" },
    { id: 2, first_name: "Пётр", last_name: "Петров" },
  ],
  stages: [
    { id: 11, name: "В работе" },
    { id: 12, name: "Записан" },
  ],
  pipelines: [{ id: 1, name: "Основная" }],
  lostReasons: [{ id: 5, name: "Дорого" }],
  doctors: [{ id: 3, name: "Ахметова Г. С." }],
  sources: [{ id: 3, name: "WhatsApp" }],
  services: [{ id: 4, name: "Имплантация" }],
  tags: [
    { id: 7, name: "VIP" },
    { id: 8, name: "Рассрочка" },
  ],
};

const entry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 1,
  at: "2026-09-27T10:00:00Z",
  sales_id: 0,
  source: "user",
  entity: "deal",
  entity_id: 42,
  action: "update",
  changes: {},
  deal_id: 42,
  patient_id: 9,
  deal_name: "Имплантация",
  patient_name: "Ахметов Даулет",
  ...overrides,
});

beforeAll(async () => {
  await i18nProvider.changeLocale("ru");
});

describe("formatAuditValue", () => {
  it("names the referenced rows", () => {
    expect(formatAuditValue("stage_id", 12, lookups, t)).toBe("Записан");
    expect(formatAuditValue("sales_id", 1, lookups, t)).toBe("Иван Иванов");
    expect(formatAuditValue("sales_id", 0, lookups, t)).toBe(
      "Айгерим Садыкова",
    );
    expect(formatAuditValue("lost_reason_id", 5, lookups, t)).toBe("Дорого");
    expect(formatAuditValue("stage_id", 99, lookups, t)).toBe("#99");
    expect(formatAuditValue("tags", [7, 8], lookups, t)).toBe("VIP, Рассрочка");
    expect(
      formatAuditValue("lead_distribution_sales_ids", [1, 2], lookups, t),
    ).toBe("Иван Иванов, Пётр Петров");
  });

  it("formats money, dates, booleans, durations and enums", () => {
    expect(plain(formatAuditValue("plan_amount", 120000, lookups, t))).toBe(
      "120 000 ₸",
    );
    expect(formatAuditValue("paid_at", "2026-09-05", lookups, t)).toBe(
      "05.09.2026",
    );
    expect(
      formatAuditValue(
        "due_date",
        new Date(2026, 8, 27, 14, 5).toISOString(),
        lookups,
        t,
      ),
    ).toBe("27.09.2026 14:05");
    expect(formatAuditValue("disabled", true, lookups, t)).toBe("Да");
    expect(formatAuditValue("is_active", false, lookups, t)).toBe("Нет");
    expect(formatAuditValue("due_in_minutes", 90, lookups, t)).toBe(
      "1 ч 30 мин",
    );
    expect(formatAuditValue("role", "head", lookups, t)).toBe("Руководитель");
    expect(formatAuditValue("manager_deal_visibility", "own", lookups, t)).toBe(
      "Только свои",
    );
    expect(formatAuditValue("type", "call", lookups, t)).toBe("Звонок");
    expect(formatAuditValue("phones", ["+77015551234"], lookups, t)).toBe(
      "+77015551234",
    );
  });

  it("shows a dash for empty values", () => {
    expect(formatAuditValue("sales_id", null, lookups, t)).toBe("—");
    expect(formatAuditValue("tags", [], lookups, t)).toBe("—");
    expect(formatAuditValue("name", "", lookups, t)).toBe("—");
  });
});

describe("describeAuditChanges", () => {
  it("reads like the spec: stage, amount, responsible", () => {
    const lines = describeAuditChanges(
      entry({
        changes: {
          stage_id: [11, 12],
          plan_amount: [100000, 120000],
          sales_id: [1, 2],
        },
      }),
      lookups,
      t,
    ).map(plain);
    expect(lines).toEqual([
      "Этап: В работе → Записан",
      "Сумма: 100 000 ₸ → 120 000 ₸",
      "Ответственный: Иван Иванов → Пётр Петров",
    ]);
  });

  it("shows the values of a created or deleted row without arrows", () => {
    expect(
      describeAuditChanges(
        entry({
          entity: "payment",
          action: "create",
          changes: { amount: [null, 50000], comment: [null, "Kaspi"] },
        }),
        lookups,
        t,
      ).map(plain),
    ).toEqual(["Сумма оплаты: 50 000 ₸", "Комментарий: Kaspi"]);
    expect(
      describeAuditChanges(
        entry({
          entity: "task",
          action: "delete",
          changes: { text: ["Перезвонить", null] },
        }),
        lookups,
        t,
      ),
    ).toEqual(["Текст: Перезвонить"]);
  });

  it("joins the lines in the summary", () => {
    expect(
      auditSummary(
        entry({
          action: "stage_change",
          changes: { stage_id: [11, 12], lost_reason_id: [null, 5] },
        }),
        lookups,
        t,
      ),
    ).toBe("Этап: В работе → Записан; Причина отказа: — → Дорого");
    expect(auditSummary(entry({ changes: {} }), lookups, t)).toBe("");
  });

  it("keeps unknown fields readable", () => {
    expect(
      describeAuditChanges(
        entry({ changes: { custom: ["a", "b"] } }),
        lookups,
        t,
      ),
    ).toEqual(["custom: a → b"]);
  });
});

describe("auditActor and labels", () => {
  it("names the employee, or the source of a system action", () => {
    expect(auditActor(entry({ sales_id: 2 }), lookups, t)).toBe("Пётр Петров");
    expect(
      auditActor(entry({ sales_id: null, source: "automation" }), lookups, t),
    ).toBe("Автоматически");
    expect(
      auditActor(entry({ sales_id: null, source: "webhook" }), lookups, t),
    ).toBe("Интеграция");
    expect(
      auditActor(entry({ sales_id: null, source: "telephony" }), lookups, t),
    ).toBe("telephony");
  });

  it("labels the actions", () => {
    expect(auditActionLabel({ action: "stage_change" }, t)).toBe("Смена этапа");
    expect(auditActionLabel({ action: "complete" }, t)).toBe("Выполнена");
  });

  it("labels the entity with the deal, patient or setting name", () => {
    expect(auditEntityLabel(entry({}), lookups, t)).toBe(
      "Сделка «Имплантация»",
    );
    expect(
      auditEntityLabel(
        entry({ entity: "payment", deal_name: null }),
        lookups,
        t,
      ),
    ).toBe("Оплата «#42»");
    expect(
      auditEntityLabel(
        entry({ entity: "patient", deal_id: null, entity_id: 9 }),
        lookups,
        t,
      ),
    ).toBe("Пациент Ахметов Даулет");
    expect(
      auditEntityLabel(
        entry({
          entity: "deal",
          action: "delete",
          deal_name: null,
          changes: { name: ["Виниры", null] },
        }),
        lookups,
        t,
      ),
    ).toBe("Сделка «Виниры»");
    expect(
      auditEntityLabel(
        entry({ entity: "employee", entity_id: 1, deal_id: null }),
        lookups,
        t,
      ),
    ).toBe("Сотрудник Иван Иванов");
    expect(
      auditEntityLabel(
        entry({ entity: "stage", entity_id: 12, deal_id: null }),
        lookups,
        t,
      ),
    ).toBe("Этап «Записан»");
    expect(
      auditEntityLabel(
        entry({ entity: "settings", entity_id: null, deal_id: null }),
        lookups,
        t,
      ),
    ).toBe("Настройки клиники");
  });

  it("links to the deal, else to the patient", () => {
    expect(auditEntityLink(entry({}))).toBe("/deals/42/show");
    expect(auditEntityLink(entry({ deal_id: null }))).toBe("/patients/9/show");
    expect(
      auditEntityLink(entry({ deal_id: null, patient_id: null })),
    ).toBeNull();
  });

  it("formats the time", () => {
    expect(formatAuditTime(new Date(2026, 0, 3, 9, 7))).toBe(
      "03.01.2026 09:07",
    );
    expect(formatAuditTime("not a date")).toBe("—");
  });
});

describe("toAuditListFilter", () => {
  const now = new Date(2026, 8, 27, 15, 0);

  it("turns the screen's filters into list filters", () => {
    expect(
      toAuditListFilter(
        {
          period: "custom",
          from: "2026-09-01",
          to: "2026-09-30",
          sales_id: "2",
          entity: "settings",
          q: "  ахметов ",
        },
        now,
      ),
    ).toEqual({
      "at@gte": new Date(2026, 8, 1).toISOString(),
      "at@lt": new Date(2026, 9, 1).toISOString(),
      sales_id: 2,
      "entity@in":
        "(pipeline,stage,settings,task_rule,checklist_item,messenger,custom_field)",
      q: "ахметов",
    });
  });

  it("filters the system actions and keeps everything for all time", () => {
    expect(
      toAuditListFilter({ period: "all", sales_id: "system" }, now),
    ).toEqual({ "sales_id@is": null });
    expect(toAuditListFilter({ period: "all" }, now)).toEqual({});
  });
});

describe("toAuditCsvRows", () => {
  it("writes one row per entry with the table's columns", () => {
    const [row] = toAuditCsvRows(
      [entry({ changes: { plan_amount: [100000, 120000] } })],
      lookups,
      t,
    );
    expect(Object.keys(row)).toEqual([
      "Время",
      "Сотрудник",
      "Объект",
      "Действие",
      "Изменения",
    ]);
    expect(row["Сотрудник"]).toBe("Айгерим Садыкова");
    expect(row["Объект"]).toBe("Сделка «Имплантация»");
    expect(row["Действие"]).toBe("Изменение");
    expect(plain(row["Изменения"])).toBe("Сумма: 100 000 ₸ → 120 000 ₸");
  });
  it("names the doctor of a deal and formats the consultation price", () => {
    const lines = describeAuditChanges(
      entry({
        changes: { doctor_id: [null, 3], consultation_amount: [null, 15000] },
      }),
      lookups,
      t,
    ).map(plain);
    expect(lines[0]).toContain("Ахметова Г. С.");
    expect(lines[1]).toContain("15 000");
  });
});

describe("custom fields (stage 19)", () => {
  beforeAll(() => i18nProvider.changeLocale("ru"));
  const withFields: AuditLookups = {
    ...lookups,
    customFields: [
      {
        id: 2,
        entity: "deal",
        name: "Откуда узнал",
        type: "select",
        options: ["Инстаграм", "2GIS"],
        required: false,
        position: 0,
        is_active: true,
        show_on_card: true,
      },
      {
        id: 5,
        entity: "deal",
        name: "Рассрочка",
        type: "money",
        options: [],
        required: false,
        position: 1,
        is_active: false,
        show_on_card: false,
      },
    ],
  };

  it("shows one line per field, with its name", () => {
    expect(
      describeAuditChanges(
        entry({
          changes: {
            "cf:2": ["2GIS", "Инстаграм"],
            "cf:5": [null, 150000],
            "cf:9": ["x", null],
          },
        }),
        withFields,
        t,
      ).map(plain),
    ).toEqual([
      "Откуда узнал: 2GIS → Инстаграм",
      "Рассрочка: — → 150 000 ₸",
      "Поле #9: x → —",
    ]);
  });

  it("describes the definitions of the fields", () => {
    const created = entry({
      entity: "custom_field",
      entity_id: 2,
      action: "create",
      deal_id: null,
      patient_id: null,
      deal_name: null,
      patient_name: null,
      changes: {
        name: [null, "Откуда узнал"],
        type: [null, "select"],
        options: [null, ["Инстаграм", "2GIS"]],
        required: [null, false],
      },
    });
    expect(describeAuditChanges(created, withFields, t)).toEqual([
      "Название: Откуда узнал",
      "Тип: Список",
      "Варианты: Инстаграм, 2GIS",
      "Обязательное: Нет",
    ]);
    expect(auditEntityLabel(created, withFields, t)).toBe(
      "Поле «Откуда узнал»",
    );
  });
});
