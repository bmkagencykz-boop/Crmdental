import type { Patient } from "../types";

export const defaultPhoneJsonb = [{ number: "", type: "Mobile" }];

/** Drops empty phone rows and empty strings before saving */
const cleanPatient = (data: Patient): Patient => ({
  ...data,
  phone_jsonb: (data.phone_jsonb ?? []).filter(
    (phone) => phone?.number && phone.number.trim() !== "",
  ),
  tags: data.tags ?? [],
});

export const cleanupPatientForCreate = (data: Patient): Patient =>
  cleanPatient({
    ...data,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  });

export const cleanupPatientForEdit = cleanPatient;
