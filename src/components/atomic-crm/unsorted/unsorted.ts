import type { Identifier } from "ra-core";

import type {
  Call,
  Deal,
  DealNote,
  Message,
  MessengerTransport,
  OrganizationSettings,
  Patient,
  Stage,
} from "../types";

/**
 * «Неразобранное» (stage 18): the rules of supabase/schemas/
 * 18_unsorted_duplicates.sql for the app and the demo provider. Keep both
 * in sync.
 */

/** List filters of the unsorted leads and of the board without them */
export const UNSORTED_FILTER = { "unsorted_at@not.is": null } as const;
export const SORTED_FILTER = { "unsorted_at@is": null } as const;

/** Where an unsorted lead came from, for its icon */
export type UnsortedChannel = MessengerTransport | "form" | "call";

/** A row of the view unsorted_leads */
export type UnsortedLead = {
  id: Identifier;
  patient_id: Identifier;
  pipeline_id: Identifier;
  stage_id: Identifier;
  source_id?: Identifier | null;
  sales_id?: Identifier | null;
  name?: string | null;
  unsorted_at: string;
  patient_first_name?: string | null;
  patient_last_name?: string | null;
  patient_phone?: string | null;
  channel: UnsortedChannel | null;
  first_text: string | null;
  first_at: string | null;
  nb_messages: number;
};

/** Same as private.unsorted_intake: when a new lead of this source waits */
export const unsortedIntake = (
  settings:
    | Pick<OrganizationSettings, "unsorted_enabled" | "unsorted_source_ids">
    | null
    | undefined,
  sourceId: Identifier | null | undefined,
  now = new Date(),
): string | null => {
  if (!settings?.unsorted_enabled) return null;
  const sources = settings.unsorted_source_ids ?? [];
  if (
    sources.length &&
    !sources.some((id) => sourceId != null && String(id) === String(sourceId))
  ) {
    return null;
  }
  return now.toISOString();
};

/**
 * Same as the lateral join of unsorted_leads: the first incoming message,
 * else the form of the request, else the incoming call (the earliest wins,
 * a message before a form before a call at the same time).
 */
export const firstLeadContact = ({
  messages,
  notes,
  calls,
}: {
  messages: Pick<Message, "direction" | "transport" | "text" | "sent_at">[];
  notes: Pick<DealNote, "type" | "text" | "date">[];
  calls: Pick<Call, "direction" | "called_at">[];
}): Pick<UnsortedLead, "channel" | "first_text" | "first_at"> => {
  const candidates = [
    ...messages
      .filter((m) => m.direction === "in")
      .map((m) => ({
        channel: m.transport as UnsortedChannel,
        first_text: m.text ?? null,
        first_at: m.sent_at,
        rank: 0,
      })),
    ...notes
      .filter((n) => n.type === "lead")
      .map((n) => ({
        channel: "form" as const,
        first_text: n.text ?? null,
        first_at: n.date,
        rank: 1,
      })),
    ...calls
      .filter((c) => c.direction === "in")
      .map((c) => ({
        channel: "call" as const,
        first_text: null,
        first_at: c.called_at,
        rank: 2,
      })),
  ].sort(
    (a, b) =>
      new Date(a.first_at).getTime() - new Date(b.first_at).getTime() ||
      a.rank - b.rank,
  );
  const first = candidates[0];
  return first
    ? {
        channel: first.channel,
        first_text: first.first_text,
        first_at: first.first_at,
      }
    : { channel: null, first_text: null, first_at: null };
};

