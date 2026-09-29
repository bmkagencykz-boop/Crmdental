import type { Identifier } from "ra-core";

/** The states of a tooth (public.patient_teeth.state), in the legend order */
export const TOOTH_STATES = [
  "healthy",
  "caries",
  "endo",
  "treatment",
  "filling",
  "crown",
  "implant",
  "root",
  "missing",
] as const;
export type ToothState = (typeof TOOTH_STATES)[number];

/** The current state of a tooth of a patient */
export type PatientTooth = {
  id: Identifier;
  patient_id: Identifier;
  tooth: number;
  state: ToothState;
  note?: string | null;
  updated_by?: Identifier | null;
  updated_at: string;
  created_at?: string;
};

/** One change of a tooth (written by the database) */
export type ToothHistoryRow = {
  id: Identifier;
  patient_id: Identifier;
  tooth: number;
  state_before?: ToothState | null;
  state?: ToothState | null;
  note_before?: string | null;
  note?: string | null;
  sales_id?: Identifier | null;
  source: "manual" | "plan";
  plan_item_id?: Identifier | null;
  created_at: string;
};

/** The texts of a visit record, in the order of the form */
export const RECORD_FIELDS = [
  "complaints",
  "anamnesis",
  "objective",
  "diagnosis",
  "treatment",
  "recommendations",
] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];

/** «Запись приёма» */
export type VisitRecord = {
  id: Identifier;
  patient_id: Identifier;
  visit_id?: Identifier | null;
  deal_id?: Identifier | null;
  doctor_id?: Identifier | null;
  /** YYYY-MM-DD */
  record_date?: string | null;
  diagnosis_codes: string[];
  created_by?: Identifier | null;
  updated_by?: Identifier | null;
  created_at?: string;
  updated_at?: string;
} & Partial<Record<RecordField, string | null>>;

export type VisitRecordTemplate = {
  id: Identifier;
  name: string;
  content: Partial<Record<RecordField, string>>;
  diagnosis_codes: string[];
  position: number;
  created_by?: Identifier | null;
  created_at?: string;
};

/** The questions of the questionnaire (besides the stage-29 texts) */
export const QUESTIONS = [
  "medications",
  "pregnancy",
  "blood_pressure",
  "diabetes",
  "heart",
  "hepatitis_hiv",
  "anesthesia",
  "bleeding",
  "epilepsy",
  "smoking",
] as const;
export type Question = (typeof QUESTIONS)[number];

export type Answer = { answer?: "yes" | "no" | null; comment?: string | null };
export type Answers = Partial<Record<Question, Answer>>;

export type PatientQuestionnaire = {
  id: Identifier;
  patient_id: Identifier;
  answers: Answers;
  /** YYYY-MM-DD */
  signed_at?: string | null;
  updated_by?: Identifier | null;
  updated_at?: string;
};

export type ConsentTemplate = {
  id: Identifier;
  name: string;
  body: string;
  is_archived: boolean;
  position: number;
  created_at?: string;
  updated_at?: string;
};

export type PatientConsent = {
  id: Identifier;
  patient_id: Identifier;
  template_id?: Identifier | null;
  title: string;
  body: string;
  /** YYYY-MM-DD */
  signed_at?: string | null;
  file_id?: Identifier | null;
  created_by?: Identifier | null;
  created_at: string;
};

/** The types of a patient file */
export const PATIENT_FILE_KINDS = [
  "opg",
  "ct",
  "periapical",
  "photo",
  "document",
  "consent",
] as const;
export type PatientFileKind = (typeof PATIENT_FILE_KINDS)[number];

export type PatientFile = {
  id: Identifier;
  patient_id: Identifier;
  path: string;
  name: string;
  size: number;
  mime: string;
  kind: PatientFileKind;
  /** YYYY-MM-DD */
  taken_at?: string | null;
  note?: string | null;
  sales_id?: Identifier | null;
  created_at: string;
  /** A file of a lab work order: impression, scan, photo (stage 40) */
  lab_order_id?: Identifier | null;
};
