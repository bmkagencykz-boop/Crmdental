import { random } from "faker/locale/en_US";

import type { CustomField } from "../../../types";
import type { Db } from "./types";

/** Custom fields of the demo clinic (stage 19) */
export const DEMO_CUSTOM_FIELDS: CustomField[] = [
  {
    id: 1,
    entity: "deal",
    name: "Жалоба",
    type: "textarea",
    options: [],
    required: false,
    position: 0,
    is_active: true,
    show_on_card: false,
  },
  {
    id: 2,
    entity: "deal",
    name: "Откуда узнал",
    type: "select",
    options: ["Инстаграм", "2GIS", "Рекомендация", "Реклама"],
    required: false,
    position: 1,
    is_active: true,
    show_on_card: true,
  },
  {
    id: 3,
    entity: "deal",
    name: "Есть снимок КТ",
    type: "checkbox",
    options: [],
    required: false,
    position: 2,
    is_active: true,
    show_on_card: true,
  },
  {
    id: 4,
    entity: "patient",
    name: "Полис ДМС",
    type: "text",
    options: [],
    required: false,
    position: 0,
    is_active: true,
    show_on_card: false,
  },
];

// What patients complain about, per service
const complaints: Record<string, string[]> = {
  Имплантация: [
    "Нет двух зубов снизу, мешает жевать",
    "Выпал зуб, хочет имплант",
    "Шатается мост, хочет импланты",
  ],
  Хирургия: ["Режется зуб мудрости", "Болит десна у зуба мудрости"],
  Ортодонтия: ["Кривые зубы, хочет ровную улыбку", "Неправильный прикус"],
  Протезирование: ["Скол коронки", "Хочет белую улыбку к свадьбе"],
  Терапия: ["Ноет зуб по ночам", "Реагирует на холодное", "Выпала пломба"],
  Гигиена: ["Налёт и камень", "Кровоточат дёсны"],
  "Детская стоматология": ["У ребёнка болит зуб", "Профосмотр ребёнка"],
};

// «Откуда узнал» from the channel of the deal
const foundBySource: Record<string, string> = {
  instagram: "Инстаграм",
  "2gis": "2GIS",
  referral: "Рекомендация",
};

/**
 * Definitions and values: most deals have a complaint, many say how the
 * patient heard of the clinic, implant and surgery deals often have a CT
 * scan; some patients have a health insurance policy.
 */
export const generateCustomFields = (db: Db) => {
  db.custom_fields = DEMO_CUSTOM_FIELDS.map((field) => ({ ...field }));
  for (const deal of db.deals) {
    const values: Record<string, string | boolean> = {};
    const service = db.services.find((s) => s.id === deal.service_id)?.name;
    const source = db.lead_sources.find((s) => s.id === deal.source_id)?.code;
    const list = complaints[service ?? ""];
    if (list && random.number(9) < 7) values["1"] = random.arrayElement(list);
    const found =
      (source && foundBySource[source]) ??
      (random.number(9) < 4
        ? random.arrayElement(["Инстаграм", "2GIS", "Рекомендация", "Реклама"])
        : null);
    if (found) values["2"] = found;
    if (service === "Имплантация" || service === "Хирургия") {
      values["3"] = random.number(9) < 6;
    }
    deal.custom_values = values;
  }
  for (const patient of db.patients) {
    patient.custom_values =
      random.number(9) < 3
        ? { "4": `ДМС-${String(random.number(999999)).padStart(6, "0")}` }
        : {};
  }
};
