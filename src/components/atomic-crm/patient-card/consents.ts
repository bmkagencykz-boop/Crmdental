import { formatPhone } from "../misc/formatPhone";
import { formatIin } from "./iin";

/**
 * Informed consents (stage 37): the variables of a consent template and the
 * text given to the patient. Variables are written in braces, in Russian or
 * in English: {пациент} / {patient}, {дата_рождения} / {birth_date}, {иин} /
 * {iin}, {телефон} / {phone}, {дата} / {date}, {клиника} / {clinic},
 * {врач} / {doctor}. An unknown variable is left as it is; a known one
 * without a value becomes a blank line to fill in by hand.
 */

export const CONSENT_VARIABLES = [
  ["пациент", "patient"],
  ["дата_рождения", "birth_date"],
  ["иин", "iin"],
  ["телефон", "phone"],
  ["дата", "date"],
  ["клиника", "clinic"],
  ["врач", "doctor"],
] as const;
export type ConsentVariable = (typeof CONSENT_VARIABLES)[number][1];

export type ConsentValues = Partial<Record<ConsentVariable, string | null>>;

/** A value to fill in by hand */
export const BLANK = "________________";

const pad = (n: number) => String(n).padStart(2, "0");

/** «15.05.1990» of YYYY-MM-DD or a Date */
export const ruDate = (value: string | Date | null | undefined) => {
  if (!value) return null;
  if (value instanceof Date) {
    return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()}`;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
};

/** The values of the variables for a patient */
export const consentValues = ({
  patientName,
  birthDate,
  iin,
  phone,
  clinic,
  doctor,
  date = new Date(),
}: {
  patientName?: string | null;
  birthDate?: string | null;
  iin?: string | null;
  phone?: string | null;
  clinic?: string | null;
  doctor?: string | null;
  date?: Date;
}): ConsentValues => ({
  patient: patientName?.trim() || null,
  birth_date: ruDate(birthDate),
  iin: iin ? formatIin(iin) : null,
  phone: phone ? formatPhone(phone) : null,
  date: ruDate(date),
  clinic: clinic?.trim() || null,
  doctor: doctor?.trim() || null,
});

/** The text of a template with its variables filled in */
export const renderConsent = (body: string, values: ConsentValues) =>
  body.replace(/\{([a-zа-яё_]+)\}/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    const variable = CONSENT_VARIABLES.find(
      ([ru, en]) => ru === key || en === key,
    );
    if (!variable) return whole;
    return values[variable[1]] || BLANK;
  });

/** The variables a template uses that have no value for this patient */
export const missingValues = (body: string, values: ConsentValues) => {
  const missing = new Set<ConsentVariable>();
  for (const [, name] of body.matchAll(/\{([a-zа-яё_]+)\}/gi)) {
    const variable = CONSENT_VARIABLES.find(
      ([ru, en]) => ru === name.toLowerCase() || en === name.toLowerCase(),
    );
    if (variable && !values[variable[1]]) missing.add(variable[1]);
  }
  return [...missing];
};

/** «Согласие на анестезию — Нурланова А.pdf» without characters files dislike */
export const consentFileName = (title: string, patientName: string) =>
  `${`${title} — ${patientName}`
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)}.pdf`;
