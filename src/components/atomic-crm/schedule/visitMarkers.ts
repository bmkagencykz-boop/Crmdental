import type { Visit, VisitStatus } from "./types";

/** Visits that count as the patient having come (or coming) to the clinic */
export const COUNTED_STATUSES: VisitStatus[] = [
  "scheduled",
  "confirmed",
  "arrived",
  "completed",
];

/**
 * «1В» (первичный визит): the earliest counted visit of a patient who has
 * none before the shown days. Missed and cancelled visits do not count, so
 * the next one is still the first.
 */
export const firstVisitIds = (
  visits: Pick<Visit, "id" | "patient_id" | "starts_at" | "status">[],
  earlier: Pick<Visit, "patient_id">[],
) => {
  const seen = new Set(earlier.map((visit) => String(visit.patient_id)));
  const first = new Set<string>();
  [...visits]
    .filter((visit) => COUNTED_STATUSES.includes(visit.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .forEach((visit) => {
      const patient = String(visit.patient_id);
      if (seen.has(patient)) return;
      seen.add(patient);
      first.add(String(visit.id));
    });
  return first;
};
