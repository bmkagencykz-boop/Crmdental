/**
 * The common ICD-10 (МКБ-10) codes of dentistry, «Болезни полости рта,
 * слюнных желёз и челюстей» K00–K14, plus the examination code Z01.2 — the
 * built-in list of the diagnosis field of a visit record. Any other code of
 * the format «A00» / «A00.0» can be typed in.
 */
export type IcdCode = { code: string; name: string };

export const DENTAL_ICD10: IcdCode[] = [
  { code: "K00.0", name: "Адентия" },
  { code: "K00.1", name: "Сверхкомплектные зубы" },
  { code: "K00.2", name: "Аномалии размеров и формы зубов" },
  { code: "K00.3", name: "Крапчатые зубы (флюороз)" },
  { code: "K00.4", name: "Нарушения формирования зубов (гипоплазия эмали)" },
  { code: "K00.6", name: "Нарушения прорезывания зубов" },
  { code: "K01.0", name: "Ретенированные зубы" },
  { code: "K01.1", name: "Импактные зубы" },
  { code: "K02.0", name: "Кариес эмали (стадия белого пятна)" },
  { code: "K02.1", name: "Кариес дентина" },
  { code: "K02.2", name: "Кариес цемента" },
  { code: "K02.3", name: "Приостановившийся кариес зубов" },
  { code: "K02.8", name: "Другой кариес зубов" },
  { code: "K02.9", name: "Кариес зубов неуточнённый" },
  { code: "K03.0", name: "Повышенное стирание зубов" },
  { code: "K03.1", name: "Сошлифовывание зубов" },
  { code: "K03.2", name: "Эрозия зубов" },
  { code: "K03.6", name: "Отложения на зубах (зубной камень, налёт)" },
  { code: "K03.8", name: "Другие болезни твёрдых тканей (гиперестезия)" },
  { code: "K04.0", name: "Пульпит" },
  { code: "K04.01", name: "Пульпит начальный (гиперемия пульпы)" },
  { code: "K04.02", name: "Пульпит острый" },
  { code: "K04.03", name: "Пульпит гнойный (пульпарный абсцесс)" },
  { code: "K04.04", name: "Пульпит хронический" },
  { code: "K04.05", name: "Пульпит хронический язвенный" },
  { code: "K04.06", name: "Пульпит хронический гиперпластический" },
  { code: "K04.1", name: "Некроз пульпы (гангрена)" },
  { code: "K04.2", name: "Дегенерация пульпы (дентикли, петрификаты)" },
  { code: "K04.3", name: "Неправильное формирование твёрдых тканей в пульпе" },
  {
    code: "K04.4",
    name: "Острый апикальный периодонтит пульпарного происхождения",
  },
  {
    code: "K04.5",
    name: "Хронический апикальный периодонтит (апикальная гранулёма)",
  },
  { code: "K04.6", name: "Периапикальный абсцесс со свищом" },
  { code: "K04.7", name: "Периапикальный абсцесс без свища" },
  { code: "K04.8", name: "Корневая киста" },
  { code: "K05.0", name: "Острый гингивит" },
  { code: "K05.1", name: "Хронический гингивит" },
  { code: "K05.2", name: "Острый пародонтит" },
  { code: "K05.3", name: "Хронический пародонтит" },
  { code: "K05.4", name: "Пародонтоз" },
  { code: "K05.5", name: "Другие болезни пародонта" },
  { code: "K06.0", name: "Рецессия десны" },
  { code: "K06.1", name: "Гипертрофия десны" },
  {
    code: "K06.2",
    name: "Поражения десны и беззубого альвеолярного края, связанные с травмой",
  },
  { code: "K07.2", name: "Аномалии соотношения зубных дуг (прикус)" },
  { code: "K07.3", name: "Аномалии положения зубов (скученность)" },
  { code: "K07.6", name: "Болезни височно-нижнечелюстного сустава" },
  { code: "K08.0", name: "Эксфолиация зубов вследствие системных нарушений" },
  {
    code: "K08.1",
    name: "Потеря зубов вследствие несчастного случая, удаления или болезни пародонта",
  },
  { code: "K08.2", name: "Атрофия беззубого альвеолярного края" },
  { code: "K08.3", name: "Оставшийся корень зуба" },
  { code: "K08.8", name: "Другие изменения зубов и их опорного аппарата" },
  {
    code: "K09.0",
    name: "Кисты, образовавшиеся в процессе формирования зубов",
  },
  { code: "K10.2", name: "Воспалительные заболевания челюстей (остеомиелит)" },
  { code: "K10.3", name: "Альвеолит челюсти" },
  { code: "K11.2", name: "Сиаладенит" },
  { code: "K12.0", name: "Рецидивирующие афты полости рта" },
  { code: "K12.1", name: "Другие формы стоматита" },
  { code: "K12.2", name: "Флегмона и абсцесс области рта" },
  { code: "K13.0", name: "Болезни губ (хейлит)" },
  { code: "K13.2", name: "Лейкоплакия" },
  { code: "K13.7", name: "Другие поражения слизистой оболочки полости рта" },
  { code: "K14.0", name: "Глоссит" },
  { code: "K14.1", name: "Географический язык" },
  { code: "Z01.2", name: "Стоматологическое обследование" },
];

export const ICD_CODE_PATTERN = /^[A-Z]\d{2}(\.\d{1,2})?$/;

/** «k02,1» → «K02.1»; null when it is not a code */
export const normalizeIcdCode = (value: string) => {
  const code = value.trim().toUpperCase().replace(",", ".");
  return ICD_CODE_PATTERN.test(code) ? code : null;
};

export const icdName = (code: string) =>
  DENTAL_ICD10.find((entry) => entry.code === code)?.name;

/** «K02.1 Кариес дентина» */
export const icdLabel = (code: string) => {
  const name = icdName(code);
  return name ? `${code} ${name}` : code;
};

/**
 * Codes matching a search: by the code («k04», «K04.5») or by words of the
 * name («пульп», «кист корн»), codes first; at most `limit`.
 */
export const searchIcd = (query: string, limit = 12): IcdCode[] => {
  const q = query.trim().toLowerCase().replace(",", ".");
  if (!q) return DENTAL_ICD10.slice(0, limit);
  const words = q.split(/\s+/);
  const byCode = DENTAL_ICD10.filter((entry) =>
    entry.code.toLowerCase().startsWith(q),
  );
  const byName = DENTAL_ICD10.filter(
    (entry) =>
      !byCode.includes(entry) &&
      words.every((word) => entry.name.toLowerCase().includes(word)),
  );
  return [...byCode, ...byName].slice(0, limit);
};
