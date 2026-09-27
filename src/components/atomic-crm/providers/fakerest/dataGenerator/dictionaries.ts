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
    stage(1, 1, "Новый лид", 0, "open", "#83A2DB"),
    stage(2, 1, "В работе", 1, "open", "#9DB5E4"),
    stage(3, 1, "Записан", 2, "open", "#FFCE87"),
    stage(4, 1, "Пришёл на консультацию", 3, "open", "#F7B98C"),
    stage(5, 1, "План согласован", 4, "open", "#C9B3D0"),
    stage(6, 1, "В лечении", 5, "open", "#A9C7E8"),
    stage(7, 1, "Лечение завершено", 6, "won", "#8CC9A7"),
    stage(8, 1, "Отказ", 7, "lost", "#FD8E8C"),
    stage(9, 2, "Консультация ортодонта", 0, "open", "#83A2DB"),
    stage(10, 2, "Брекеты установлены", 1, "open", "#C9B3D0"),
    stage(11, 2, "Лечение завершено", 2, "won", "#8CC9A7"),
    stage(12, 2, "Отказ", 3, "lost", "#FD8E8C"),
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
    },
  ];
};