/** Same as the view unsorted_leads, on in-memory rows (demo) */
export const unsortedLeads = ({
  deals,
  patients,
  messages,
  notes,
  calls,
}: {
  deals: Deal[];
  patients: Patient[];
  messages: Message[];
  notes: DealNote[];
  calls: Call[];
}): UnsortedLead[] => {
  const patientsById = new Map(patients.map((p) => [String(p.id), p]));
  return deals
    .filter((deal) => deal.unsorted_at)
    .map((deal) => {
      const patient = patientsById.get(String(deal.patient_id));
      const own = messages.filter((m) => m.deal_id === deal.id);
      return {
        id: deal.id,
        patient_id: deal.patient_id,
        pipeline_id: deal.pipeline_id,
        stage_id: deal.stage_id,
        source_id: deal.source_id ?? null,
        sales_id: deal.sales_id ?? null,
        name: deal.name ?? null,
        unsorted_at: deal.unsorted_at!,
        patient_first_name: patient?.first_name ?? null,
        patient_last_name: patient?.last_name ?? null,
        patient_phone: patient?.phones?.[0] ?? null,
        ...firstLeadContact({
          messages: own,
          notes: notes.filter((n) => n.deal_id === deal.id),
          calls: calls.filter((c) => c.deal_id === deal.id),
        }),
        nb_messages: own.filter((m) => m.direction === "in").length,
      };
    });
};

/**
 * What the card shows of the first contact: a message as is; of a website
 * form its comment (else the form without its title line).
 */
export const leadExcerpt = (
  lead: Pick<UnsortedLead, "channel" | "first_text">,
  max = 140,
): string => {
  let text = (lead.first_text ?? "").trim();
  if (lead.channel === "form" && text) {
    const lines = text.split("\n").map((line) => line.trim());
    const comment = lines.find((line) => /^Комментарий:/i.test(line));
    text = comment
      ? comment.replace(/^Комментарий:\s*/i, "")
      : lines.slice(1).join(" · ") || lines[0];
  }
  text = text.replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** Stage proposed by «Принять»: the first open stage of the pipeline */
export const defaultAcceptStage = (
  stages: Stage[],
  pipelineId: Identifier,
): Stage | undefined =>
  stages
    .filter(
      (stage) =>
        String(stage.pipeline_id) === String(pipelineId) &&
        stage.kind === "open",
    )
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))[0];

/** Open stages a lead can be accepted into, pipeline by pipeline */
export const acceptStageChoices = (
  stages: Stage[],
  pipelines: { id: Identifier; name: string; position: number }[],
) => {
  const several = pipelines.length > 1;
  return [...pipelines]
    .sort((a, b) => a.position - b.position)
    .flatMap((pipeline) =>
      stages
        .filter(
          (stage) =>
            String(stage.pipeline_id) === String(pipeline.id) &&
            stage.kind === "open",
        )
        .sort((a, b) => a.position - b.position)
        .map((stage) => ({
          id: stage.id,
          name: several ? `${pipeline.name} · ${stage.name}` : stage.name,
        })),
    );
};

/**
 * Deals a lead can be merged into (same as public.merge_unsorted): open, not
 * archived, not the lead itself; the lead's patient first, then the most
 * recently updated.
 */
export const mergeTargets = <
  T extends Pick<
    Deal,
    "id" | "patient_id" | "stage_id" | "archived_at" | "updated_at"
  > & { unsorted_at?: string | null },
>(
  deals: T[],
  stages: Pick<Stage, "id" | "kind">[],
  lead: Pick<Deal, "id" | "patient_id">,
): T[] => {
  const open = new Set(
    stages.filter((s) => s.kind === "open").map((s) => String(s.id)),
  );
  return deals
    .filter(
      (deal) =>
        deal.id !== lead.id &&
        !deal.archived_at &&
        open.has(String(deal.stage_id)),
    )
    .sort(
      (a, b) =>
        Number(String(b.patient_id) === String(lead.patient_id)) -
          Number(String(a.patient_id) === String(lead.patient_id)) ||
        (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    );
};

/** «5 мин», «2 ч», «3 дн»: how long the lead waits */
export const unsortedAge = (since: string, now = new Date()) => {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(since).getTime()) / 60_000),
  );
  if (minutes < 60) return { unit: "minutes" as const, value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours" as const, value: hours };
  return { unit: "days" as const, value: Math.floor(hours / 24) };
};
