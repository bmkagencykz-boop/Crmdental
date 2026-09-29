import type { Identifier } from "ra-core";

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

/** An order of the lab behind a visit: «Лаб» (stage 43) */
export type LabMarker = { number: number; status: "fitting" | "ready" };

/**
 * «Лаб»: the visit is the fitting visit of an order, or its patient has an
 * order waiting for a fitting or ready to be given (the fitting visit
 * first, then the lowest number)
 */
export const labMarkers = (
  visits: Pick<Visit, "id" | "patient_id">[],
  orders: Array<{
    number: number;
    status: string;
    patient_id: Identifier;
    fitting_visit_id?: Identifier | null;
  }>,
) => {
  const markers = new Map<string, LabMarker>();
  const open = orders
    .filter((order) => order.status === "fitting" || order.status === "ready")
    .sort((a, b) => a.number - b.number);
  for (const visit of visits) {
    const own = open.filter(
      (order) => String(order.patient_id) === String(visit.patient_id),
    );
    const order =
      own.find(
        (o) =>
          o.fitting_visit_id != null &&
          String(o.fitting_visit_id) === String(visit.id),
      ) ?? own[0];
    if (order) {
      markers.set(String(visit.id), {
        number: order.number,
        status: order.status as LabMarker["status"],
      });
    }
  }
  return markers;
};
