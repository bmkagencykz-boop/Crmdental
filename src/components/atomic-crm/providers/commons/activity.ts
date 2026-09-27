import type { DataProvider } from "ra-core";

import {
  DEAL_CREATED,
  DEAL_NOTE_CREATED,
  PATIENT_CREATED,
  PATIENT_NOTE_CREATED,
} from "../../consts";
import type {
  Activity,
  Deal,
  DealNote,
  Patient,
  PatientNote,
} from "../../types";

const all = {
  pagination: { page: 1, perPage: 10_000 },
  sort: { field: "id", order: "ASC" as const },
  filter: {},
};

/**
 * Activity feed built in the browser (demo provider). The Supabase provider
 * reads the activity_log view instead.
 */
export async function getActivityLog(dataProvider: DataProvider) {
  const [patients, patientNotes, deals, dealNotes] = await Promise.all([
    dataProvider.getList<Patient>("patients", all),
    dataProvider.getList<PatientNote>("patient_notes", all),
    dataProvider.getList<Deal>("deals", all),
    dataProvider.getList<DealNote>("deal_notes", all),
  ]);
  const dealsById = new Map(deals.data.map((deal) => [deal.id, deal]));

  const activities: Activity[] = [
    ...patients.data.map((patient) => ({
      id: `patient.${patient.id}.created`,
      type: PATIENT_CREATED,
      date: patient.first_seen,
      patient_id: patient.id,
      sales_id: patient.sales_id ?? undefined,
      patient,
    })),
    ...patientNotes.data.map((note) => ({
      id: `patientNote.${note.id}.created`,
      type: PATIENT_NOTE_CREATED,
      date: note.date,
      patient_id: note.patient_id,
      sales_id: note.sales_id,
      patientNote: note,
    })),
    ...deals.data.map((deal) => ({
      id: `deal.${deal.id}.created`,
      type: DEAL_CREATED,
      date: deal.created_at,
      patient_id: deal.patient_id,
      sales_id: deal.sales_id ?? undefined,
      deal,
    })),
    ...dealNotes.data.map((note) => ({
      id: `dealNote.${note.id}.created`,
      type: DEAL_NOTE_CREATED,
      date: note.date,
      patient_id: dealsById.get(note.deal_id)?.patient_id,
      sales_id: note.sales_id,
      dealNote: note,
    })),
  ] as Activity[];

  return activities.sort(
    (a, b) => new Date(b.date).valueOf() - new Date(a.date).valueOf(),
  );
}
