import type { Identifier } from "ra-core";

import type { MessengerTransport, Patient } from "../types";

/**
 * Duplicate patients (stage 18): the rules of supabase/schemas/
 * 18_unsorted_duplicates.sql (private.patient_match_keys,
 * public.patient_duplicates, public.duplicate_groups, merge_patient_rows)
 * for the app and the demo provider. Keep both in sync.
 */

export type DuplicateReason = "phone" | "chat" | "name_birth";

/** Who a patient is in a messenger (table patient_chats) */
export type PatientChat = {
  patient_id: Identifier;
  transport: MessengerTransport;
  chat_id: string;
  username?: string | null;
};

type MatchPatient = Pick<
  Patient,
  | "id"
  | "first_name"
  | "last_name"
  | "middle_name"
  | "birth_date"
  | "phones"
  | "telegram"
  | "instagram"
>;

/** A row of public.patient_duplicates */
export type PatientDuplicate = {
  patient_id: Identifier;
  reasons: DuplicateReason[];
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  birth_date?: string | null;
  phones?: string[];
};

/** A row of public.duplicate_groups */
export type DuplicateGroupRow = PatientDuplicate & {
  group_id: Identifier;
  last_seen?: string | null;
  nb_deals: number;
};

export type DuplicateGroup = {
  id: Identifier;
  reasons: DuplicateReason[];
  patients: DuplicateGroupRow[];
};

/** Same as private.normalize_person_name: «Иванов  Иван Ёлкин» → «иванов иван елкин» */
export const normalizePersonName = (
  lastName?: string | null,
  firstName?: string | null,
  middleName?: string | null,
): string | null => {
  const name = [lastName, firstName, middleName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/ё/g, "е");
  return name || null;
};

const handle = (value?: string | null) =>
  value?.trim().replace(/^@+/, "").toLowerCase() || null;

