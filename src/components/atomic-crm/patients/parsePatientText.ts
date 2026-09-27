import { phoneQueryDigits } from "../providers/commons/search";

export type ParsedPatient = {
  last_name?: string;
  first_name?: string;
  middle_name?: string;
  phone?: string;
};

/**
 * What an administrator types to create a patient on the fly: a phone number
 * ("8 701 123 45 67") or a full name in Russian order ("Нурланова Асель
 * Ерлановна"), optionally followed by a phone.
 */
export const parsePatientText = (text: string): ParsedPatient => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return {};
  const phoneMatch = trimmed.match(/[+\d][\d\s()-]{5,}$/);
  const phone =
    phoneMatch && phoneQueryDigits(phoneMatch[0])
      ? phoneMatch[0].trim()
      : undefined;
  const namePart = (
    phone ? trimmed.slice(0, -phoneMatch![0].length) : trimmed
  ).trim();
  const [last_name, first_name, ...rest] = namePart ? namePart.split(" ") : [];
  return {
    ...(last_name ? { last_name } : {}),
    ...(first_name ? { first_name } : {}),
    ...(rest.length ? { middle_name: rest.join(" ") } : {}),
    ...(phone ? { phone } : {}),
  };
};

export const patientDisplayName = (patient?: {
  last_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  phones?: string[];
  phone_jsonb?: { number: string }[];
}) => {
  if (!patient) return "";
  const name = [patient.last_name, patient.first_name, patient.middle_name]
    .filter(Boolean)
    .join(" ");
  return name || patient.phones?.[0] || patient.phone_jsonb?.[0]?.number || "—";
};
