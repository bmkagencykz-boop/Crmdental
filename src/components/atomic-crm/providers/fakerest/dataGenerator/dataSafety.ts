import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Data safety of the demo (stage 41): every patient has a card number (the
 * existing ones keep the number their card showed: the CRM id), and two
 * patients who never came for treatment are in the archive.
 */
export const generateDataSafety = (db: Db) => {
  db.patients = db.patients.map((patient) => ({
    ...patient,
    card_number: patient.card_number || String(patient.id),
    archived_at: patient.archived_at ?? null,
    archived_by: patient.archived_by ?? null,
  }));

  const owner = db.sales.find((sale) => sale.role === "owner");
  // Patients without money nor anything medical, those without a deal first
  const history = new Set(
    [
      ...(db.account_operations ?? []),
      ...(db.visits ?? []),
      ...(db.treatment_plans ?? []),
      ...(db.patient_teeth ?? []),
      ...(db.visit_records ?? []),
      ...(db.patient_files ?? []),
      ...(db.lab_orders ?? []),
    ].map((row) => String(row.patient_id)),
  );
  const withDeals = new Set(db.deals.map((deal) => String(deal.patient_id)));
  const archived = db.patients
    .filter((patient) => !history.has(String(patient.id)))
    .sort(
      (a, b) =>
        Number(withDeals.has(String(a.id))) -
        Number(withDeals.has(String(b.id))),
    )
    .slice(0, 2);
  db.patients = db.patients.map((patient, index) =>
    archived.includes(patient)
      ? {
          ...patient,
          archived_at: new Date(Date.now() - (40 + index) * DAY).toISOString(),
          archived_by: owner?.id ?? null,
        }
      : patient,
  );
};
