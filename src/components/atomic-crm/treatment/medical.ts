import type { Patient } from "../types";

/** The free-text fields of the light patient card (stage 29) */
export const MEDICAL_FIELDS = [
  "allergies",
  "contraindications",
  "chronic_diseases",
] as const;
export type MedicalField = (typeof MEDICAL_FIELDS)[number];

/**
 * Two merged patients: one text, or both on two lines — nothing medical
 * is lost. Same as private.merge_note_text.
 */
export const mergeNoteText = (
  kept: string | null | undefined,
  merged: string | null | undefined,
) => {
  const a = kept?.trim() ? kept : null;
  const b = merged?.trim() ? merged.trim() : null;
  if (!a) return b;
  if (!b || b === a.trim()) return a;
  return `${a}\n${b}`;
};

/** The medical fields of a merge of patients (private.merge_patient_rows) */
export const mergeMedical = (
  keep: Partial<Patient>,
  merge: Partial<Patient>,
): Pick<Patient, MedicalField | "preferred_doctor_id"> => ({
  allergies: mergeNoteText(keep.allergies, merge.allergies),
  contraindications: mergeNoteText(
    keep.contraindications,
    merge.contraindications,
  ),
  chronic_diseases: mergeNoteText(
    keep.chronic_diseases,
    merge.chronic_diseases,
  ),
  preferred_doctor_id:
    keep.preferred_doctor_id ?? merge.preferred_doctor_id ?? null,
});
