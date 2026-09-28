import { createElement, type ComponentType } from "react";
import { useDataProvider, type Identifier } from "ra-core";

import { ImportWizard } from "../import/ImportWizard";
import { LeadSettings } from "../leads/LeadSettings";
import { ApiSettings } from "../pipeline-automation/ApiSettings";
import type { CrmDataProvider } from "../providers/types";
import { MessengerSettings } from "../settings/MessengerSettings";
import { MisSettings } from "../settings/MisSettings";
import { TelegramBotSettings } from "../settings/TelegramBotSettings";
import { TelephonySettings } from "../telephony/TelephonySettings";
import type { CatalogItem } from "./catalogModel";
import { MisComingSettings } from "./MisComingSettings";
import {
  useApiConnected,
  useLeadsConnected,
  useMessengerConnected,
  useMisConnected,
  useNeverConnected,
  useTelegramBotConnected,
  useTelephonyConnected,
} from "./useConnected";

/**
 * «Маркет интеграций» (stage 25): every integration the clinic can connect.
 * Adding one = one entry of CATALOG + its settings component. The developer
 * apps of the clinic are added at runtime (DeveloperApps.tsx).
 */

export type CatalogSettingsProps = { entry: CatalogEntry };

export type CatalogEntry = CatalogItem & {
  /** Rendered in the «Подключение» section of the detail view */
  settings: ComponentType<CatalogSettingsProps>;
  /** Connected state (undefined while loading) */
  useConnected: () => boolean | undefined;
  /** The «Отключить» action of the detail view, when there is one */
  useDisconnect: () => (() => Promise<unknown>) | undefined;
  /** Developer app of the entry (kind "app") */
  appId?: Identifier;
};

const useNoDisconnect = () => undefined;

const useMessengerDisconnect = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return () => dataProvider.disconnectMessenger();
};
const useTelegramBotDisconnect = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return () => dataProvider.disconnectTelegramBot();
};
const useTelephonyDisconnect = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return () => dataProvider.disconnectTelephony();
};

/** A telephony provider: the settings screen of stage 12 */
const telephony = (
  id: string,
  name: string,
  vendor: string,
  text: string,
  summary: string,
  extra: Partial<CatalogEntry> = {},
): CatalogEntry => ({
  id,
  name,
  vendor,
  category: "telephony",
  summary,
  description: `Звонки ${name} попадают в карточку пациента и ленту сделки: входящий с нового номера создаёт заявку, пропущенный — задачу перезвонить, запись разговора слушается прямо в CRM. В настройках выберите АТС, вставьте адрес вебхука в личный кабинет и укажите внутренние номера сотрудников.`,
  features: [
    "Входящие, исходящие и пропущенные в ленте сделки",
    "Новая заявка из звонка с незнакомого номера",
    "Задача перезвонить по пропущенному",
    "Записи разговоров и отчёт по звонкам",
  ],
  logo: { text, tone: "outline" },
  status: "available",
  kind: "builtin",
  settings: TelephonySettings,
  useConnected: () => useTelephonyConnected(id),
  useDisconnect: () => {
    const connected = useTelephonyConnected(id);
    const disconnect = useTelephonyDisconnect();
    return connected ? disconnect : undefined;
  },
  ...extra,
});

/**
 * TODO(stage 27, MIS connectors): replace the settings of the Dentist Plus
 * and MacDent entries (and their status "coming") with the real connectors.
 */
const DentistPlusSettings = () =>
  createElement(MisComingSettings, {
    kind: "dentist_plus",
    name: "Dentist Plus",
  });
const MacDentSettings = () =>
  createElement(MisComingSettings, { kind: "macdent", name: "MacDent" });

/** Wazzup24 alone: the Telegram bot has its own entry */
const WazzupSettings = () =>
  createElement(MessengerSettings, { withTelegramBot: false });
const TelegramSettings = () => createElement(TelegramBotSettings);

const MIS_FEATURES = [
  "Пациенты и визиты из МИС в карточке сделки",
  "Оплаты из МИС — в выручке сделки и отчётах",
  "Сделка переходит на этап после визита",
];

/** A MIS planned since stage 11 (MisSettings: request a connector) */
const plannedMis = (
  id: "ident" | "dentalpro" | "medelement" | "1c_medicine",
  name: string,
  text: string,
): CatalogEntry => ({
  id,
  name,
  vendor: name,
  category: "mis",
  summary: "Пациенты, визиты и оплаты из медицинской системы клиники",
  description: `Коннектор к ${name} синхронизирует пациентов, записи на приём и оплаты: сделка сама переходит на этап «Пришёл на приём», выручка попадает в отчёты. Коннектор в разработке — оставьте заявку, чтобы подключить одними из первых.`,
  features: MIS_FEATURES,
  logo: { text, tone: "neutral" },
  status: "coming",
  kind: "builtin",
  settings: MisSettings,
  useConnected: () => useMisConnected(id),
  useDisconnect: useNoDisconnect,
});

