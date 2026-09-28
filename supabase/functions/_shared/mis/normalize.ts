/**
 * Vendor-neutral records of a dental MIS (Dentist Plus, MacDent) and the
 * tolerant readers that turn vendor JSON into them. The SQL functions
 * public.mis_upsert_* (supabase/schemas/27_mis_connectors.sql) take exactly
 * these shapes. No Deno import here: unit tested with Vitest.
 *
 * The vendors' API documentation was not available when this was written,
 * so every reader accepts several field names (English and Russian, snake
 * and camel case, nested objects) — see the config object of each vendor.
 */

export type MisKind = "dentist_plus" | "macdent";

export const MIS_STATUSES = [
  "scheduled",
  "confirmed",
  "arrived",
  "completed",
  "in_treatment",
  "cancelled",
  "no_show",
] as const;
export type MisStatus = (typeof MIS_STATUSES)[number];

/** Argument `patient` of public.mis_upsert_patient */
export type MisPatient = {
  external_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  full_name?: string | null;
  phones: string[];
  birth_date?: string | null;
};

export type MisDoctor = { external_id?: string | null; name?: string | null };

/** Argument `appt` of public.mis_upsert_appointment */
export type MisAppointment = {
  external_id: string;
  patient?: MisPatient;
  patient_external_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  completed_at?: string | null;
  status: MisStatus;
  status_label?: string | null;
  doctor?: MisDoctor | null;
  service?: string | null;
  comment?: string | null;
};

/** Argument `payment` of public.mis_upsert_payment */
export type MisPayment = {
  external_id: string;
  amount: number;
  paid_at?: string | null;
  kind: "payment" | "prepayment";
  comment?: string | null;
  appointment_external_id?: string | null;
  patient_external_id?: string | null;
  patient?: MisPatient;
};

/** Argument `visit` of public.mis_visit_completed */
export type MisVisit = {
  appointment_external_id: string;
  completed_at?: string | null;
  treatment_started?: boolean;
  patient?: MisPatient;
  patient_external_id?: string | null;
};

export type MisItem =
  | { type: "patient"; data: MisPatient }
  | { type: "appointment"; data: MisAppointment }
  | { type: "payment"; data: MisPayment }
  | { type: "visit"; data: MisVisit };

export type Payload = Record<string, unknown>;

// --- readers ---------------------------------------------------------------

export const isObject = (value: unknown): value is Payload =>
  !!value && typeof value === "object" && !Array.isArray(value);

const keyOf = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");

/**
 * The first present value among the names: case, "_", "-" and spaces are
 * ignored ("patient_id" = "PatientId" = "patient-id"), a dotted name reads a
 * nested object ("patient.phone").
 */
export const pick = (source: unknown, names: readonly string[]): unknown => {
  if (!isObject(source)) return undefined;
  for (const name of names) {
    const [head, ...rest] = name.split(".");
    const wanted = keyOf(head);
    const key = Object.keys(source).find((k) => keyOf(k) === wanted);
    if (key === undefined) continue;
    const value = rest.length
      ? pick(source[key], [rest.join(".")])
      : source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
};

export const text = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === "object") return null;
  const result = String(value).trim().replace(/\s+/g, " ");
  return result === "" ? null : result;
};

/** An id: a string or a number, as a string */
export const idOf = (value: unknown): string | null => {
  if (isObject(value)) return idOf(pick(value, ["id", "uuid", "external_id"]));
  return text(value);
};

/** Phones from a string ("8 701..., +7 702..."), a list, or objects */
export const phonesOf = (value: unknown): string[] => {
  const result: string[] = [];
  const add = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(add);
    if (isObject(item)) {
      return add(pick(item, ["number", "phone", "value", "номер", "телефон"]));
    }
    const raw = text(item);
    if (!raw) return;
    for (const part of raw.split(/[,;/]|\s{2,}/)) {
      const digits = part.replace(/\D/g, "");
      if (digits.length >= 10) result.push(part.trim());
    }
  };
  add(value);
  return [...new Set(result)];
};

/**
 * ISO date-time from a Unix time, an ISO string with or without zone, or a
 * Russian "15.10.2026 10:30". A time without zone is the clinic's local time
 * (offset, Kazakhstan: +05:00). A separate time field may complete a date.
 */
export const dateTimeOf = (
  value: unknown,
  offset = "+05:00",
  time?: unknown,
): string | null => {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{9,13}(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  let date: string | null = null;
  let clock = "";
  let zone = "";
  let match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i,
  );
  if (match) {
    date = `${match[1]}-${match[2]}-${match[3]}`;
    if (match[4]) {
      clock = `${match[4].padStart(2, "0")}:${match[5]}:${match[6] ?? "00"}`;
    }
    zone = match[7] ?? "";
  } else {
    match = raw.match(
      /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (!match) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    date = `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    if (match[4]) {
      clock = `${match[4].padStart(2, "0")}:${match[5]}:${match[6] ?? "00"}`;
    }
  }
  if (!clock) {
    const extra = text(time)?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (extra) {
      clock = `${extra[1].padStart(2, "0")}:${extra[2]}:${extra[3] ?? "00"}`;
    }
  }
  if (!clock) clock = "00:00:00";
  if (zone && /^[+-]\d{2}$/.test(zone)) zone += ":00";
  if (zone && /^[+-]\d{4}$/.test(zone)) {
    zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  }
  const parsed = new Date(`${date}T${clock}${zone || offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/** A calendar date (birth date, payment date) as YYYY-MM-DD */
export const dateOf = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  return null;
};

/** An amount in tenge: "12 500,50" → 12500.5 */
export const amountOf = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\u00a0₸]|тг|kzt/gi, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

export const booleanOf = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  const raw = text(value)?.toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "да", "y"].includes(raw)) return true;
  if (["0", "false", "no", "нет", "n"].includes(raw)) return false;
  return null;
};

/**
 * Status of an appointment from the MIS wording (Russian or English) or a
 * code of the vendor config. Unknown wording is «scheduled» (an appointment
 * that exists), so a new word never loses a visit — it only moves nothing
 * beyond «Записан».
 */
export const statusOf = (
  value: unknown,
  codes: Record<string, MisStatus> = {},
): MisStatus => {
  const raw = text(value)?.toLowerCase().replace(/ё/g, "е") ?? "";
  if (!raw) return "scheduled";
  if (codes[raw]) return codes[raw];
  const rules: Array<[RegExp, MisStatus]> = [
    [/отмен|cancel|удален|deleted|annul/, "cancelled"],
    [/не\s*приш|неявк|не\s*явил|no[\s_-]?show|missed|absent/, "no_show"],
    [
      /лечени.*(нач|идет|процесс)|в\s*лечении|treatment|in[\s_-]?treatment/,
      "in_treatment",
    ],
    [
      /заверш|состоял|оказан|выполн|complete|done|finish|closed|visited/,
      "completed",
    ],
    [
      /приш|пришел|приход|на\s*при[её]ме|в\s*клинике|arriv|came|in[\s_-]?progress|checked[\s_-]?in/,
      "arrived",
    ],
    [/подтвер|confirm/, "confirmed"],
    [
      /запис|назнач|план|ожида|нов|schedul|book|pending|new|created|reserved/,
      "scheduled",
    ],
  ];
  for (const [pattern, status] of rules) {
    if (pattern.test(raw)) return status;
  }
  return "scheduled";
};

export const isMisStatus = (value: unknown): value is MisStatus =>
  MIS_STATUSES.includes(value as MisStatus);