/** Same as private.patient_match_keys, for one patient */
export const matchKeys = (
  patient: MatchPatient,
  chats: PatientChat[] = [],
): { kind: DuplicateReason; key: string }[] => {
  const keys: { kind: DuplicateReason; key: string }[] = [];
  for (const phone of patient.phones ?? []) {
    keys.push({ kind: "phone", key: phone });
  }
  if (patient.telegram?.trim()) {
    keys.push({
      kind: "chat",
      key: `tg:${patient.telegram.trim().toLowerCase()}`,
    });
  }
  if (patient.instagram?.trim()) {
    keys.push({
      kind: "chat",
      key: `ig:${patient.instagram.trim().toLowerCase()}`,
    });
  }
  for (const chat of chats) {
    if (String(chat.patient_id) !== String(patient.id)) continue;
    if (!["instagram", "telegram", "telegram_bot"].includes(chat.transport)) {
      continue;
    }
    const instagram = chat.transport === "instagram";
    keys.push({
      kind: "chat",
      key: `${instagram ? "igid" : "tgid"}:${chat.chat_id}`,
    });
    const username = handle(chat.username);
    if (username) {
      keys.push({
        kind: "chat",
        key: `${instagram ? "ig" : "tg"}:${username}`,
      });
    }
  }
  if (
    patient.birth_date &&
    patient.last_name?.trim() &&
    patient.first_name?.trim()
  ) {
    keys.push({
      kind: "name_birth",
      key: `${normalizePersonName(patient.last_name, patient.first_name, patient.middle_name)}|${patient.birth_date.slice(0, 10)}`,
    });
  }
  const seen = new Set<string>();
  return keys.filter(({ kind, key }) => {
    const id = `${kind}\u0000${key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const REASON_ORDER: DuplicateReason[] = ["chat", "name_birth", "phone"];
const sortReasons = (reasons: Iterable<DuplicateReason>) =>
  [...new Set(reasons)].sort(
    (a, b) => REASON_ORDER.indexOf(a) - REASON_ORDER.indexOf(b),
  );

/** Pairs of patients sharing a key, both ways, with what they share */
const sharedKeys = (patients: MatchPatient[], chats: PatientChat[]) => {
  const byKey = new Map<string, Identifier[]>();
  for (const patient of patients) {
    for (const { kind, key } of matchKeys(patient, chats)) {
      const id = `${kind}\u0000${key}`;
      byKey.set(id, [...(byKey.get(id) ?? []), patient.id]);
    }
  }
  const pairs = new Map<string, Map<string, Set<DuplicateReason>>>();
  for (const [id, owners] of byKey) {
    if (owners.length < 2) continue;
    const kind = id.split("\u0000")[0] as DuplicateReason;
    for (const a of owners) {
      for (const b of owners) {
        if (String(a) === String(b)) continue;
        const links = pairs.get(String(a)) ?? new Map();
        links.set(String(b), (links.get(String(b)) ?? new Set()).add(kind));
        pairs.set(String(a), links);
      }
    }
  }
  return pairs;
};

const duplicateRow = (
  patient: MatchPatient,
  reasons: Iterable<DuplicateReason>,
): PatientDuplicate => ({
  patient_id: patient.id,
  reasons: sortReasons(reasons),
  first_name: patient.first_name ?? null,
  last_name: patient.last_name ?? null,
  middle_name: patient.middle_name ?? null,
  birth_date: patient.birth_date ?? null,
  phones: patient.phones ?? [],
});

/** Same as public.patient_duplicates */
export const patientDuplicates = (
  patientId: Identifier,
  patients: MatchPatient[],
  chats: PatientChat[] = [],
): PatientDuplicate[] => {
  const links = sharedKeys(patients, chats).get(String(patientId));
  if (!links) return [];
  return patients
    .filter((patient) => links.has(String(patient.id)))
    .map((patient) => duplicateRow(patient, links.get(String(patient.id))!));
};

/** Same as public.duplicate_groups: connected patients, group id = smallest id */
export const duplicateGroupRows = (
  patients: (MatchPatient & { last_seen?: string | null })[],
  chats: PatientChat[] = [],
  dealCounts: Map<string, number> = new Map(),
): DuplicateGroupRow[] => {
  const pairs = sharedKeys(patients, chats);
  const byId = new Map(patients.map((p) => [String(p.id), p]));
  const groupOf = new Map<string, Identifier>();
  const rows: DuplicateGroupRow[] = [];
  const ids = [...pairs.keys()].sort((a, b) => Number(a) - Number(b));
  for (const start of ids) {
    if (groupOf.has(start)) continue;
    const members = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      for (const next of pairs.get(current)?.keys() ?? []) {
        if (!members.has(next)) {
          members.add(next);
          queue.push(next);
        }
      }
    }
    const sorted = [...members].sort((a, b) => Number(a) - Number(b));
    const groupId = byId.get(sorted[0])!.id;
    for (const member of sorted) {
      groupOf.set(member, groupId);
      const patient = byId.get(member)!;
      rows.push({
        ...duplicateRow(
          patient,
          [...pairs.get(member)!.values()].flatMap((s) => [...s]),
        ),
        group_id: groupId,
        last_seen: patient.last_seen ?? null,
        nb_deals: dealCounts.get(member) ?? 0,
      });
    }
  }
  return rows;
};

/** The rows of public.duplicate_groups gathered by group */
export const groupDuplicates = (
  rows: DuplicateGroupRow[],
): DuplicateGroup[] => {
  const groups = new Map<string, DuplicateGroup>();
  for (const row of rows) {
    const group = groups.get(String(row.group_id)) ?? {
      id: row.group_id,
      reasons: [],
      patients: [],
    };
    group.patients.push(row);
    group.reasons = sortReasons([...group.reasons, ...row.reasons]);
    groups.set(String(row.group_id), group);
  }
  return [...groups.values()];
};

/** Fields whose value the merge dialog lets the user pick */
export const MERGE_FIELDS = [
  "name",
  "birth_date",
  "source",
  "responsible",
  "comment",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeChoice = "keep" | "merge";
export type MergeChoices = Partial<Record<MergeField, MergeChoice>>;

type MergePatient = Pick<
  Patient,
  | "first_name"
  | "last_name"
  | "middle_name"
  | "birth_date"
  | "source_id"
  | "sales_id"
  | "background"
>;

/** The value of a field of the dialog, empty as null */
export const mergeFieldValue = (
  field: MergeField,
  patient: MergePatient,
): string | Identifier | null => {
  switch (field) {
    case "name":
      return (
        [patient.last_name, patient.first_name, patient.middle_name]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(" ") || null
      );
    case "birth_date":
      return patient.birth_date || null;
    case "source":
      return patient.source_id ?? null;
    case "responsible":
      return patient.sales_id ?? null;
    case "comment":
      return patient.background?.trim() || null;
  }
};

/** Same default as merge_patient_rows: the kept value unless it is empty */
export const defaultMergeChoices = (
  keep: MergePatient,
  merge: MergePatient,
): Record<MergeField, MergeChoice> =>
  Object.fromEntries(
    MERGE_FIELDS.map((field) => [
      field,
      mergeFieldValue(field, keep) == null &&
      mergeFieldValue(field, merge) != null
        ? "merge"
        : "keep",
    ]),
  ) as Record<MergeField, MergeChoice>;

/**
 * Which patient to keep by default: the one with more requests, else the
 * older one
 */
export const suggestKeep = <
  T extends { id: Identifier; nb_deals?: number; first_seen?: string },
>(
  a: T,
  b: T,
): [keep: T, merge: T] => {
  const score = (p: T) => p.nb_deals ?? 0;
  if (score(a) !== score(b)) return score(a) > score(b) ? [a, b] : [b, a];
  if (a.first_seen && b.first_seen && a.first_seen !== b.first_seen) {
    return a.first_seen < b.first_seen ? [a, b] : [b, a];
  }
  return Number(a.id) <= Number(b.id) ? [a, b] : [b, a];
};

/**
 * Same as the update of merge_patient_rows: the kept patient with the chosen
 * values, phones, tags and handles unioned, the other details completed.
 */
export const mergePatientRecords = <T extends Patient>(
  keep: T,
  merge: T,
  choices: MergeChoices = {},
): T => {
  const take = (field: MergeField) =>
    choices[field] === "merge" ||
    (choices[field] == null &&
      mergeFieldValue(field, keep) == null &&
      mergeFieldValue(field, merge) != null);
  const known = new Set(keep.phones ?? []);
  const extraPhones = (merge.phone_jsonb ?? []).filter(
    (phone) => !known.has(phone.number),
  );
  return {
    ...keep,
    first_name: take("name") ? merge.first_name : keep.first_name,
    last_name: take("name") ? merge.last_name : keep.last_name,
    middle_name: take("name") ? merge.middle_name : keep.middle_name,
    birth_date: take("birth_date") ? merge.birth_date : keep.birth_date,
    source_id: take("source") ? merge.source_id : keep.source_id,
    sales_id: take("responsible") ? merge.sales_id : keep.sales_id,
    background: take("comment") ? merge.background : keep.background,
    phone_jsonb: [...(keep.phone_jsonb ?? []), ...extraPhones],
    whatsapp: keep.whatsapp ?? merge.whatsapp ?? null,
    instagram: keep.instagram ?? merge.instagram ?? null,
    telegram: keep.telegram ?? merge.telegram ?? null,
    city: keep.city?.trim() ? keep.city : (merge.city ?? null),
    gender: keep.gender ?? merge.gender ?? null,
    avatar: keep.avatar ?? merge.avatar,
    status: keep.status ?? merge.status ?? null,
    tags: [
      ...(keep.tags ?? []),
      ...(merge.tags ?? []).filter((tag) => !(keep.tags ?? []).includes(tag)),
    ],
    first_seen:
      keep.first_seen < merge.first_seen ? keep.first_seen : merge.first_seen,
    last_seen:
      keep.last_seen > merge.last_seen ? keep.last_seen : merge.last_seen,
    messaging_opt_out: !!(keep.messaging_opt_out || merge.messaging_opt_out),
    messaging_opt_out_at:
      keep.messaging_opt_out_at ?? merge.messaging_opt_out_at ?? null,
  };
};

/** «Ахметов Даулет (#12)», as in the audit row of a merge */
export const patientLabel = (
  patient: Pick<Patient, "id" | "last_name" | "first_name" | "phones">,
) =>
  `${
    [patient.last_name, patient.first_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") ||
    patient.phones?.[0] ||
    "Пациент"
  } (#${patient.id})`;
