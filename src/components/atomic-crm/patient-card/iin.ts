/**
 * The Kazakh IIN (ИИН, 12 digits) of a patient: YYMMDD, the century and
 * sex digit (1–2: 1800s, 3–4: 1900s, 5–6: 2000s; odd — a man, even — a
 * woman), four serial digits and a check digit. Twin of private.iin_valid,
 * private.iin_birth_date and private.iin_gender (37_patient_card.sql).
 */

export type IinGender = "male" | "female";

export type IinProblem = "length" | "date" | "checksum";

export type ParsedIin =
  | {
      valid: true;
      iin: string;
      /** YYYY-MM-DD */
      birthDate: string;
      gender: IinGender;
    }
  | { valid: false; iin: string; problem: IinProblem };

/** Spaces and dashes out: «9005 1540 0123» → «900515400123» */
export const normalizeIin = (value: string | null | undefined) =>
  (value ?? "").replace(/[\s-]/g, "");

const CENTURY: Record<string, number> = {
  "1": 1800,
  "2": 1800,
  "3": 1900,
  "4": 1900,
  "5": 2000,
  "6": 2000,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The birth date of an IIN (YYYY-MM-DD), null when it is not a date */
export const iinBirthDate = (value: string): string | null => {
  if (!/^\d{12}$/.test(value)) return null;
  const century = CENTURY[value[6]];
  if (century == null) return null;
  const year = century + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
};

export const iinGender = (value: string): IinGender | null => {
  if (!/^\d{12}$/.test(value) || CENTURY[value[6]] == null) return null;
  return Number(value[6]) % 2 === 1 ? "male" : "female";
};

/** The check digit of the first eleven digits, null when there is none */
export const iinCheckDigit = (value: string): number | null => {
  const digits = value.slice(0, 11).split("").map(Number);
  const weigh = (weight: (i: number) => number) =>
    digits.reduce((sum, digit, i) => sum + digit * weight(i + 1), 0) % 11;
  let check = weigh((i) => i);
  if (check === 10) {
    // Weights 3, 4 … 11, 1, 2
    check = weigh((i) => ((i + 1) % 11) + 1);
    if (check === 10) return null;
  }
  return check;
};

export const parseIin = (input: string | null | undefined): ParsedIin => {
  const iin = normalizeIin(input);
  if (!/^\d{12}$/.test(iin)) return { valid: false, iin, problem: "length" };
  const birthDate = iinBirthDate(iin);
  const gender = iinGender(iin);
  if (!birthDate || !gender) return { valid: false, iin, problem: "date" };
  if (iinCheckDigit(iin) !== Number(iin[11])) {
    return { valid: false, iin, problem: "checksum" };
  }
  return { valid: true, iin, birthDate, gender };
};

export const isValidIin = (value: string | null | undefined) =>
  parseIin(value).valid;

/** «900515 400123»: the date part apart, easier to read aloud */
export const formatIin = (value: string | null | undefined) => {
  const iin = normalizeIin(value);
  return /^\d{12}$/.test(iin) ? `${iin.slice(0, 6)} ${iin.slice(6)}` : iin;
};

/**
 * The full years of a person born on a date (YYYY-MM-DD) at a moment;
 * null without a date.
 */
export const ageOn = (
  birthDate: string | null | undefined,
  now: Date = new Date(),
): number | null => {
  const match = birthDate?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  let age = now.getFullYear() - year;
  if (
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day)
  ) {
    age--;
  }
  return age >= 0 ? age : null;
};

/** «34 года», «1 год», «12 лет» */
export const ageText = (age: number) => {
  const mod10 = age % 10;
  const mod100 = age % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "год"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "года"
        : "лет";
  return `${age} ${word}`;
};
