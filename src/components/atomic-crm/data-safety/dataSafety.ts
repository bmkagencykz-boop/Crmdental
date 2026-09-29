import type { Identifier } from "ra-core";

/**
 * Data safety (stage 41): the rules of supabase/schemas/41_data_safety.sql
 * that the app and the demo provider share — the patient archive filter,
 * the paths of the note attachments in the private bucket, the lock of the
 * operations of a closed cash shift, what keeps a patient from being
 * deleted, the card numbers.
 */

/** Filter of the patient list: true = the archive, "all" = everybody */
export const ARCHIVED_FILTER = "archived";

type WithFilter = { filter?: Record<string, any> };

/**
 * The archive filter as PostgREST filters: archived patients stay out of
 * the lists, the search and the pickers unless the «Архив» filter asks.
 */
export const applyArchivedFilter = <P extends WithFilter>(params: P): P => {
  const { [ARCHIVED_FILTER]: archived, ...filter } = params.filter ?? {};
  if (archived === "all") return { ...params, filter };
  if (archived === true || archived === "true") {
    return { ...params, filter: { ...filter, "archived_at@not.is": null } };
  }
  if (
    Object.keys(filter).some((key) => key.startsWith("archived_at")) ||
    filter.id != null
  ) {
    return { ...params, filter };
  }
  return { ...params, filter: { ...filter, "archived_at@is": null } };
};

export const isArchived = (patient?: { archived_at?: string | null } | null) =>
  !!patient?.archived_at;

// --- note attachments in the private bucket ------------------------------

type StoredFile = { path?: string | null; src?: string | null };

/**
 * The object name of a stored file: its path, else read from its URL — a
 * public URL of the time the bucket was public
 * (…/storage/v1/object/public/<bucket>/<path>) or a signed one
 * (…/object/sign/<bucket>/<path>?token=…). Null for a file elsewhere.
 */
export const attachmentPath = (
  file: StoredFile | null | undefined,
  bucket: string,
): string | null => {
  if (!file) return null;
  if (file.path) return file.path.replace(/^\/+/, "");
  if (!file.src) return null;
  const match = file.src.match(
    new RegExp(
      `/object/(?:public|sign|authenticated)/${escape(bucket)}/([^?#]+)`,
    ),
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A signed URL (…/object/sign/…?token=…) expires: never stored */
export const isSignedUrl = (src?: string | null) =>
  !!src && /\/object\/sign\//.test(src);

// --- closed cash shifts ----------------------------------------------------

type ShiftRef = { id: Identifier; closed_at?: string | null };

/** An operation of a closed shift is neither changed nor cancelled */
export const operationLocked = (
  op: { shift_id?: Identifier | null } | null | undefined,
  shifts: ShiftRef[],
) =>
  op?.shift_id != null &&
  shifts.some(
    (shift) => String(shift.id) === String(op.shift_id) && !!shift.closed_at,
  );

/** The fields of an operation that may change in a closed shift (links) */
export const RELINK_FIELDS = [
  "patient_id",
  "deal_id",
  "plan_id",
  "visit_id",
  "branch_id",
];

export const SHIFT_CLOSED_MESSAGE =
  "Смена закрыта: операцию нельзя изменить или отменить. Проведите корректировку";

// --- deletion of patients and deals ----------------------------------------

type PatientRows = Partial<
  Record<
    | "account_operations"
    | "deal_payments"
    | "visits"
    | "visit_records"
    | "treatment_plans"
    | "patient_teeth"
    | "patient_tooth_history"
    | "patient_questionnaires"
    | "patient_consents"
    | "patient_files"
    | "lab_orders",
    { patient_id?: Identifier | null; deal_id?: Identifier | null }[]
  >
>;

/**
 * Money, visits or medical rows of a patient (private.patient_has_history):
 * such a patient is archived, never deleted. Deal payments count through
 * the deals of the patient (dealIds).
 */
export const patientHasHistory = (
  patientId: Identifier,
  rows: PatientRows,
  dealIds: Identifier[] = [],
) => {
  const mine = (row: { patient_id?: Identifier | null }) =>
    String(row.patient_id) === String(patientId);
  const deals = new Set(dealIds.map(String));
  return (
    Object.entries(rows).some(
      ([table, list]) => table !== "deal_payments" && (list ?? []).some(mine),
    ) ||
    (rows.deal_payments ?? []).some((row) => deals.has(String(row.deal_id)))
  );
};

export const PATIENT_DELETE_OWNER_ONLY =
  "Удалить пациента насовсем может только владелец. Переместите пациента в архив";
export const PATIENT_HAS_HISTORY =
  "У пациента есть оплаты, визиты или медицинские записи — удалить его нельзя. Переместите пациента в архив";
export const DEAL_HAS_PAYMENTS =
  "По сделке есть оплаты — удалить её нельзя. Переместите сделку в архив";

// --- card numbers -----------------------------------------------------------

/**
 * The next card number of a clinic (private.next_card_number): after the
 * counter, skipping the numbers in use. Returns the number and the new
 * counter.
 */
export const nextCardNumber = (
  counter: number,
  numbersInUse: (string | null | undefined)[],
): { number: string; counter: number } => {
  const used = new Set(numbersInUse.filter(Boolean) as string[]);
  let next = counter + 1;
  while (used.has(String(next))) next += 1;
  return { number: String(next), counter: next };
};

/** The counter of a clinic that never had one: its highest numeric card number */
export const cardCounterStart = (numbers: (string | null | undefined)[]) =>
  Math.max(
    0,
    ...numbers
      .filter((value): value is string => !!value && /^\d{1,15}$/.test(value))
      .map(Number),
  );