export const CATALOG: CatalogEntry[] = [
  // Мессенджеры
  {
    id: "wazzup",
    name: "Wazzup24",
    vendor: "Wazzup",
    category: "messengers",
    summary: "WhatsApp и Instagram клиники в карточке сделки",
    description:
      "Переписка с пациентами в WhatsApp и Instagram прямо в CRM: входящее сообщение с нового номера создаёт заявку, ответы сотрудников и автосообщения уходят из карточки сделки. Подключается API-ключом из личного кабинета Wazzup24.",
    features: [
      "WhatsApp и Instagram в ленте сделки",
      "Заявка из первого сообщения",
      "Автосообщения, рассылки и быстрые ответы",
      "Контроль скорости ответа",
    ],
    logo: { text: "WZ", tone: "primary" },
    status: "available",
    kind: "builtin",
    keywords: ["whatsapp", "instagram", "вотсап", "ватсап", "инстаграм"],
    settings: WazzupSettings,
    useConnected: useMessengerConnected,
    useDisconnect: () => {
      const connected = useMessengerConnected();
      const disconnect = useMessengerDisconnect();
      return connected ? disconnect : undefined;
    },
  },
  {
    id: "telegram_bot",
    name: "Telegram-бот клиники",
    vendor: "Telegram",
    category: "messengers",
    summary: "Свой бот клиники: пациенты пишут в Telegram, ответы из CRM",
    description:
      "Бот клиники, созданный в @BotFather: сообщения пациентов приходят в сделку, сотрудники отвечают из CRM, автосообщения и напоминания о визите уходят в Telegram. Подключается токеном бота.",
    features: [
      "Переписка в Telegram в ленте сделки",
      "Заявка из первого сообщения боту",
      "Напоминания о визите и автосообщения",
    ],
    logo: { text: "TG", tone: "rose" },
    status: "available",
    kind: "builtin",
    keywords: ["telegram", "телеграм", "bot", "бот"],
    settings: TelegramSettings,
    useConnected: useTelegramBotConnected,
    useDisconnect: () => {
      const connected = useTelegramBotConnected();
      const disconnect = useTelegramBotDisconnect();
      return connected ? disconnect : undefined;
    },
  },

  // Телефония
  telephony(
    "binotel",
    "Binotel",
    "Binotel",
    "BN",
    "Облачная АТС Binotel: звонки и записи в карточке пациента",
  ),
  telephony(
    "zadarma",
    "Zadarma",
    "Zadarma",
    "ZD",
    "Виртуальная АТС Zadarma: звонки, записи, пропущенные",
  ),
  telephony(
    "mango",
    "Mango Office",
    "Mango Office",
    "MG",
    "Mango Office: звонки и записи разговоров в CRM",
    { keywords: ["манго"] },
  ),
  telephony(
    "sipuni",
    "Sipuni",
    "Sipuni",
    "SP",
    "Sipuni: звонки, записи и пропущенные в ленте сделки",
    { keywords: ["сипуни"] },
  ),
  telephony(
    "generic",
    "Другая АТС",
    "Любая АТС с вебхуками",
    "АТС",
    "Любая АТС, которая умеет отправлять события звонков",
    { keywords: ["asterisk", "freepbx", "sip"] },
  ),

  // МИС
  {
    id: "dentist_plus",
    name: "Dentist Plus",
    vendor: "Dentist Plus",
    category: "mis",
    summary: "Пациенты, записи и оплаты из Dentist Plus",
    description:
      "Коннектор к Dentist Plus синхронизирует пациентов, записи на приём и оплаты: сделка сама переходит на этап «Пришёл на приём», выручка попадает в отчёты. Коннектор в разработке — оставьте заявку.",
    features: MIS_FEATURES,
    logo: { text: "D+", tone: "ink" },
    status: "coming",
    kind: "builtin",
    keywords: ["дентист плюс", "dentistplus"],
    settings: DentistPlusSettings,
    useConnected: () => useMisConnected("dentist_plus"),
    useDisconnect: useNoDisconnect,
  },
  {
    id: "macdent",
    name: "MacDent",
    vendor: "MacDent",
    category: "mis",
    summary: "Пациенты, записи и оплаты из MacDent",
    description:
      "Коннектор к MacDent синхронизирует пациентов, записи на приём и оплаты: сделка сама переходит на этап «Пришёл на приём», выручка попадает в отчёты. Коннектор в разработке — оставьте заявку.",
    features: MIS_FEATURES,
    logo: { text: "MD", tone: "ink" },
    status: "coming",
    kind: "builtin",
    keywords: ["макдент"],
    settings: MacDentSettings,
    useConnected: () => useMisConnected("macdent"),
    useDisconnect: useNoDisconnect,
  },
  plannedMis("ident", "IDENT", "ID"),
  plannedMis("dentalpro", "Dentalpro", "DP"),
  plannedMis("medelement", "MedElement", "ME"),
  plannedMis("1c_medicine", "1С:Медицина", "1С"),

  // Сайт и заявки
  {
    id: "website",
    name: "Сайт и Tilda",
    vendor: "Tilda, WordPress, любой сайт",
    category: "leads",
    summary: "Заявки с форм сайта сразу становятся сделками",
    description:
      "Адрес вебхука клиники принимает заявки с любого сайта: Tilda, WordPress, конструкторы лендингов. Заявка создаёт сделку с источником и UTM-метками, ответственный назначается по правилам распределения.",
    features: [
      "Сделка из каждой заявки с формы",
      "Источник и UTM-метки в сделке",
      "Распределение заявок между сотрудниками",
    ],
    logo: { text: "Ti", tone: "blush" },
    status: "available",
    kind: "builtin",
    keywords: ["tilda", "тильда", "wordpress", "форма", "лендинг", "webhook"],
    settings: LeadSettings,
    useConnected: useLeadsConnected,
    useDisconnect: useNoDisconnect,
  },
  {
    id: "2gis",
    name: "2GIS",
    vendor: "2GIS",
    category: "leads",
    summary: "Заявки и звонки из карточки клиники в 2GIS",
    description:
      "Заявки из карточки клиники в 2GIS приходят на тот же вебхук, что и формы сайта, с источником «2GIS»: так видно, сколько пациентов и выручки приносит справочник.",
    features: ["Сделка из заявки в 2GIS", "Источник «2GIS» в отчётах"],
    logo: { text: "2Г", tone: "blush" },
    status: "beta",
    kind: "builtin",
    keywords: ["2гис", "дубльгис", "2gis"],
    settings: LeadSettings,
    useConnected: useNeverConnected,
    useDisconnect: useNoDisconnect,
  },

  // API и вебхуки
  {
    id: "api",
    name: "REST API и вебхуки",
    vendor: "DentalCRM",
    category: "api",
    summary: "Ключи API и исходящие вебхуки для своих интеграций",
    description:
      "Публичный REST API клиники: сделки, пациенты, воронки, этапы, цифровая воронка, поля, задачи и сообщения. Исходящие вебхуки сообщают о новых сделках, переходах по этапам, оплатах и сообщениях — с подписью HMAC.",
    features: [
      "Ключи с тонкими доступами (scopes)",
      "Вебхуки с подписью и повторами",
      "Документация с примерами curl",
    ],
    logo: { text: "API", tone: "neutral" },
    status: "available",
    kind: "builtin",
    keywords: ["rest", "webhook", "вебхук", "ключ", "token"],
    settings: ApiSettings,
    useConnected: useApiConnected,
    useDisconnect: useNoDisconnect,
  },

  // Импорт
  {
    id: "excel",
    name: "Excel и CSV",
    vendor: "Microsoft Excel, Google Таблицы",
    category: "import",
    summary: "Перенос пациентов и сделок из таблицы",
    description:
      "Загрузите выгрузку пациентов или сделок из Excel, Google Таблиц или другой системы: мастер сопоставит колонки, найдёт дубли по телефону и покажет результат. Повторная загрузка того же файла ничего не удвоит.",
    features: [
      "Сопоставление колонок",
      "Дубли по телефону",
      "Повторный импорт без удвоения",
    ],
    logo: { text: "XLS", tone: "outline" },
    status: "available",
    kind: "builtin",
    keywords: ["xlsx", "csv", "таблица", "google"],
    resource: "import",
    settings: ImportWizard,
    useConnected: useNeverConnected,
    useDisconnect: useNoDisconnect,
  },
  {
    id: "amocrm",
    name: "Перенос из amoCRM",
    vendor: "amoCRM",
    category: "import",
    summary: "Сделки, пациенты и этапы из выгрузки amoCRM",
    description:
      "Выгрузите сделки из amoCRM в Excel и загрузите файл: мастер узнает колонки amoCRM, перенесёт пациентов, сделки, ответственных и этапы воронки.",
    features: [
      "Колонки amoCRM распознаются сами",
      "Этапы и ответственные переносятся",
    ],
    logo: { text: "amo", tone: "outline" },
    status: "available",
    kind: "builtin",
    keywords: ["amo", "амо", "амоцрм"],
    resource: "import",
    settings: ImportWizard,
    useConnected: useNeverConnected,
    useDisconnect: useNoDisconnect,
  },
];
