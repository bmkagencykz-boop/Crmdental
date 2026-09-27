import type { Identifier } from "ra-core";

import { formatVisitDate } from "../providers/commons/automessages";
import { normalizePhone } from "../providers/commons/domain";
import type {
  CustomField,
  CustomFieldEntity,
  CustomFieldType,
  CustomValue,
  CustomValues,
  Stage,
} from "../types";

/**
 * Custom fields (stage 19): «Дополнительные поля» of deals and patients.
 * The same rules as the database (supabase/schemas/19_custom_fields.sql):
 * normalizeCustomValue ↔ private.custom_value, sanitizeCustomValues and the
 * required checks ↔ private.handle_custom_values, customFieldText ↔
 * private.custom_field_text, customValuesDiff ↔ private.custom_values_diff.
 * No React here: everything is unit tested (customFields.test.ts).
 */

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  "text",
  "textarea",
  "number",
  "money",
  "date",
  "datetime",
  "checkbox",
  "select",
  "multiselect",
  "phone",
  "url",
];

/** Types with a list of options */
export const LIST_TYPES: CustomFieldType[] = ["select", "multiselect"];
/** Types the lists can filter on (jsonb containment) */
export const FILTERABLE_TYPES: CustomFieldType[] = [
  "select",
  "multiselect",
  "checkbox",
];
/** The kanban card shows two fields at most */
export const MAX_CARD_FIELDS = 2;
/** List filter: custom_values @> '{"<id>": value}' (ra-data-postgrest) */
export const CUSTOM_VALUES_FILTER = "custom_values@cs";
/** Prefix of the custom fields in the deal log and the audit log */
export const CHANGE_PREFIX = "cf:";
/** Template variable of a field: {поле:Название} */
export const TEMPLATE_PREFIX = "поле:";

/** A value refused by the rules; the message is the database's */
export class CustomFieldError extends Error {
  constructor(
    message: string,
    public code: "custom_field_invalid" | "custom_field_required",
    public fieldId?: Identifier,
  ) {
    super(message);
  }
}

const EXPECTED: Record<CustomFieldType, string> = {
  text: "текст до 1000 символов",
  textarea: "текст до 10 000 символов",
  number: "число",
  money: "сумма в тенге",
  date: "дата",
  datetime: "дата и время",
  checkbox: "да или нет",
  select: "значение из списка",
  multiselect: "значения из списка",
  phone: "номер телефона",
  url: "ссылка",
};

const invalid = (field: Pick<CustomField, "id" | "name" | "type">) =>
  new CustomFieldError(
    `Поле «${field.name}»: ожидается ${EXPECTED[field.type] ?? "другое значение"}`,
    "custom_field_invalid",
    field.id,
  );

export const requiredMessage = (name: string) => `Заполните поле «${name}»`;

/** PostgreSQL's btrim(): spaces only */
const btrim = (text: string) => text.replace(/^ +| +$/g, "");
/** Characters, not UTF-16 units (PostgreSQL's length()) */
const length = (text: string) => [...text].length;

const findOption = (options: string[], raw: string) => {
  const wanted = raw.toLowerCase();
  return options.find((option) => btrim(option).toLowerCase() === wanted);
};

const TRUE_WORDS = ["true", "1", "да", "yes", "+"];
const FALSE_WORDS = ["false", "0", "нет", "no", "-"];
const DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;

