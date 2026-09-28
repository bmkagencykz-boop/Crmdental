import { describe, expect, it } from "vitest";

import { validateScenario } from "./engine";
import {
  exportBot,
  importBot,
  missingTags,
  parsePortableBot,
  type BotDictionaries,
} from "./portable";
import { BOT_TEMPLATES } from "./templates";
import type { Salesbot } from "./types";

const clinicA: BotDictionaries = {
  stages: [
    { id: 1, name: "Новый лид" },
    { id: 2, name: "В работе" },
    { id: 3, name: "Записан" },
  ],
  tags: [
    { id: 10, name: "Боль" },
    { id: 11, name: "Имплантация" },
  ],
  sources: [{ id: 20, name: "WhatsApp" }],
  fields: [{ id: 30, name: "Жалоба" }],
  templates: [{ id: 40, name: "Приветствие" }],
  webhooks: [{ id: 50, name: "МИС" }],
  services: [{ id: 60, name: "Имплантация" }],
  doctors: [{ id: 70, name: "Др. Ахметов" }],
};

// Another clinic: same names, other ids (and a different case / ё)
const clinicB: BotDictionaries = {
  stages: [
    { id: 101, name: "Новый лид" },
    { id: 103, name: "записан" },
  ],
  tags: [{ id: 110, name: "боль" }],
  sources: [{ id: 120, name: "WhatsApp" }],
  fields: [{ id: 130, name: "Жалоба" }],
  templates: [{ id: 140, name: "Приветствие" }],
  webhooks: [],
  services: [{ id: 160, name: "Имплантация" }],
  doctors: [],
};

const bot: Pick<
  Salesbot,
  | "name"
  | "description"
  | "scenario"
  | "trigger_new_lead"
  | "trigger_transports"
  | "trigger_keywords"
  | "trigger_source_ids"
> = {
  name: "Консультация",
  description: "Тест",
  trigger_new_lead: true,
  trigger_transports: ["whatsapp"],
  trigger_keywords: ["цена"],
  trigger_source_ids: [20],
  scenario: {
    start: "a",
    steps: [
      { id: "a", type: "send_message", template_id: 40, next: "c" },
      {
        id: "c",
        type: "condition",
        branches: [
          { match: "tag", tag_id: 10, next: "s" },
          { match: "stage", stage_id: 3, next: "s" },
          { match: "field", field_id: 30, value: "боль", next: "s" },
          { match: "keywords", value: "да", next: "s" },
        ],
        else_next: "w",
      },
      {
        id: "s",
        type: "set",
        actions: [
          { kind: "stage", stage_id: 3 },
          { kind: "tag_add", tag_id: 11 },
          { kind: "deal_field", field: "service_id", value: "60" },
          { kind: "deal_field", field: "plan_amount", value: "150000" },
          { kind: "responsible", sales_id: 5 },
          { kind: "field", field_id: 30, value: "{ответ}" },
        ],
        next: "w",
      },
      { id: "w", type: "webhook", webhook_id: 50 },
    ],
  },
};

describe("export / import", () => {
  it("exports names instead of the ids of the clinic", () => {
    const portable = exportBot(bot, clinicA);
    expect(portable.format).toBe("dentalcrm.salesbot");
    expect(portable.triggers).toEqual({
      new_lead: true,
      transports: ["whatsapp"],
      keywords: ["цена"],
      sources: ["WhatsApp"],
    });
    const json = JSON.stringify(portable);
    expect(json).not.toMatch(/"(stage|tag|field|template|webhook)_id"/);
    expect(json).not.toContain('"sales_id"');
    const [message, condition, set, webhook] = portable.scenario.steps;
    expect(message.template_name).toBe("Приветствие");
    expect(condition.branches?.map((b) => b.tag_name ?? b.stage_name ?? b.field_name ?? b.value)).toEqual([
      "Боль",
      "Записан",
      "Жалоба",
      "да",
    ]);
    expect(set.actions?.[2]).toEqual({
      kind: "deal_field",
      field: "service_id",
      value: null,
      value_name: "Имплантация",
    });
    expect(set.actions?.[3]).toMatchObject({ value: "150000" });
    expect(webhook.webhook_name).toBe("МИС");
  });

  it("imports into another clinic by name; what is missing stays empty", () => {
    const text = JSON.stringify(exportBot(bot, clinicA));
    const portable = parsePortableBot(text);
    expect(missingTags(portable, clinicB)).toEqual(["Имплантация"]);
    const imported = importBot(portable, clinicB);
    expect(imported.is_active).toBe(false);
    expect(imported.trigger_source_ids).toEqual([120]);
    const [message, condition, set, webhook] = imported.scenario.steps;
    expect(message.template_id).toBe(140);
    expect(condition.branches?.[0].tag_id).toBe(110);
    expect(condition.branches?.[1].stage_id).toBe(103);
    expect(condition.branches?.[2].field_id).toBe(130);
    expect(set.actions?.[0].stage_id).toBe(103);
    expect(set.actions?.[1].tag_id).toBeNull();
    expect(set.actions?.[2].value).toBe("160");
    expect(set.actions?.[4]).toEqual({ kind: "responsible" });
    expect(webhook.webhook_id).toBeNull();
    expect(validateScenario(imported.scenario)).toEqual([
      { code: "missing_param", step: "s" },
      { code: "missing_param", step: "w" },
    ]);
  });

  it("round-trips in the same clinic", () => {
    const again = importBot(exportBot(bot, clinicA), clinicA);
    expect(again.scenario.steps[2].actions?.[0].stage_id).toBe(3);
    expect(again.scenario.steps[3].webhook_id).toBe(50);
    expect(validateScenario(again.scenario)).toEqual([]);
  });

  it("refuses what is not a bot", () => {
    expect(() => parsePortableBot("{oops")).toThrow(
      "salesbot.import.invalid_json",
    );
    expect(() => parsePortableBot({ name: "x" })).toThrow(
      "salesbot.import.invalid_format",
    );
  });

  it("gives valid templates once the clinic has the stages and tags", () => {
    const clinic: BotDictionaries = {
      ...clinicA,
      tags: [
        { id: 10, name: "Боль" },
        { id: 11, name: "Имплантация" },
        { id: 12, name: "Брекеты" },
      ],
      services: [
        { id: 60, name: "Имплантация" },
        { id: 61, name: "Ортодонтия" },
      ],
    };
    for (const template of BOT_TEMPLATES) {
      expect(missingTags(template.bot, clinicA).length >= 0).toBe(true);
      const imported = importBot(template.bot, clinic);
      expect(validateScenario(imported.scenario)).toEqual([]);
    }
    expect(missingTags(BOT_TEMPLATES[0].bot, clinicA)).toEqual(["Брекеты"]);
  });
});
