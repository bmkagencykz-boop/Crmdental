import { DEFAULT_RESPONSE_SETTINGS } from "../../commons/responseTime";
import { DEFAULT_TIME_ZONE } from "../../commons/automessages";
import { DEMO_CLINIC_NAME } from "./automessages";
import type { Db } from "./types";

/**
 * Same template as private.seed_organization() in the database.
 */
export const generateDictionaries = (db: Db) => {
  db.pipelines = [
    { id: 1, name: "Основная", position: 0, is_default: true },
    { id: 2, name: "Ортодонтия", position: 1, is_default: false },
  ];
  const stage = (
    id: number,
    pipeline_id: number,
    name: string,
    position: number,
    kind: "open" | "won" | "lost",
    color: string,
  ) => ({ id, pipeline_id, name, position, kind, color });
  db.stages = [
    stage(1, 1, "Новый лид", 0, "open", "#F8B4C6"),
    stage(2, 1, "В работе", 1, "open", "#F47C9C"),
    stage(3, 1, "Записан", 2, "open", "#E8A87C"),
    stage(4, 1, "Пришёл на консультацию", 3, "open", "#C58FA6"),
    stage(5, 1, "План согласован", 4, "open", "#D96C8E"),
    stage(6, 1, "В лечении", 5, "open", "#EF3B6E"),
    stage(7, 1, "Лечение завершено", 6, "won", "#CDBFC5"),
    stage(8, 1, "Отказ", 7, "lost", "#6E6468"),
    stage(9, 2, "Консультация ортодонта", 0, "open", "#F8B4C6"),
    stage(10, 2, "Брекеты установлены", 1, "open", "#D96C8E"),
    stage(11, 2, "Лечение завершено", 2, "won", "#CDBFC5"),
    stage(12, 2, "Отказ", 3, "lost", "#6E6468"),
  ];
  db.services = [
    "Имплантация",
    "Ортодонтия",
    "Терапия",
    "Гигиена",
    "Протезирование",
    "Хирургия",
    "Детская стоматология",
    "Другое",
  ].map((name, index) => ({
    id: index + 1,
    name,
    position: index,
    is_archived: false,
  }));
  db.lead_sources = [
    ["WhatsApp", "whatsapp"],
    ["Instagram", "instagram"],
    ["Telegram", "telegram"],
    ["Звонок", "call"],
    ["Сайт", "website"],
    ["2GIS", "2gis"],
    ["Рекомендация", "referral"],
    ["Другое", "other"],
  ].map(([name, code], index) => ({
    id: index + 1,
    name,
    code,
    is_system: true,
    position: index,
    is_archived: false,
  }));
  db.lost_reasons = [
    "Дорого",
    "Выбрал другую клинику",
    "Не дозвонились",
    "Передумал",
    "Далеко или неудобно",
    "Страх лечения",
    "Нет времени",
    "Другое",
  ].map((name, index) => ({
    id: index + 1,
    name,
    position: index,
    is_archived: false,
  }));
  db.organizations = [
    { id: 1, name: DEMO_CLINIC_NAME, timezone: DEFAULT_TIME_ZONE },
  ];
  db.organization_settings = [
    {
      id: 1,
      organization_id: 1,
      manager_deal_visibility: "all",
      pipeline_move_mode: "first_stage",
      lead_distribution: "first_response",
      lead_distribution_sales_ids: [],
      ...DEFAULT_RESPONSE_SETTINGS,
      // Round the clock, so that the demo always shows deals waiting
      response_hours_start: 0,
      response_hours_end: 24,
    },
  ];
  // Same defaults as private.seed_organization, plus a checklist example
  db.task_rules = [
    {
      id: 1,
      event: "deal_created",
      stage_id: null,
      type: "call",
      text: "Связаться с пациентом по новому обращению",
      due_in_minutes: 15,
      is_active: true,
      position: 0,
    },
    {
      id: 2,
      event: "stage_entered",
      stage_id: 4,
      type: "message",
      text: "Отправить план лечения и стоимость",
      due_in_minutes: 24 * 60,
      is_active: true,
      position: 1,
    },
  ];
  db.stage_checklist_items = [
    { id: 1, stage_id: 4, text: "Сделать снимок (КТ или ОПТГ)", position: 0 },
    { id: 2, stage_id: 4, text: "Составить план лечения", position: 1 },
    { id: 3, stage_id: 4, text: "Озвучить стоимость и рассрочку", position: 2 },
  ];
  db.deal_checklist_checks = [];
  // Same defaults as private.seed_quick_replies, plus a personal reply of
  // the owner (the demo user)
  db.quick_replies = [
    {
      id: 1,
      title: "Приветствие",
      shortcut: "привет",
      text: "Здравствуйте, {имя}! Меня зовут {сотрудник}, клиника {клиника}. Чем могу помочь?",
      sales_id: null,
      position: 0,
    },
    {
      id: 2,
      title: "Адрес и парковка",
      shortcut: "адрес",
      text: "Наш адрес: [укажите адрес клиники]. Рядом есть бесплатная парковка [уточните, где именно]. Ждём вас!",
      sales_id: null,
      position: 1,
    },
    {
      id: 3,
      title: "Стоимость консультации",
      shortcut: "цена",
      text: "{имя}, консультация врача стоит [укажите цену] ₸. На ней врач проведёт осмотр и составит план лечения.",
      sales_id: null,
      position: 2,
    },
    {
      id: 4,
      title: "Запись на консультацию",
      shortcut: "запись",
      text: "{имя}, записали вас на консультацию {дата_визита}. Если планы изменятся, пожалуйста, напишите нам заранее.",
      sales_id: null,
      position: 3,
    },
    {
      id: 5,
      title: "Спасибо, ждём вас",
      shortcut: "спасибо",
      text: "Спасибо, {имя}! Ждём вас в клинике {клиника}. Хорошего дня!",
      sales_id: null,
      position: 4,
    },
    {
      id: 6,
      title: "Рассрочка",
      shortcut: "рассрочка",
      text: "{имя}, услугу «{услуга}» можно оплатить в рассрочку без переплаты. Расскажу подробнее на консультации.",
      sales_id: 0,
      position: 0,
    },
  ];
};
