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
    stage(7, 1, "Лечение завершено", 6, "won", "#F6F4F1"),
    stage(8, 1, "Отказ", 7, "lost", "#6E6468"),
    stage(9, 2, "Консультация ортодонта", 0, "open", "#F8B4C6"),
    stage(10, 2, "Брекеты установлены", 1, "open", "#D96C8E"),
    stage(11, 2, "Лечение завершено", 2, "won", "#F6F4F1"),
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
  db.organization_settings = [
    {
      id: 1,
      organization_id: 1,
      manager_deal_visibility: "all",
      pipeline_move_mode: "first_stage",
      lead_distribution: "first_response",
      lead_distribution_sales_ids: [],
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
};
