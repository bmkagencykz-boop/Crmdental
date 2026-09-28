import type { Visit } from "../schedule/types";
import {
  QUESTIONS,
  RECORD_FIELDS,
  type Answers,
  type RecordField,
  type VisitRecordTemplate,
} from "./types";
import type { Identifier } from "ra-core";

/**
 * Pure rules of the patient card screens (stage 37): the tabs, «1В», the
 * alerts of the questionnaire, the templates of the visit records.
 */

/** «1В»: the patient has never come (no visit arrived or completed) */
export const neverCame = (visits: Pick<Visit, "status">[]) =>
  !visits.some((visit) => ["arrived", "completed"].includes(visit.status));

/** The «yes» answers: what the doctor must see first */
export const questionnaireAlerts = (answers: Answers | undefined) =>
  QUESTIONS.filter((question) => answers?.[question]?.answer === "yes");

export const PATIENT_TABS = [
  "overview",
  "chart",
  "visits",
  "plans",
  "account",
  "files",
  "questionnaire",
  "history",
] as const;
export type PatientTab = (typeof PATIENT_TABS)[number];

export type Draft = Partial<Record<RecordField, string>> & {
  doctor_id: Identifier | null;
  record_date: string;
  diagnosis_codes: string[];
};

/** Adds a template's texts: empty fields take them, filled ones keep theirs */
export const applyTemplate = (
  draft: Draft,
  template: Pick<VisitRecordTemplate, "content" | "diagnosis_codes">,
): Draft => {
  const next: Draft = { ...draft };
  for (const field of RECORD_FIELDS) {
    const text = template.content[field]?.trim();
    if (!text) continue;
    const own = draft[field]?.trim();
    next[field] = own ? (own.includes(text) ? own : `${own}\n${text}`) : text;
  }
  next.diagnosis_codes = [
    ...new Set([...draft.diagnosis_codes, ...(template.diagnosis_codes ?? [])]),
  ];
  return next;
};
