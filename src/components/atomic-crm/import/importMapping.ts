/**
 * Import of patients and deals from a spreadsheet (Excel / CSV, amoCRM
 * export): guessing what the columns are, reading the values, checking them
 * and turning rows into what public.import_batch expects. No React, no data
 * provider here: everything is unit tested (importMapping.test.ts).
 */
import type { Identifier } from "ra-core";

import { normalizePhone } from "../providers/commons/domain";

/** A cell as read from the file (xlsx cells keep numbers and dates) */
export type Cell = string | number | boolean | Date | null | undefined;

export const IMPORT_FIELDS = [
  "full_name",
  "last_name",
  "first_name",
  "middle_name",
  "phone",
  "email",
  "birth_date",
  "city",
  "deal_name",
  "pipeline",
  "stage",
  "source",
  "service",
  "responsible",
  "plan_amount",
  "paid_amount",
  "lost_reason",
  "tags",
  "comment",
  "created_at",
  "external_id",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Fields that only matter when deals are imported */
export const DEAL_FIELDS: ImportField[] = [
  "deal_name",
  "pipeline",
  "stage",
  "service",
  "plan_amount",
  "paid_amount",
  "lost_reason",
];

/** Several columns can hold these (work and mobile phones, two tag columns) */
const MULTI_FIELDS: ImportField[] = ["phone", "tags", "comment"];

export type ImportMode = "patients" | "deals";
export type ImportSystem = "excel" | "amocrm";

/** Column index → field (null: the column is not imported) */
export type ColumnMapping = Array<ImportField | null>;

const clean = (header: string) =>
  header
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_.:*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Checked in this order: the first match wins ("Дата создания" is a date,
// not a name; "Полное имя контакта" is a full name, not a first name)
const HEADER_RULES: Array<[ImportField, RegExp]> = [
  ["external_id", /^(id|ид|внешний id|external id|№ сделки|id сделки)$/],
  ["created_at", /(дата создания|создан[аы]?$|^created|date created)/],
  ["birth_date", /(дата рождения|день рождения|^др$|birth)/],
  [
    "deal_name",
    /(название сделки|^сделка$|^обращение$|deal name|^deal$|^title$)/,
  ],
  ["pipeline", /(воронка|pipeline)/],
  ["lost_reason", /(причина отказа|lost reason)/],
  ["stage", /(этап|стади|статус|stage|status)/],
  [
    "full_name",
    /(фио|полное имя|full name|^пациент$|^клиент$|^контакт$|^name$|имя контакта|основной контакт)/,
  ],
  ["last_name", /(фамилия|last name|surname)/],
  ["middle_name", /(отчество|middle name|patronymic)/],
  ["first_name", /(^имя$|first name|^имя пациента$)/],
  ["phone", /(телефон|phone|мобильный|^тел$|whatsapp|номер)/],
  ["email", /(e-?mail|почта)/],
  ["city", /(город|city)/],
  ["source", /(источник|source|канал|utm source)/],
  ["service", /(услуга|направление|service)/],
  [
    "responsible",
    /(ответственн|менеджер|responsible|manager|owner|администратор)/,
  ],
  ["paid_amount", /(оплачено|оплата|paid)/],
  [
    "plan_amount",
    /(бюджет|сумма|стоимость|цена|budget|amount|price|план лечения)/,
  ],
  ["tags", /(тег|tag)/],
  ["comment", /(комментари|примечани|заметк|comment|note|описание)/],
];

/** What a column header most likely is */
export const guessField = (header: string): ImportField | null => {
  const text = clean(header);
  if (!text) return null;
  return HEADER_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
};

/**
 * amoCRM exports deals with its own column names ("Название сделки", "Этап
 * сделки", "Воронка", "Полное имя контакта"...). Its "ID" is the deal id.
 */
export const isAmoCrmExport = (headers: string[]) => {
  const names = headers.map(clean);
  return (
    names.includes("название сделки") &&
    names.some((name) => ["этап сделки", "воронка", "статус"].includes(name))
  );
};

const AMO_COLUMNS: Record<string, ImportField> = {
  id: "external_id",
  "название сделки": "deal_name",
  бюджет: "plan_amount",
  ответственный: "responsible",
  "этап сделки": "stage",
  статус: "stage",
  воронка: "pipeline",
  "полное имя контакта": "full_name",
  "основной контакт": "full_name",
  "рабочий телефон (контакт)": "phone",
  "мобильный телефон (контакт)": "phone",
  "домашний телефон (контакт)": "phone",
  "другой телефон (контакт)": "phone",
  "рабочий email (контакт)": "email",
  "личный email (контакт)": "email",
  "теги сделки": "tags",
  "дата создания": "created_at",
  "дата создания сделки": "created_at",
  "источник сделки": "source",
  "причина отказа": "lost_reason",
  примечание: "comment",
};

/** Mapping of every column; amoCRM exports get their own preset */
export const guessMapping = (
  headers: string[],
): { mapping: ColumnMapping; system: ImportSystem } => {
  const system: ImportSystem = isAmoCrmExport(headers) ? "amocrm" : "excel";
  const used = new Set<ImportField>();
  const mapping = headers.map((header) => {
    const field =
      (system === "amocrm" ? AMO_COLUMNS[clean(header)] : undefined) ??
      (system === "amocrm" && /\(контакт\)$/.test(clean(header))
        ? // Other contact columns of amoCRM (position, company...) are skipped
          contactColumn(header)
        : guessField(header));
    if (!field) return null;
    if (used.has(field) && !MULTI_FIELDS.includes(field)) return null;
    used.add(field);
    return field;
  });
  return { mapping, system };
};

const contactColumn = (header: string): ImportField | null => {
  const field = guessField(header.replace(/\(контакт\)/i, ""));
  return field && ["phone", "email", "birth_date", "city"].includes(field)
    ? field
    : null;
};

/** The mode a file suggests: deals when it has any deal column */
export const guessMode = (mapping: ColumnMapping): ImportMode =>
  mapping.some(
    (field) =>
      field != null &&
      ["deal_name", "stage", "pipeline", "plan_amount", "paid_amount"].includes(
        field,
      ),
  )
    ? "deals"
    : "patients";

//
// Values
//

export const cellText = (cell: Cell): string => {
  if (cell == null) return "";
  if (cell instanceof Date) {
    return Number.isNaN(cell.getTime()) ? "" : cell.toISOString();
  }
  return String(cell).trim();
};

/** "Нурланова Асель Маратовна" → last, first, middle (Russian order) */
export const splitFullName = (fullName: string) => {
  const [last_name, first_name, ...rest] = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (last_name && !first_name) {
    // A single word is a first name ("Асель")
    return { first_name: last_name };
  }
  return {
    ...(last_name ? { last_name } : {}),
    ...(first_name ? { first_name } : {}),
    ...(rest.length ? { middle_name: rest.join(" ") } : {}),
  };
};

/** A valid number: +7 and 10 digits, or another country's 11–15 digits */
export const isValidPhone = (phone: string | null) =>
  !!phone &&
  (phone.startsWith("+7")
    ? /^\+7\d{10}$/.test(phone)
    : /^\+\d{11,15}$/.test(phone));

/** "8 701 111 22 33, +7 702 ..." → normalized numbers and the bad ones */
export const parsePhones = (cells: Cell[]) => {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const cell of cells) {
    for (const part of cellText(cell).split(/[,;/\n]+/)) {
      const raw = part.trim();
      if (!raw) continue;
      const phone = normalizePhone(raw);
      if (isValidPhone(phone)) {
        if (!phones.includes(phone!)) phones.push(phone!);
      } else {
        invalid.push(raw);
      }
    }
  }
  return { phones, invalid };
};

/** "450 000 ₸", "450000,50", 450000 → 450000; "" → null; "abc" → NaN */
export const parseAmount = (cell: Cell): number | null => {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : NaN;
  const text = cellText(cell)
    .replace(/[\s\u00a0]/g, "")
    .replace(/(₸|тг\.?|тенге|kzt|руб\.?|₽|\$)/gi, "");
  if (!text) return null;
  const normalized = /^\d+(,\d{1,2})$/.test(text)
    ? text.replace(",", ".")
    : text.replace(/,/g, "");
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : NaN;
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${year}-${pad(month)}-${pad(day)}`
    : null;
};

/**
 * A date of the file: "01.03.2026", "01.03.2026 10:15", "2026-03-01",
 * an xlsx date or an Excel serial number. Returns { date: "YYYY-MM-DD",
 * time: "HH:MM" | null }, null for an empty cell, undefined when unreadable.
 */
export const parseDateCell = (
  cell: Cell,
): { date: string; time: string | null } | null | undefined => {
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return undefined;
    const time =
      cell.getUTCHours() || cell.getUTCMinutes()
        ? `${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}`
        : null;
    return {
      date: `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`,
      time,
    };
  }
  if (typeof cell === "number") {
    // Excel serial date (days since 1899-12-30)
    if (cell < 1 || cell > 100000) return undefined;
    return parseDateCell(new Date(Math.round((cell - 25569) * 86400000)));
  }
  const text = cellText(cell);
  if (!text) return null;
  let match = text.match(
    /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2}))?/,
  );
  if (match) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
    const date = isoDate(year, Number(match[2]), Number(match[1]));
    if (!date) return undefined;
    return {
      date,
      time: match[4] ? `${pad(Number(match[4]))}:${match[5]}` : null,
    };
  }
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (match) {
    const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (!date) return undefined;
    return { date, time: match[4] ? `${match[4]}:${match[5]}` : null };
  }
  return undefined;
};

/** Clinics work in Asia/Almaty (+05:00): times of the file are local */
export const toTimestamp = (value: { date: string; time: string | null }) =>
  `${value.date}T${value.time ?? "12:00"}:00+05:00`;

export const splitList = (cells: Cell[]) => [
  ...new Set(
    cells
      .flatMap((cell) => cellText(cell).split(/[,;\n]+/))
      .map((part) => part.trim())
      .filter(Boolean),
  ),
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//
// Rows
//

export type RowError =
  | { code: "bad_phone"; value: string }
  | { code: "bad_date"; value: string }
  | { code: "bad_amount"; value: string }
  | { code: "bad_email"; value: string }
  | { code: "no_name_or_phone" }
  | { code: "unknown_stage"; value: string }
  | { code: "unknown_value"; kind: DictionaryKind; value: string };

export type ParsedRow = {
  /** Line of the file (the header is line 1) */
  line: number;
  cells: Cell[];
  first_name?: string;
  last_name?: string;
  middle_name?: string;
  phones: string[];
  email?: string;
  birth_date?: string;
  city?: string;
  deal_name?: string;
  pipeline?: string;
  stage?: string;
  source?: string;
  service?: string;
  responsible?: string;
  plan_amount?: number;
  paid_amount?: number;
  lost_reason?: string;
  tags: string[];
  comment?: string;
  created_at?: string;
  external_id?: string;
  errors: RowError[];
};

/** Reads one row with the mapping; errors are kept on the row */
export const parseRow = (
  cells: Cell[],
  mapping: ColumnMapping,
  line: number,
): ParsedRow => {
  const columns = (field: ImportField) =>
    mapping.flatMap((f, index) => (f === field ? [cells[index]] : []));
  const text = (field: ImportField) =>
    columns(field).map(cellText).filter(Boolean).join(" ").trim() || undefined;
  const row: ParsedRow = { line, cells, phones: [], tags: [], errors: [] };

  const fullName = text("full_name");
  if (fullName) Object.assign(row, splitFullName(fullName));
  row.last_name = text("last_name") ?? row.last_name;
  row.first_name = text("first_name") ?? row.first_name;
  row.middle_name = text("middle_name") ?? row.middle_name;

  const { phones, invalid } = parsePhones(columns("phone"));
  row.phones = phones;
  for (const value of invalid) row.errors.push({ code: "bad_phone", value });

  const email = text("email");
  if (email) {
    if (EMAIL.test(email)) row.email = email;
    else row.errors.push({ code: "bad_email", value: email });
  }

  for (const field of ["birth_date", "created_at"] as const) {
    const cell = columns(field).find((c) => cellText(c));
    if (cell === undefined) continue;
    const value = parseDateCell(cell);
    if (value === undefined) {
      row.errors.push({ code: "bad_date", value: cellText(cell) });
    } else if (value) {
      row[field] = field === "birth_date" ? value.date : toTimestamp(value);
    }
  }

  for (const field of ["plan_amount", "paid_amount"] as const) {
    const cell = columns(field).find((c) => cellText(c));
    if (cell === undefined) continue;
    const value = parseAmount(cell);
    if (value != null && Number.isNaN(value)) {
      row.errors.push({ code: "bad_amount", value: cellText(cell) });
    } else if (value != null) {
      row[field] = value;
    }
  }

  row.city = text("city");
  row.deal_name = text("deal_name");
  row.pipeline = text("pipeline");
  row.stage = text("stage");
  row.source = text("source");
  row.service = text("service");
  row.responsible = text("responsible");
  row.lost_reason = text("lost_reason");
  row.external_id = text("external_id");
  row.tags = splitList(columns("tags"));
  const comments = columns("comment").map(cellText).filter(Boolean);
  row.comment = comments.length ? comments.join("\n") : undefined;

  if (!row.phones.length && !row.first_name && !row.last_name) {
    row.errors.push({ code: "no_name_or_phone" });
  }
  return row;
};

/** Every non-empty data row of the sheet (rows[0] is the header) */
export const parseRows = (rows: Cell[][], mapping: ColumnMapping) =>
  rows
    .slice(1)
    .map((cells, index) => ({ cells, line: index + 2 }))
    .filter(({ cells }) => cells.some((cell) => cellText(cell)))
    .map(({ cells, line }) => parseRow(cells, mapping, line));

//
// Dictionaries: values of the file → rows of the clinic
//

export type DictionaryKind =
  | "stage"
  | "source"
  | "service"
  | "responsible"
  | "lost_reason";

export const CREATABLE_KINDS: DictionaryKind[] = [
  "stage",
  "source",
  "service",
  "lost_reason",
];

/** What a value of the file becomes: an existing row, a new one, or nothing */
export type Resolution = Identifier | "create" | null;
export type Resolutions = Record<DictionaryKind, Record<string, Resolution>>;

export type NamedItem = { id: Identifier; name: string };
export type StageItem = NamedItem & {
  pipeline_id: Identifier;
  kind: "open" | "won" | "lost";
  position: number;
};
export type SaleItem = {
  id: Identifier;
  first_name: string;
  last_name: string;
  email: string;
  disabled?: boolean;
};

export type ImportDictionaries = {
  pipelines: Array<NamedItem & { is_default?: boolean; position?: number }>;
  stages: StageItem[];
  sources: NamedItem[];
  services: NamedItem[];
  lostReasons: NamedItem[];
  sales: SaleItem[];
  tags: NamedItem[];
};

const same = (a: string, b: string) => clean(a) === clean(b);

export const defaultPipeline = (dictionaries: ImportDictionaries) =>
  dictionaries.pipelines.find((p) => p.is_default) ?? dictionaries.pipelines[0];

/** The pipeline named in the row, else the default one */
export const rowPipeline = (row: ParsedRow, dictionaries: ImportDictionaries) =>
  (row.pipeline &&
    dictionaries.pipelines.find((p) => same(p.name, row.pipeline!))) ||
  defaultPipeline(dictionaries);

/** Key of a stage value: the pipeline matters ("Воронка / Этап") */
export const stageKey = (row: ParsedRow) =>
  row.pipeline ? `${row.pipeline} / ${row.stage}` : row.stage!;

// amoCRM's closing stages exist in every amoCRM pipeline
const AMO_WON = ["успешно реализовано", "успешно", "закрыто и реализовано"];
const AMO_LOST = ["закрыто и не реализовано", "не реализовано", "отказ"];

/** The value of the file matched by name (stages: in the row's pipeline) */
export const autoResolve = (
  kind: DictionaryKind,
  value: string,
  dictionaries: ImportDictionaries,
  row?: ParsedRow,
): Identifier | undefined => {
  if (kind === "stage") {
    const pipeline = row
      ? rowPipeline(row, dictionaries)
      : defaultPipeline(dictionaries);
    const stages = dictionaries.stages
      .filter((s) => String(s.pipeline_id) === String(pipeline?.id))
      .sort((a, b) => a.position - b.position);
    const name = clean(row?.stage ?? value);
    const byName = stages.find((s) => clean(s.name) === name);
    if (byName) return byName.id;
    if (AMO_WON.includes(name)) return stages.find((s) => s.kind === "won")?.id;
    if (AMO_LOST.includes(name))
      return stages.find((s) => s.kind === "lost")?.id;
    return undefined;
  }
  if (kind === "responsible") {
    const text = clean(value);
    const sale = dictionaries.sales.find(
      (s) =>
        clean(s.email) === text ||
        clean(`${s.first_name} ${s.last_name}`) === text ||
        clean(`${s.last_name} ${s.first_name}`) === text,
    );
    return sale?.id;
  }
  const items = {
    source: dictionaries.sources,
    service: dictionaries.services,
    lost_reason: dictionaries.lostReasons,
  }[kind];
  return items.find((item) => same(item.name, value))?.id;
};

const rowValue = (row: ParsedRow, kind: DictionaryKind) =>
  kind === "stage"
    ? row.stage
      ? stageKey(row)
      : undefined
    : row[kind === "lost_reason" ? "lost_reason" : kind];

/** Distinct values of the file for each dictionary, with their first row */
export const collectValues = (rows: ParsedRow[], mode: ImportMode) => {
  const kinds: DictionaryKind[] =
    mode === "deals"
      ? ["stage", "source", "service", "responsible", "lost_reason"]
      : ["source", "responsible"];
  return Object.fromEntries(
    kinds.map((kind) => {
      const values = new Map<string, ParsedRow>();
      for (const row of rows) {
        const value = rowValue(row, kind);
        if (value && !values.has(value)) values.set(value, row);
      }
      return [kind, values];
    }),
  ) as Partial<Record<DictionaryKind, Map<string, ParsedRow>>>;
};

/** Resolutions guessed from the names; unknown values stay undecided */
export const initialResolutions = (
  rows: ParsedRow[],
  mode: ImportMode,
  dictionaries: ImportDictionaries,
): Resolutions => {
  const resolutions: Resolutions = {
    stage: {},
    source: {},
    service: {},
    responsible: {},
    lost_reason: {},
  };
  const values = collectValues(rows, mode);
  for (const [kind, map] of Object.entries(values) as Array<
    [DictionaryKind, Map<string, ParsedRow>]
  >) {
    for (const [value, row] of map) {
      const id = autoResolve(kind, value, dictionaries, row);
      if (id !== undefined) resolutions[kind][value] = id;
      // Unknown responsibles: unassigned unless the user picks someone
      else if (kind === "responsible") resolutions[kind][value] = null;
    }
  }
  return resolutions;
};

/** Values the user still has to decide (map, create or leave empty) */
export const unresolvedValues = (
  rows: ParsedRow[],
  mode: ImportMode,
  resolutions: Resolutions,
) => {
  const values = collectValues(rows, mode);
  return (
    Object.entries(values) as Array<[DictionaryKind, Map<string, ParsedRow>]>
  )
    .map(([kind, map]) => ({
      kind,
      values: [...map.keys()].filter(
        (value) => resolutions[kind][value] === undefined,
      ),
    }))
    .filter(({ values }) => values.length);
};

/** Values of the file that are not rows of the clinic (to review) */
export const unknownValues = (
  rows: ParsedRow[],
  mode: ImportMode,
  dictionaries: ImportDictionaries,
) => {
  const values = collectValues(rows, mode);
  return (
    Object.entries(values) as Array<[DictionaryKind, Map<string, ParsedRow>]>
  )
    .map(([kind, map]) => ({
      kind,
      values: [...map.entries()]
        .filter(
          ([value, row]) =>
            autoResolve(kind, value, dictionaries, row) === undefined,
        )
        .map(([value]) => value),
    }))
    .filter(({ values }) => values.length);
};

//
// Rows for import_batch
//

export type BatchRow = {
  index: number;
  system: ImportSystem;
  patient: {
    external_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    middle_name?: string | null;
    phones: string[];
    birth_date?: string | null;
    city?: string | null;
    source_id?: Identifier | null;
    sales_id?: Identifier | null;
    tags: Identifier[];
    background?: string | null;
    created_at?: string | null;
  };
  deal?: {
    external_id?: string | null;
    name: string;
    stage_id?: Identifier | null;
    source_id?: Identifier | null;
    service_id?: Identifier | null;
    plan_amount?: number | null;
    paid_amount?: number | null;
    sales_id?: Identifier | null;
    lost_reason_id?: Identifier | null;
    tags: Identifier[];
    description?: string | null;
    created_at?: string | null;
  };
};

const resolved = (
  resolutions: Resolutions,
  kind: DictionaryKind,
  value: string | undefined,
): Identifier | null => {
  if (!value) return null;
  const resolution = resolutions[kind][value];
  return resolution == null || resolution === "create" ? null : resolution;
};

/** Row errors, including the values left undecided */
export const rowErrors = (
  row: ParsedRow,
  mode: ImportMode,
  resolutions: Resolutions,
): RowError[] => {
  const errors = [...row.errors];
  const kinds: DictionaryKind[] =
    mode === "deals"
      ? ["stage", "source", "service", "responsible", "lost_reason"]
      : ["source", "responsible"];
  for (const kind of kinds) {
    const value = rowValue(row, kind);
    if (!value || resolutions[kind][value] !== undefined) continue;
    errors.push(
      kind === "stage"
        ? { code: "unknown_stage", value }
        : { code: "unknown_value", kind, value },
    );
  }
  return errors;
};

/**
 * Rows ready for import_batch (dictionary values already resolved to ids:
 * "create" must have been replaced by the new row's id) and the rows that
 * cannot be imported with their errors.
 */
export const buildBatchRows = ({
  rows,
  mode,
  system,
  resolutions,
  dictionaries,
  tagIds,
}: {
  rows: ParsedRow[];
  mode: ImportMode;
  system: ImportSystem;
  resolutions: Resolutions;
  dictionaries: ImportDictionaries;
  /** Tag name (lower case) → id */
  tagIds: Record<string, Identifier>;
}) => {
  const ready: BatchRow[] = [];
  const rejected: Array<{ row: ParsedRow; errors: RowError[] }> = [];
  for (const row of rows) {
    const errors = rowErrors(row, mode, resolutions);
    if (errors.length) {
      rejected.push({ row, errors });
      continue;
    }
    const tags = row.tags
      .map((tag) => tagIds[tag.toLowerCase()])
      .filter((id): id is Identifier => id != null);
    const salesId = resolved(resolutions, "responsible", row.responsible);
    const sourceId = resolved(resolutions, "source", row.source);
    const background =
      [
        row.email ? `Email: ${row.email}` : null,
        mode === "patients" ? row.comment : null,
      ]
        .filter(Boolean)
        .join("\n") || null;
    const batchRow: BatchRow = {
      index: row.line,
      system,
      patient: {
        // In a patients file the id column is the patient's id
        external_id: mode === "patients" ? (row.external_id ?? null) : null,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        middle_name: row.middle_name ?? null,
        phones: row.phones,
        birth_date: row.birth_date ?? null,
        city: row.city ?? null,
        source_id: sourceId,
        sales_id: salesId,
        tags: mode === "patients" ? tags : [],
        background,
        created_at: row.created_at ?? null,
      },
    };
    if (mode === "deals") {
      let stageId = row.stage
        ? resolved(resolutions, "stage", stageKey(row))
        : null;
      if (stageId == null && row.pipeline) {
        // A pipeline without a stage: its first stage
        const pipeline = rowPipeline(row, dictionaries);
        stageId =
          dictionaries.stages
            .filter((s) => String(s.pipeline_id) === String(pipeline?.id))
            .sort((a, b) => a.position - b.position)[0]?.id ?? null;
      }
      const serviceId = resolved(resolutions, "service", row.service);
      batchRow.deal = {
        external_id: row.external_id ?? null,
        name:
          row.deal_name ||
          (serviceId != null
            ? dictionaries.services.find(
                (s) => String(s.id) === String(serviceId),
              )?.name
            : undefined) ||
          row.service ||
          "Обращение",
        stage_id: stageId,
        source_id: sourceId,
        service_id: serviceId,
        plan_amount: row.plan_amount ?? null,
        paid_amount: row.paid_amount ?? null,
        sales_id: salesId,
        lost_reason_id: resolved(resolutions, "lost_reason", row.lost_reason),
        tags,
        description: row.comment ?? null,
        created_at: row.created_at ?? null,
      };
    }
    ready.push(batchRow);
  }
  return { ready, rejected };
};

export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

//
// Files the wizard offers to download
//

const csvCell = (value: string) =>
  /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** CSV with ";" (what Excel expects in Russian locales) and a BOM */
export const toCsv = (rows: string[][]) =>
  "\ufeff" +
  rows.map((row) => row.map(csvCell).join(";")).join("\r\n") +
  "\r\n";

/** The rows that were not imported, with an error column */
export const errorRowsCsv = (
  headers: string[],
  rows: Array<{ cells: Cell[]; message: string }>,
  errorHeader: string,
) =>
  toCsv([
    [...headers, errorHeader],
    ...rows.map(({ cells, message }) => [
      ...headers.map((_, index) => cellText(cells[index])),
      message,
    ]),
  ]);

export const SAMPLE_ROWS = [
  [
    "ФИО",
    "Телефон",
    "Email",
    "Дата рождения",
    "Источник",
    "Услуга",
    "Этап",
    "Ответственный",
    "Бюджет",
    "Оплачено",
    "Теги",
    "Комментарий",
    "Дата создания",
  ],
  [
    "Нурланова Асель Маратовна",
    "8 701 111 22 33",
    "asel@example.kz",
    "14.02.1990",
    "Instagram",
    "Имплантация",
    "Записан",
    "",
    "450000",
    "150000",
    "VIP",
    "Боится уколов",
    "01.03.2026",
  ],
  [
    "Ахметов Ерлан",
    "+7 (702) 222-33-44",
    "",
    "",
    "Сайт",
    "Ортодонтия",
    "Новый лид",
    "",
    "900 000",
    "",
    "",
    "Хочет брекеты",
    "05.03.2026",
  ],
  [
    "Садыкова Дана",
    "87473334455",
    "",
    "03.07.1985",
    "Рекомендация",
    "Гигиена",
    "Лечение завершено",
    "",
    "25000",
    "25000",
    "",
    "",
    "10.03.2026",
  ],
];

export const sampleCsv = () => toCsv(SAMPLE_ROWS);