const isRealDate = (text: string) => {
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/** "2026-03-01 10:00+05" → a Date (what PostgreSQL reads) */
const parseMoment = (text: string) => {
  const iso = text
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * A value checked and normalized for its field (null: empty). Throws a
 * CustomFieldError «Поле «…»: ожидается …». Same as private.custom_value.
 */
export const normalizeCustomValue = (
  field: Pick<CustomField, "id" | "name" | "type" | "options">,
  value: unknown,
): CustomValue | null => {
  if (value == null) return null;

  if (field.type === "checkbox") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string" || typeof value === "number") {
      const raw = btrim(String(value)).toLowerCase();
      if (raw === "") return null;
      if (TRUE_WORDS.includes(raw)) return true;
      if (FALSE_WORDS.includes(raw)) return false;
    }
    throw invalid(field);
  }

  if (field.type === "multiselect") {
    const items = typeof value === "string" ? [value] : value;
    if (!Array.isArray(items)) throw invalid(field);
    const chosen: string[] = [];
    for (const item of items) {
      if (typeof item !== "string") throw invalid(field);
      const raw = btrim(item);
      if (raw === "") continue;
      const option = findOption(field.options ?? [], raw);
      if (option == null) throw invalid(field);
      chosen.push(option);
    }
    if (!chosen.length) return null;
    // In the order of the list, each option once
    return (field.options ?? []).filter((option) => chosen.includes(option));
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw invalid(field);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw invalid(field);
  }
  let raw = btrim(String(value));
  if (raw === "") return null;

  switch (field.type) {
    case "text":
      if (length(raw) <= 1000) return raw;
      break;
    case "textarea":
      if (length(raw) <= 10000) return raw;
      break;
    case "number":
    case "money": {
      if (typeof value === "string") {
        raw = raw.replace(/[\s\u00a0₸]|тг\.?|тенге/gi, "").replace(/,/g, ".");
      }
      if (/^-?\d{1,15}(\.\d{1,6})?$/.test(raw)) {
        const amount = Number(raw);
        if (field.type === "number") return amount;
        if (amount >= 0) return Math.round(amount) || 0;
      }
      break;
    }
    case "date":
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && isRealDate(raw)) return raw;
      break;
    case "datetime":
      if (DATETIME.test(raw)) {
        const moment = parseMoment(raw);
        if (moment) return moment.toISOString();
      }
      break;
    case "select": {
      const option = findOption(field.options ?? [], raw);
      if (option != null) return option;
      break;
    }
    case "phone": {
      const phone = normalizePhone(raw);
      if (
        phone &&
        (/^\+7\d{10}$/.test(phone) ||
          (!phone.startsWith("+7") && /^\+\d{11,15}$/.test(phone)))
      ) {
        return phone;
      }
      break;
    }
    case "url": {
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
      if (length(raw) <= 2000 && /^https?:\/\/[^\s/]+\.\S+$/i.test(raw)) {
        return raw;
      }
      break;
    }
  }
  throw invalid(field);
};

/** Fields of an entity in their order (archived ones only when asked) */
export const entityFields = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  { archived = false }: { archived?: boolean } = {},
) =>
  fields
    .filter((field) => field.entity === entity && (archived || field.is_active))
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const hasKey = (values: CustomValues, key: string) =>
  Object.prototype.hasOwnProperty.call(values, key);

/**
 * The values a write stores, same as private.handle_custom_values: changed
 * values normalized, unchanged ones kept as they are, archived fields keep
 * their old value, keys of unknown fields dropped.
 */
export const sanitizeCustomValues = ({
  fields,
  entity,
  previous,
  next,
}: {
  fields: CustomField[];
  entity: CustomFieldEntity;
  previous?: CustomValues | null;
  next?: CustomValues | null;
}): CustomValues => {
  const before = previous ?? {};
  const after = next ?? {};
  const result: CustomValues = {};
  for (const field of entityFields(fields, entity, { archived: true })) {
    const key = String(field.id);
    if (!field.is_active) {
      if (hasKey(before, key)) result[key] = before[key];
    } else if (hasKey(after, key)) {
      if (hasKey(before, key) && sameValue(before[key], after[key])) {
        result[key] = after[key];
      } else {
        const value = normalizeCustomValue(field, after[key]);
        if (value != null) result[key] = value;
      }
    }
  }
  return result;
};

/** Whether a value counts for a required field (a checkbox must be ticked) */
export const isFilled = (
  field: Pick<CustomField, "type">,
  value: CustomValue | null | undefined,
) =>
  field.type === "checkbox"
    ? value === true
    : value != null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0);

/** The first active required field without a value */
export const missingRequiredField = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  values: CustomValues | null | undefined,
) =>
  entityFields(fields, entity).find(
    (field) => field.required && !isFilled(field, values?.[String(field.id)]),
  );

/**
 * Whether a deal write checks the required fields: outside the first stage
 * of its pipeline and not refused, when the deal is created there, moves or
 * its custom fields change. Same as private.handle_custom_values.
 */
export const dealChecksRequired = ({
  stages,
  deal,
  isNew,
  stageChanged,
  valuesChanged,
}: {
  stages: Pick<Stage, "id" | "pipeline_id" | "position" | "kind">[];
  deal: { pipeline_id: Identifier; stage_id: Identifier };
  isNew: boolean;
  stageChanged: boolean;
  valuesChanged: boolean;
}) => {
  const stage = stages.find((s) => String(s.id) === String(deal.stage_id));
  const first = stages
    .filter((s) => String(s.pipeline_id) === String(deal.pipeline_id))
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))[0];
  return (
    stage?.kind !== "lost" &&
    String(first?.id) !== String(deal.stage_id) &&
    (isNew || stageChanged || valuesChanged)
  );
};

