import { random } from "faker/locale/en_US";

/**
 * Realistic demo content for a dental clinic in Kazakhstan.
 */

const femaleFirstNames = [
  "Айгерим",
  "Асель",
  "Дана",
  "Жанар",
  "Гульнара",
  "Алия",
  "Мадина",
  "Сауле",
  "Динара",
  "Камила",
  "Анна",
  "Екатерина",
  "Ольга",
  "Наталья",
  "Аружан",
  "Томирис",
  "Жансая",
  "Айжан",
  "Индира",
  "Лаура",
  "Мария",
  "Юлия",
];

const maleFirstNames = [
  "Ержан",
  "Марат",
  "Асхат",
  "Нурлан",
  "Тимур",
  "Данияр",
  "Айдос",
  "Бекзат",
  "Руслан",
  "Санжар",
  "Алексей",
  "Дмитрий",
  "Сергей",
  "Олжас",
  "Арман",
  "Ерлан",
  "Бауыржан",
  "Максим",
  "Азамат",
  "Ильяс",
  "Канат",
  "Мирас",
];

// Kazakh surnames take -ова/-ева for women, Russian ones -ова/-ина
const surnameRoots = [
  "Ахметов",
  "Садыков",
  "Касымов",
  "Омаров",
  "Нурланов",
  "Жаксылыков",
  "Абенов",
  "Искаков",
  "Сейтказин",
  "Бекмуханов",
  "Исмаилов",
  "Тулегенов",
  "Кенжебаев",
  "Сарсенбаев",
  "Иванов",
  "Петров",
  "Смирнов",
  "Ким",
  "Пак",
  "Мухамеджанов",
  "Есенов",
  "Байжанов",
  "Каримов",
  "Утепов",
];

const feminine = (surname: string) =>
  /(ов|ев|ин)$/.test(surname) ? `${surname}а` : surname;

export const kzPerson = (gender?: string) => {
  const isFemale =
    gender === "female" || (gender !== "male" && random.boolean());
  const first_name = random.arrayElement(
    isFemale ? femaleFirstNames : maleFirstNames,
  );
  const root = random.arrayElement(surnameRoots);
  return {
    first_name,
    last_name: isFemale ? feminine(root) : root,
    gender: isFemale ? "female" : "male",
  };
};

const mobilePrefixes = [
  "701",
  "702",
  "705",
  "707",
  "708",
  "747",
  "771",
  "775",
  "777",
  "778",
];

export const kzPhone = () => {
  const digits = () => String(Math.floor(Math.random() * 10));
  const rest = Array.from({ length: 7 }, digits).join("");
  return `+7 ${random.arrayElement(mobilePrefixes)} ${rest.slice(0, 3)} ${rest.slice(3, 5)} ${rest.slice(5)}`;
};

const translit: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ы: "y",
  э: "e",
  ю: "yu",
  я: "ya",
  ь: "",
  ъ: "",
};

export const kzEmail = (first: string, last: string) => {
  const latin = (value: string) =>
    [...value.toLowerCase()].map((c) => translit[c] ?? c).join("");
  return `${latin(first)}.${latin(last)}@${random.arrayElement([
    "gmail.com",
    "mail.ru",
    "yandex.kz",
  ])}`;
};

/** Deal titles per service (category values of defaultDealCategories). */
export const dealTitles: Record<string, string[]> = {
  implantation: [
    "Имплантация 1 зуба",
    "Имплантация 2 зубов",
    "Имплант Osstem + коронка",
    "All-on-4 на верхнюю челюсть",
  ],
  orthodontics: [
    "Брекеты металлические",
    "Брекеты керамические",
    "Элайнеры",
    "Консультация ортодонта",
  ],
  therapy: [
    "Лечение кариеса",
    "Лечение каналов",
    "Реставрация передних зубов",
    "Лечение пульпита",
  ],
  hygiene: ["Профгигиена", "Профгигиена + отбеливание", "Чистка Air Flow"],
  prosthetics: [
    "Коронка из диоксида циркония",
    "Виниры E-max, 6 шт.",
    "Съёмный протез",
  ],
  surgery: ["Удаление зуба мудрости", "Синус-лифтинг", "Костная пластика"],
  other: ["Консультация", "Повторный осмотр", "Детский приём"],
};

/** Typical treatment plan amounts in tenge per service. */
export const dealAmounts: Record<string, [number, number]> = {
  implantation: [250_000, 1_800_000],
  orthodontics: [300_000, 1_200_000],
  therapy: [15_000, 120_000],
  hygiene: [15_000, 45_000],
  prosthetics: [80_000, 900_000],
  surgery: [25_000, 400_000],
  other: [5_000, 20_000],
};

export const roundedAmount = ([min, max]: [number, number]) =>
  Math.round((min + Math.random() * (max - min)) / 1000) * 1000;

export const taskTexts = [
  "Перезвонить и подтвердить запись",
  "Отправить план лечения в WhatsApp",
  "Напомнить о визите за день",
  "Уточнить удобное время консультации",
  "Отправить стоимость имплантации",
  "Спросить, как прошло лечение",
  "Пригласить на профгигиену",
  "Согласовать рассрочку",
];

export const noteTexts = [
  "Пациент нашёл нас через Instagram, интересуется стоимостью имплантации.",
  "Попросил перезвонить после 18:00, днём на работе.",
  "Боится боли, рассказали про седацию. Думает.",
  "Сравнивает цены с другой клиникой, предложили рассрочку 0-0-12.",
  "Записан на консультацию к хирургу, прислали адрес и ориентир.",
  "План лечения согласован, внесена предоплата.",
  "Не пришёл на приём, телефон не отвечает. Написали в WhatsApp.",
  "Рекомендовала подруга, лечилась у нас в прошлом году.",
];

export const clinicPartners = [
  "Страховая «Номад»",
  "Kaspi Страхование",
  "ТОО «АлматыЭнергоСбыт»",
  "Фитнес-клуб «Invictus»",
  "ТОО «Казахтелеком»",
  "Корпоративный клиент «Air Astana»",
  "Страховая «Евразия»",
  "БЦ «Нурлы Тау»",
];

const companyWords = [
  "Алтын",
  "Жибек Жолы",
  "Самал",
  "Нур",
  "Береке",
  "Сункар",
  "Шанырак",
  "Тенгри",
  "Алатау",
  "Акжол",
  "Даму",
  "Казына",
  "Байтерек",
  "Кулагер",
];
const companyForms = ["ТОО", "АО", "ИП"];

/** Partner and corporate client names: the known partners first, then generated ones. */
export const kzCompanyName = (id: number) => {
  if (id < clinicPartners.length) return clinicPartners[id];
  const word = companyWords[id % companyWords.length];
  const form =
    companyForms[Math.floor(id / companyWords.length) % companyForms.length];
  return `${form} «${word}${id >= companyWords.length * companyForms.length ? ` ${id}` : ""}»`;
};
