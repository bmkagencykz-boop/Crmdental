import type { ConfigurationContextValue } from "./ConfigurationContext";
// Import the logos as module assets so Vite resolves their URL relative to the
// JS chunk (import.meta.url), not the current route. A plain "./logos/..." path
// breaks on nested routes like /oauth/consent and under a deployment sub-path.
import darkModeLogo from "./logos/logo_atomic_crm_dark.svg";
import lightModeLogo from "./logos/logo_atomic_crm_light.svg";

export const defaultDarkModeLogo = darkModeLogo;
export const defaultLightModeLogo = lightModeLogo;

export const defaultCurrency = "KZT";

export const defaultTitle = "Dental CRM";

export const defaultCompanySectors = [
  { value: "insurance", label: "Страховая компания" },
  { value: "corporate", label: "Корпоративный клиент" },
  { value: "partner", label: "Партнёр" },
  { value: "other", label: "Другое" },
];

// Temporary: pipelines and stages move to database tables in stage 2
export const defaultDealStages = [
  { value: "new-lead", label: "Новый лид" },
  { value: "in-progress", label: "В работе" },
  { value: "booked", label: "Записан" },
  { value: "consultation", label: "Пришёл на консультацию" },
  { value: "plan-agreed", label: "План согласован" },
  { value: "in-treatment", label: "В лечении" },
  { value: "won", label: "Лечение завершено" },
  { value: "lost", label: "Отказ" },
];

export const defaultDealPipelineStatuses = ["won"];

export const defaultDealCategories = [
  { value: "implantation", label: "Имплантация" },
  { value: "orthodontics", label: "Ортодонтия" },
  { value: "therapy", label: "Терапия" },
  { value: "hygiene", label: "Гигиена" },
  { value: "prosthetics", label: "Протезирование" },
  { value: "surgery", label: "Хирургия" },
  { value: "other", label: "Другое" },
];

export const defaultNoteStatuses = [
  { value: "cold", label: "Холодный", color: "#7dbde8" },
  { value: "warm", label: "Тёплый", color: "#e8cb7d" },
  { value: "hot", label: "Горячий", color: "#e88b7d" },
  { value: "in-treatment", label: "На лечении", color: "#a4e87d" },
];

export const defaultTaskTypes = [
  { value: "call", label: "Звонок" },
  { value: "message", label: "Написать" },
  { value: "reminder", label: "Напомнить" },
  { value: "other", label: "Другое" },
];

export const defaultConfiguration: ConfigurationContextValue = {
  companySectors: defaultCompanySectors,
  currency: defaultCurrency,
  dealCategories: defaultDealCategories,
  dealPipelineStatuses: defaultDealPipelineStatuses,
  dealStages: defaultDealStages,
  noteStatuses: defaultNoteStatuses,
  taskTypes: defaultTaskTypes,
  title: defaultTitle,
  darkModeLogo: defaultDarkModeLogo,
  lightModeLogo: defaultLightModeLogo,
};