/** Throws «Заполните поле «…»» when a required field is empty */
export const checkRequiredFields = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  values: CustomValues | null | undefined,
) => {
  const missing = missingRequiredField(fields, entity, values);
  if (missing) {
    throw new CustomFieldError(
      requiredMessage(missing.name),
      "custom_field_required",
      missing.id,
    );
  }
};

/**
 * Checks the values of a form: every value readable, the required fields
 * filled when `required` is set. Returns the message of the first problem.
 */
export const customValuesProblem = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  values: CustomValues | null | undefined,
  { required = true }: { required?: boolean } = {},
): string | undefined => {
  try {
    const normalized = sanitizeCustomValues({
      fields,
      entity,
      previous: {},
      next: values ?? {},
    });
    if (required) checkRequiredFields(fields, entity, normalized);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** { "cf:<id>": [before, after] } of the values that differ */
export const customValuesDiff = (
  before: CustomValues | null | undefined,
  after: CustomValues | null | undefined,
): Record<string, [unknown, unknown]> => {
  const a = before ?? {};
  const b = after ?? {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return Object.fromEntries(
    keys
      .filter((key) => !sameValue(a[key], b[key]))
      .map((key) => [
        `${CHANGE_PREFIX}${key}`,
        [a[key] ?? null, b[key] ?? null],
      ]),
  );
};

/** The field id of a "cf:<id>" change key, else null */
export const changeFieldId = (key: string) =>
  key.startsWith(CHANGE_PREFIX) ? key.slice(CHANGE_PREFIX.length) : null;

const groupThousands = (value: number) =>
  String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** 2026-03-01 → 01.03.2026 */
const formatDay = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}.${month}.${year}` : value;
};

/**
 * A value as a patient reads it in a message: «150 000 ₸», «01.03.2026»,
 * «12 марта в 14:30», «да». Same as private.custom_field_text.
 */
export const customFieldText = (
  type: CustomFieldType,
  value: CustomValue | null | undefined,
  timeZone?: string,
): string | null => {
  if (value == null) return null;
  if (type === "checkbox") return value === true ? "да" : "нет";
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (type === "money" && Number.isFinite(Number(value))) {
    return `${groupThousands(Number(value))} ₸`;
  }
  if (type === "date" && typeof value === "string") return formatDay(value);
  if (type === "datetime" && typeof value === "string") {
    return formatVisitDate(value, timeZone) ?? value;
  }
  return String(value);
};

/** {поле:Название} variables of an entity's fields (archived ones too) */
export const customFieldVars = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  values: CustomValues | null | undefined,
  timeZone?: string,
): Record<string, string | null> =>
  Object.fromEntries(
    fields
      .filter((field) => field.entity === entity)
      .map((field) => [
        `${TEMPLATE_PREFIX}${field.name}`,
        customFieldText(field.type, values?.[String(field.id)], timeZone),
      ]),
  );

/** Variable of a field, as inserted in a template */
export const templateVariable = (field: Pick<CustomField, "name">) =>
  `${TEMPLATE_PREFIX}${field.name}`;

/** A plausible value of a field, for the preview of the templates */
export const sampleCustomText = (
  field: Pick<CustomField, "type" | "options">,
): string => {
  switch (field.type) {
    case "number":
      return "2";
    case "money":
      return "150 000 ₸";
    case "date":
      return "01.03.2026";
    case "datetime":
      return "12 марта в 14:30";
    case "checkbox":
      return "да";
    case "select":
    case "multiselect":
      return field.options?.[0] ?? "…";
    case "phone":
      return "+77011112233";
    case "url":
      return "https://clinic.kz";
    default:
      return "…";
  }
};

/**
 * A value for the screens: money with the currency of the clinic, dates in
 * the browser's time zone, «Да» / «Нет».
 */
export const displayCustomValue = (
  field: Pick<CustomField, "type">,
  value: CustomValue | null | undefined,
  {
    formatMoney,
    yes = "Да",
    no = "Нет",
  }: {
    formatMoney?: (amount: number) => string;
    yes?: string;
    no?: string;
  } = {},
): string | null => {
  if (value == null || value === "") return null;
  if (field.type === "checkbox") return value === true ? yes : no;
  if (field.type === "money" && formatMoney) return formatMoney(Number(value));
  if (field.type === "number" && typeof value === "number") {
    return value.toLocaleString("ru-RU", { maximumFractionDigits: 6 });
  }
  if (field.type === "datetime" && typeof value === "string") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return customFieldText(field.type, value);
};

/** Fields shown on the kanban card (active deal fields, two at most) */
export const cardFields = (fields: CustomField[]) =>
  entityFields(fields, "deal")
    .filter((field) => field.show_on_card)
    .slice(0, MAX_CARD_FIELDS);

/** Deal fields the lists can filter on */
export const filterableFields = (
  fields: CustomField[],
  entity: CustomFieldEntity = "deal",
) =>
  entityFields(fields, entity).filter((field) =>
    FILTERABLE_TYPES.includes(field.type),
  );

/** The selection of the custom_values@cs filter (its JSON text) */
export const parseCustomFilter = (raw: unknown): CustomValues => {
  if (typeof raw !== "string" || !raw.trim().startsWith("{")) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CustomValues)
      : {};
  } catch {
    return {};
  }
};

/**
 * The filter value for a selection ({ "<id>": value }); undefined when
 * nothing is chosen. A multiselect option is matched as [option].
 */
export const toCustomFilter = (
  selection: Record<string, CustomValue | null | undefined>,
): string | undefined => {
  const entries = Object.entries(selection).filter(
    ([, value]) =>
      value != null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0),
  );
  if (!entries.length) return undefined;
  return JSON.stringify(Object.fromEntries(entries));
};

/** Whether values match a filter: jsonb containment (@>) */
export const containsValues = (
  values: CustomValues | null | undefined,
  filter: CustomValues,
) =>
  Object.entries(filter).every(([key, wanted]) => {
    const value = values?.[key];
    if (Array.isArray(wanted)) {
      return (
        Array.isArray(value) &&
        wanted.every((item) => value.some((v) => sameValue(v, item)))
      );
    }
    return sameValue(value, wanted);
  });

/**
 * Validation of a definition before saving it, same as the database: a
 * name without braces, unique in the entity, options for the lists, two
 * fields at most on the card. Returns the message of the first problem.
 */
export const definitionProblem = (
  definition: Pick<
    CustomField,
    "entity" | "name" | "type" | "options" | "show_on_card" | "is_active"
  > & { id?: Identifier },
  fields: CustomField[],
): string | undefined => {
  const name = btrim(definition.name ?? "");
  if (!name) return "custom_fields.errors.name_required";
  if (/[{}]/.test(name)) return "custom_fields.errors.name_braces";
  if (
    fields.some(
      (field) =>
        field.entity === definition.entity &&
        String(field.id) !== String(definition.id) &&
        field.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return "custom_fields.errors.name_taken";
  }
  if (
    LIST_TYPES.includes(definition.type) &&
    !cleanOptions(definition.options ?? []).length
  ) {
    return "custom_fields.errors.options_required";
  }
  if (
    definition.show_on_card &&
    definition.is_active &&
    fields.filter(
      (field) =>
        field.show_on_card && String(field.id) !== String(definition.id),
    ).length >= MAX_CARD_FIELDS
  ) {
    return "custom_fields.errors.card_limit";
  }
  return undefined;
};

/** Options trimmed, without blanks nor duplicates (whatever the case) */
export const cleanOptions = (options: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of options) {
    const value = btrim(String(option ?? ""));
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    result.push(value);
  }
  return result;
};

/** The definition as the database stores it (handle_custom_field_write) */
export const normalizeDefinition = <
  T extends Pick<
    CustomField,
    "entity" | "name" | "type" | "options" | "show_on_card" | "is_active"
  >,
>(
  definition: T,
): T => ({
  ...definition,
  name: btrim(definition.name ?? ""),
  options: LIST_TYPES.includes(definition.type)
    ? cleanOptions(definition.options ?? [])
    : [],
  show_on_card:
    !!definition.show_on_card &&
    definition.is_active !== false &&
    definition.entity === "deal",
});

/** A field by the name of a column (import, CSV): same rules as the names */
export const findFieldByName = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  name: string,
) => {
  const wanted = btrim(name).toLowerCase().replace(/ё/g, "е");
  return fields.find(
    (field) =>
      field.entity === entity &&
      field.name.toLowerCase().replace(/ё/g, "е") === wanted,
  );
};

/**
 * Columns of the CSV export: one per field of the entity (archived ones
 * too), named after the field, with the value as people read it.
 */
export const customCsvColumns = (
  fields: CustomField[],
  entity: CustomFieldEntity,
  values: CustomValues | null | undefined,
): Record<string, string> =>
  Object.fromEntries(
    entityFields(fields, entity, { archived: true }).map((field) => [
      field.name,
      customFieldText(field.type, values?.[String(field.id)]) ?? "",
    ]),
  );

const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO moment → value of a datetime-local input (browser time zone) */
export const toLocalInput = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/** Value of a datetime-local input → ISO moment */
export const fromLocalInput = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};
