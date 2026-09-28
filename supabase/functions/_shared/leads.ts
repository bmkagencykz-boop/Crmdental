/**
 * Requests from website forms, Tilda and 2GIS (edge function leads_webhook)
 * mapped to the shape of public.ingest_lead. No Deno import here so that it
 * can be unit tested.
 */

export type Lead = {
  name: string | null;
  phone: string | null;
  source: string | null;
  service: string | null;
  comment: string | null;
  /** Page the visitor came from, and the page of the form (stage 32) */
  referrer: string | null;
  landing_page: string | null;
  utm: Record<string, string>;
};

/** Field names of common form builders (Tilda, WordPress, hand-made forms) */
const ALIASES: Record<Exclude<keyof Lead, "utm">, string[]> = {
  name: [
    "name",
    "fio",
    "fullname",
    "full_name",
    "your-name",
    "your_name",
    "client_name",
    "имя",
    "фио",
  ],
  phone: [
    "phone",
    "tel",
    "telephone",
    "phone_number",
    "phonenumber",
    "your-phone",
    "mobile",
    "телефон",
    "номер",
    "номер телефона",
  ],
  source: ["source", "lead_source", "источник"],
  service: ["service", "services", "услуга", "направление"],
  comment: [
    "comment",
    "comments",
    "message",
    "textarea",
    "text",
    "question",
    "your-message",
    "комментарий",
    "сообщение",
    "вопрос",
  ],
  referrer: ["referrer", "referer"],
  landing_page: ["landing_page", "landing", "page_url", "pageurl", "page"],
};

/** Technical fields of Tilda and other builders: not shown to the clinic */
const IGNORED = new Set([
  "token",
  "test",
  "tranid",
  "formid",
  "formname",
  "cookies",
  "_ym_uid",
  "form_id",
  "form_name",
]);

const toText = (value: unknown): string | null => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const joined = value.map(toText).filter(Boolean).join(", ");
    return joined || null;
  }
  if (typeof value === "object") return null;
  const text = String(value).trim();
  return text ? text.slice(0, 2000) : null;
};

/** Tilda checks the webhook with a single test=test field */
export const isTestPing = (fields: Record<string, unknown>) =>
  toText(fields.test) === "test" &&
  !Object.keys(fields).some((key) =>
    ALIASES.phone.includes(key.trim().toLowerCase()),
  );

/**
 * Form fields → lead. Known names (any case) fill name, phone, source,
 * service, comment, referrer and landing page; utm_* fields are kept as UTM tags; any other field is
 * appended to the comment so that nothing the patient wrote is lost.
 */
export const toLead = (fields: Record<string, unknown>): Lead => {
  const lead: Lead = {
    name: null,
    phone: null,
    source: null,
    service: null,
    comment: null,
    referrer: null,
    landing_page: null,
    utm: {},
  };
  const extra: string[] = [];
  const nested =
    fields.utm && typeof fields.utm === "object" && !Array.isArray(fields.utm)
      ? (fields.utm as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(nested)) {
    const text = toText(value);
    const name = key.trim().toLowerCase();
    if (text && name.startsWith("utm_")) lead.utm[name] = text;
  }
  for (const [rawKey, value] of Object.entries(fields)) {
    const key = rawKey.trim().toLowerCase();
    if (key === "utm" || IGNORED.has(key)) continue;
    const text = toText(value);
    if (!text) continue;
    if (key.startsWith("utm_")) {
      lead.utm[key] = text;
      continue;
    }
    const field = (Object.keys(ALIASES) as Exclude<keyof Lead, "utm">[]).find(
      (name) => ALIASES[name].includes(key),
    );
    if (field && lead[field] == null) {
      lead[field] = text;
    } else {
      extra.push(`${rawKey.trim()}: ${text}`);
    }
  }
  if (extra.length) {
    lead.comment = [lead.comment, ...extra].filter(Boolean).join("\n");
  }
  return lead;
};

/** Body of a request: JSON, or a form (urlencoded) */
export const parseFields = (
  contentType: string | null,
  body: string,
): Record<string, unknown> | null => {
  const text = body.trim();
  if (!text) return {};
  const looksJson = text.startsWith("{");
  if (contentType?.includes("application/json") || looksJson) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  const fields: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const previous = fields[key];
    fields[key] =
      previous === undefined
        ? value
        : ([] as unknown[]).concat(previous, value);
  }
  return fields;
};

/** CORS: a website posts the form with a plain fetch() from its own domain */
export const leadCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
