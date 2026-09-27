import type { GetListParams } from "ra-core";

/**
 * Digits of a phone query, comparable with the normalized numbers stored by
 * the database (+7XXXXXXXXXX): "8 701 123" -> "701123" is found inside
 * "+77011234567". Returns null when the query is not a phone number.
 */
export const phoneQueryDigits = (q: string): string | null => {
  if (/[^\d\s()+-]/.test(q)) return null;
  let digits = q.replace(/\D/g, "");
  if (digits.length < 3) return null;
  // Kazakh numbers start with 7 after the country code: drop a leading 8 or 7
  if (digits.length >= 4 && /^[78]7/.test(digits)) digits = digits.slice(1);
  return digits;
};

/**
 * Turns the `q` filter of a list into an OR of ilike filters on the given
 * text columns, plus the phone column when the query looks like a number.
 */
export const applySearch =
  (columns: string[], phoneColumn?: string) =>
  (params: GetListParams): GetListParams => {
    const q = params.filter?.q;
    if (!q) return params;
    const { q: _q, ...filter } = params.filter;
    const digits = phoneColumn ? phoneQueryDigits(String(q)) : null;
    const or: Record<string, string> = digits
      ? { [`${phoneColumn}@ilike`]: digits }
      : Object.fromEntries(columns.map((column) => [`${column}@ilike`, q]));
    return { ...params, filter: { ...filter, "@or": or } };
  };
