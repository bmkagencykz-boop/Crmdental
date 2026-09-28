/**
 * What a patient's reply to the confirmation message means (stage 28):
 * "confirm", "reschedule" or null. Same rules as private.visit_reply_kind in
 * supabase/schemas/28_schedule.sql:
 * - lowercase, ё → е, anything but letters and digits is a space;
 * - a message of more than 8 words is a conversation, not an answer;
 * - a number keyword («1», «2») only counts as the first word, a word or a
 *   phrase anywhere as whole words;
 * - a reschedule keyword wins; «не …» never confirms.
 */
export type VisitReply = "confirm" | "reschedule" | null;

const UPPER = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯӘҒҚҢӨҰҮҺІ";
const LOWER = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяәғқңөұүһі";

export const normalizeReply = (value: string | null | undefined) =>
  Array.from((value ?? "").toLowerCase())
    .map((char) => {
      const index = UPPER.indexOf(char);
      return index === -1 ? char : LOWER[index];
    })
    .join("")
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-яәғқңөұүһі]+/g, " ")
    .trim();

const hasKeyword = (normalized: string, keyword: string) => {
  const word = normalizeReply(keyword);
  if (!word) return false;
  if (/^[0-9]+$/.test(word)) return normalized.split(" ")[0] === word;
  return ` ${normalized} `.includes(` ${word} `);
};

export const parseVisitReply = (
  text: string | null | undefined,
  confirmKeywords: string[],
  rescheduleKeywords: string[],
): VisitReply => {
  const normalized = normalizeReply(text);
  if (!normalized || normalized.split(" ").length > 8) return null;
  if (rescheduleKeywords.some((word) => hasKeyword(normalized, word)))
    return "reschedule";
  if (normalized.split(" ").includes("не")) return null;
  if (confirmKeywords.some((word) => hasKeyword(normalized, word)))
    return "confirm";
  return null;
};
