import type { Identifier } from "ra-core";

import type { Deal, Patient, Stage } from "../types";
import type {
  MailingSegment,
  SegmentPatientStatus,
  SegmentPreview,
} from "./types";

/**
 * Segments of the mailings: the same rules as private.mailing_segment
 * (supabase/schemas/17_repeat_mailings.sql), for the demo data provider.
 */

export type SegmentPatient = Pick<
  Patient,
  | "id"
  | "first_name"
  | "last_name"
  | "phones"
  | "tags"
  | "source_id"
  | "sales_id"
  | "last_seen"
> & { messaging_opt_out?: boolean | null };

export type SegmentDeal = Pick<
  Deal,
  "id" | "patient_id" | "stage_id" | "service_id" | "visit_at" | "archived_at"
> & { closed_at?: string | null; updated_at?: string };

export type SegmentData = {
  patients: SegmentPatient[];
  deals: SegmentDeal[];
  stages: Pick<Stage, "id" | "kind">[];
  /** Patients with a messenger chat (they can be reached without a phone) */
  chatPatientIds: Identifier[];
};

const same = (a: Identifier | null | undefined, b: Identifier) =>
  a != null && String(a) === String(b);
const inList = (
  value: Identifier | null | undefined,
  list: Identifier[] | undefined,
) => !list?.length || list.some((item) => same(value, item));

/** Same as timestamp + make_interval(months => n) of Postgres (UTC) */
export const addMonths = (value: string | Date, months: number) => {
  const date = new Date(value);
  const day = date.getUTCDate();
  const result = new Date(date);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
};

/** Only the filters that filter: what is stored and sent to the database */
export const cleanSegment = (segment: MailingSegment): MailingSegment =>
  Object.fromEntries(
    Object.entries(segment).filter(([key, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (key === "tag_mode") return !!segment.tag_ids?.length;
      return value != null;
    }),
  ) as MailingSegment;

/** No filter at all: every patient of the clinic */
export const isEmptySegment = (segment: MailingSegment) =>
  !segment.tag_ids?.length &&
  !segment.service_ids?.length &&
  !segment.source_ids?.length &&
  !segment.sales_ids?.length &&
  segment.inactive_months == null &&
  segment.has_open_deal == null;

/**
 * Patients matching the segment, each with the reason it is left out
 * (opted_out, no_contact, duplicate: same first phone as a more recently
 * seen patient) or ok.
 */
export const classifySegment = (
  data: SegmentData,
  segment: MailingSegment,
  now = new Date(),
): { patient_id: Identifier; status: SegmentPatientStatus }[] => {
  const kind = new Map(data.stages.map((s) => [String(s.id), s.kind]));
  const dealsOf = new Map<string, SegmentDeal[]>();
  for (const deal of data.deals) {
    const key = String(deal.patient_id);
    dealsOf.set(key, [...(dealsOf.get(key) ?? []), deal]);
  }
  const chats = new Set(data.chatPatientIds.map(String));
  const tagIds = (segment.tag_ids ?? []).map(Number);

  const matched = data.patients.filter((patient) => {
    const deals = dealsOf.get(String(patient.id)) ?? [];
    const tags = (patient.tags ?? []).map(Number);
    if (tagIds.length) {
      const ok =
        segment.tag_mode === "all"
          ? tagIds.every((tag) => tags.includes(tag))
          : tagIds.some((tag) => tags.includes(tag));
      if (!ok) return false;
    }
    if (
      segment.service_ids?.length &&
      !deals.some(
        (deal) =>
          inList(deal.service_id, segment.service_ids) &&
          deal.service_id != null,
      )
    ) {
      return false;
    }
    if (
      segment.source_ids?.length &&
      !inList(patient.source_id, segment.source_ids)
    ) {
      return false;
    }
    if (
      segment.sales_ids?.length &&
      !inList(patient.sales_id, segment.sales_ids)
    ) {
      return false;
    }
    // Mailing to chosen deals (bulk action of the deal list): an empty
    // list matches nobody
    if (
      segment.deal_ids !== undefined &&
      !deals.some((deal) =>
        (segment.deal_ids ?? []).some((id) => same(deal.id, id)),
      )
    ) {
      return false;
    }
    if (segment.has_open_deal != null) {
      const hasOpen = deals.some(
        (deal) =>
          kind.get(String(deal.stage_id)) === "open" && !deal.archived_at,
      );
      if (hasOpen !== segment.has_open_deal) return false;
    }
    if (segment.inactive_months != null) {
      const moments = deals.flatMap((deal) => [
        ...(deal.visit_at ? [new Date(deal.visit_at).getTime()] : []),
        ...(kind.get(String(deal.stage_id)) === "won" && deal.closed_at
          ? [new Date(deal.closed_at).getTime()]
          : []),
      ]);
      if (!moments.length) return false;
      const limit = addMonths(now, -segment.inactive_months).getTime();
      if (!(Math.max(...moments) < limit)) return false;
    }
    return true;
  });

  const classified = matched.map((patient) => ({
    patient,
    excluded: patient.messaging_opt_out
      ? ("opted_out" as const)
      : !patient.phones?.length && !chats.has(String(patient.id))
        ? ("no_contact" as const)
        : null,
    key: patient.phones?.[0] ?? `patient:${patient.id}`,
  }));
  // Among the reachable patients, the most recently seen of a phone wins
  const winners = new Map<string, SegmentPatient>();
  for (const { patient, excluded, key } of classified) {
    if (excluded) continue;
    const current = winners.get(key);
    if (
      !current ||
      patient.last_seen > current.last_seen ||
      (patient.last_seen === current.last_seen &&
        Number(patient.id) > Number(current.id))
    ) {
      winners.set(key, patient);
    }
  }
  return classified.map(({ patient, excluded, key }) => ({
    patient_id: patient.id,
    status:
      excluded ??
      (winners.get(key)?.id === patient.id ? "ok" : ("duplicate" as const)),
  }));
};

/** Live count and preview of a segment. Same as public.mailing_segment_preview */
export const segmentPreview = (
  data: SegmentData,
  segment: MailingSegment,
  { now = new Date(), limit = 20 }: { now?: Date; limit?: number } = {},
): SegmentPreview => {
  const rows = classifySegment(data, segment, now);
  const count = (status: SegmentPatientStatus) =>
    rows.filter((row) => row.status === status).length;
  const byId = new Map(data.patients.map((p) => [String(p.id), p]));
  const patients = rows
    .filter((row) => row.status === "ok")
    .map((row) => byId.get(String(row.patient_id))!)
    .sort(
      (a, b) =>
        (a.last_name ?? "￿").localeCompare(b.last_name ?? "￿") ||
        (a.first_name ?? "").localeCompare(b.first_name ?? "") ||
        Number(a.id) - Number(b.id),
    )
    .slice(0, Math.max(limit, 0))
    .map((p) => ({
      id: p.id,
      first_name: p.first_name ?? null,
      last_name: p.last_name ?? null,
      phone: p.phones?.[0] ?? null,
    }));
  return {
    count: count("ok"),
    matched: rows.length,
    opted_out: count("opted_out"),
    no_contact: count("no_contact"),
    duplicates: count("duplicate"),
    patients,
  };
};
