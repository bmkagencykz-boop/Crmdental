import type { Deal, QuickReply } from "../types";

/** Variables of the quick replies, as typed in the text */
export const QUICK_REPLY_VARIABLES = [
  "имя",
  "услуга",
  "дата_визита",
  "клиника",
  "сотрудник",
] as const;
export type QuickReplyVariable = (typeof QUICK_REPLY_VARIABLES)[number];

export type QuickReplyContext = Partial<
  Record<QuickReplyVariable, string | null | undefined>
>;

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/**
 * "5 октября в 14:30" in the clinic's time zone, like the auto-messages
 * (private.format_visit_date).
 */
export const formatVisitDate = (
  value: string | null | undefined,
  timeZone = "Asia/Almaty",
) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} в ${parts.hour}:${parts.minute}`;
};

// Marks a variable without value while the text is cleaned up
const BLANK = "\uE000";

/**
 * Replaces the known {variables} with their value: a missing value gives an
 * empty string, then the spaces left behind are collapsed (as
 * private.render_template does for the auto-messages). Around a missing
 * value, the punctuation is tidied too: "Здравствуйте, {имя}!" gives
 * "Здравствуйте!", "{имя}, записали вас" gives "Записали вас". Unknown
 * {words} stay as they are.
 */
export const renderQuickReply = (
  text: string,
  context: QuickReplyContext,
): string => {
  const replaced = text
    .replace(/\{([^{}]+)\}/g, (match, name: string) =>
      (QUICK_REPLY_VARIABLES as readonly string[]).includes(name)
        ? (context[name as QuickReplyVariable] ?? "").trim() || BLANK
        : match,
    )
    // "день, {имя}!" / "консультацию {дата_визита}."
    .replace(/[ \t]*,?[ \t]*\uE000[ \t]*(?=[.!?;:…])/g, "")
    // "{имя}, записали" at the start of a line
    .replace(
      /(^|\n)[ \t]*\uE000[ \t]*[,;:]?[ \t]*(\S?)/g,
      (_, start: string, first: string) => start + first.toLocaleUpperCase(),
    )
    .replaceAll(BLANK, "");
  return replaced
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/^[ \n]+|[ \n]+$/g, "");
};

/** Values of the variables for a deal of the clinic */
export const quickReplyContext = ({
  deal,
  serviceName,
  clinicName,
  salesFirstName,
  timeZone,
}: {
  deal?: Pick<
    Deal,
    "patient_first_name" | "appointment_at" | "visit_at"
  > | null;
  serviceName?: string | null;
  clinicName?: string | null;
  salesFirstName?: string | null;
  timeZone?: string;
}): QuickReplyContext => ({
  имя: deal?.patient_first_name,
  услуга: serviceName,
  дата_визита: formatVisitDate(
    deal?.appointment_at ?? deal?.visit_at,
    timeZone,
  ),
  клиника: clinicName,
  сотрудник: salesFirstName,
});

/** Replies whose title or shortcut contains the query, in their order */
export const filterQuickReplies = (replies: QuickReply[], query: string) => {
  const needle = query.trim().toLocaleLowerCase("ru");
  const sorted = [...replies].sort(compareQuickReplies);
  if (!needle) return sorted;
  const matches = (value?: string | null) =>
    (value ?? "").toLocaleLowerCase("ru").includes(needle);
  // Shortcut prefix first (/адр → адрес), then any other match
  const score = (reply: QuickReply) =>
    (reply.shortcut ?? "").toLocaleLowerCase("ru").startsWith(needle) ? 0 : 1;
  return sorted
    .filter((reply) => matches(reply.title) || matches(reply.shortcut))
    .sort((a, b) => score(a) - score(b));
};

/** Clinic-wide replies first, then personal ones, each by position */
export const compareQuickReplies = (a: QuickReply, b: QuickReply) =>
  Number(a.sales_id != null) - Number(b.sales_id != null) ||
  a.position - b.position ||
  Number(a.id) - Number(b.id);

/**
 * The "/query" being typed at the caret: "/" at the start of the text or
 * after a space or a line break, followed by no space.
 */
export const findSlashQuery = (
  text: string,
  caret: number,
): { start: number; query: string } | null => {
  const before = text.slice(0, caret);
  const match = /(^|\s)\/([^\s/]*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
};

/** Puts the reply in place of the "/query" (from start to the caret) */
export const insertQuickReply = (
  text: string,
  start: number,
  caret: number,
  reply: string,
): { text: string; caret: number } => {
  const after = text.slice(caret);
  const glue = /^[\p{L}\p{N}]/u.test(after) ? " " : "";
  const value = text.slice(0, start) + reply + glue + after;
  return { text: value, caret: start + reply.length + glue.length };
};

/** A shortcut is one word without "/" (the database refuses the rest) */
export const normalizeShortcut = (value: string) =>
  value
    .trim()
    .replace(/^\/+/, "")
    .replace(/[\s/]+/g, "_")
    .toLocaleLowerCase("ru") || null;
