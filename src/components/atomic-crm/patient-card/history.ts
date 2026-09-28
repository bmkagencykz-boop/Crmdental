import type { Identifier } from "ra-core";

import type { AccountOperation } from "../payments/types";
import type { Visit } from "../schedule/types";
import type { TreatmentPlan } from "../treatment/types";
import type { Call, Deal, DealFile, Message } from "../types";
import type {
  PatientConsent,
  PatientFile,
  ToothHistoryRow,
  VisitRecord,
} from "./types";

/**
 * «История» of the patient card (stage 37): everything that happened to the
 * patient on one timeline, newest first — deals, the conversation (a
 * summary per day and channel, not every message), calls, visits and their
 * records, payments, treatment plans, files, changes of the dental chart,
 * consents. Built from the lists the card already reads.
 */

export type HistoryKind =
  | "deal"
  | "messages"
  | "call"
  | "visit"
  | "record"
  | "payment"
  | "plan"
  | "file"
  | "tooth"
  | "consent";

export type HistoryEvent = {
  /** Unique: kind + id */
  key: string;
  kind: HistoryKind;
  /** ISO time the event is sorted by */
  at: string;
  /** Data of the event, formatted by the screen */
  data: Record<string, unknown>;
  dealId?: Identifier | null;
};

export type HistorySources = {
  deals?: Pick<Deal, "id" | "name" | "created_at" | "stage_id">[];
  messages?: Pick<
    Message,
    "id" | "deal_id" | "direction" | "sent_at" | "transport"
  >[];
  calls?: Pick<
    Call & { id: Identifier },
    "id" | "deal_id" | "direction" | "called_at" | "duration_seconds" | "status"
  >[];
  visits?: Pick<
    Visit,
    | "id"
    | "deal_id"
    | "starts_at"
    | "status"
    | "doctor_id"
    | "service_id"
    | "source"
  >[];
  records?: Pick<
    VisitRecord,
    | "id"
    | "deal_id"
    | "record_date"
    | "created_at"
    | "diagnosis_codes"
    | "diagnosis"
    | "visit_id"
  >[];
  operations?: Pick<
    AccountOperation,
    "id" | "deal_id" | "occurred_at" | "kind" | "amount" | "method"
  >[];
  plans?: Pick<
    TreatmentPlan,
    "id" | "deal_id" | "name" | "status" | "created_at" | "agreed_at"
  >[];
  dealFiles?: Pick<
    DealFile,
    "id" | "deal_id" | "name" | "created_at" | "message_id"
  >[];
  patientFiles?: Pick<PatientFile, "id" | "name" | "kind" | "created_at">[];
  teeth?: ToothHistoryRow[];
  consents?: Pick<
    PatientConsent,
    "id" | "title" | "created_at" | "signed_at"
  >[];
};

const dayOf = (at: string) => {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Messages of a day in a channel: one event, at the last message */
const messageDays = (messages: HistorySources["messages"] = []) => {
  const groups = new Map<
    string,
    {
      dealId: Identifier;
      transport: string;
      incoming: number;
      outgoing: number;
      last: string;
    }
  >();
  for (const message of messages) {
    const key = `${message.deal_id}:${message.transport}:${dayOf(message.sent_at)}`;
    const group = groups.get(key) ?? {
      dealId: message.deal_id,
      transport: message.transport,
      incoming: 0,
      outgoing: 0,
      last: message.sent_at,
    };
    if (message.direction === "in") group.incoming++;
    else group.outgoing++;
    if (message.sent_at > group.last) group.last = message.sent_at;
    groups.set(key, group);
  }
  return [...groups.entries()].map(
    ([key, group]): HistoryEvent => ({
      key: `messages:${key}`,
      kind: "messages",
      at: group.last,
      dealId: group.dealId,
      data: {
        transport: group.transport,
        incoming: group.incoming,
        outgoing: group.outgoing,
        count: group.incoming + group.outgoing,
      },
    }),
  );
};

/** The noon of a day, so that a dated record sits inside its day */
const noon = (day: string) => `${day}T12:00:00`;

export const buildPatientHistory = (
  sources: HistorySources,
): HistoryEvent[] => {
  const events: HistoryEvent[] = [];
  for (const deal of sources.deals ?? []) {
    events.push({
      key: `deal:${deal.id}`,
      kind: "deal",
      at: deal.created_at,
      dealId: deal.id,
      data: { name: deal.name, stage_id: deal.stage_id },
    });
  }
  events.push(...messageDays(sources.messages));
  for (const call of sources.calls ?? []) {
    events.push({
      key: `call:${call.id}`,
      kind: "call",
      at: call.called_at,
      dealId: call.deal_id,
      data: {
        direction: call.direction,
        duration: call.duration_seconds,
        status: call.status,
      },
    });
  }
  for (const visit of sources.visits ?? []) {
    events.push({
      key: `visit:${visit.id}`,
      kind: "visit",
      at: visit.starts_at,
      dealId: visit.deal_id,
      data: {
        status: visit.status,
        doctor_id: visit.doctor_id,
        service_id: visit.service_id,
        source: visit.source,
      },
    });
  }
  for (const record of sources.records ?? []) {
    events.push({
      key: `record:${record.id}`,
      kind: "record",
      at: record.record_date
        ? noon(record.record_date)
        : (record.created_at ?? ""),
      dealId: record.deal_id,
      data: {
        codes: record.diagnosis_codes ?? [],
        diagnosis: record.diagnosis,
        visit_id: record.visit_id,
      },
    });
  }
  for (const operation of sources.operations ?? []) {
    events.push({
      key: `payment:${operation.id}`,
      kind: "payment",
      at: operation.occurred_at,
      dealId: operation.deal_id,
      data: {
        kind: operation.kind,
        amount: operation.amount,
        method: operation.method,
      },
    });
  }
  for (const plan of sources.plans ?? []) {
    events.push({
      key: `plan:${plan.id}`,
      kind: "plan",
      at: plan.created_at,
      dealId: plan.deal_id,
      data: {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        event: "created",
      },
    });
    if (plan.agreed_at) {
      events.push({
        key: `plan-agreed:${plan.id}`,
        kind: "plan",
        at: plan.agreed_at,
        dealId: plan.deal_id,
        data: {
          id: plan.id,
          name: plan.name,
          status: plan.status,
          event: "agreed",
        },
      });
    }
  }
  // Files of the chat are in the conversation already
  for (const file of sources.dealFiles ?? []) {
    if (file.message_id != null) continue;
    events.push({
      key: `deal-file:${file.id}`,
      kind: "file",
      at: file.created_at,
      dealId: file.deal_id,
      data: { name: file.name, kind: null },
    });
  }
  for (const file of sources.patientFiles ?? []) {
    events.push({
      key: `patient-file:${file.id}`,
      kind: "file",
      at: file.created_at,
      data: { name: file.name, kind: file.kind },
    });
  }
  for (const change of sources.teeth ?? []) {
    events.push({
      key: `tooth:${change.id}`,
      kind: "tooth",
      at: change.created_at,
      data: {
        tooth: change.tooth,
        state_before: change.state_before,
        state: change.state,
        note: change.note,
        source: change.source,
      },
    });
  }
  for (const consent of sources.consents ?? []) {
    events.push({
      key: `consent:${consent.id}`,
      kind: "consent",
      at: consent.signed_at ? noon(consent.signed_at) : consent.created_at,
      data: { title: consent.title, signed_at: consent.signed_at },
    });
  }
  return events
    .filter((event) => !!event.at)
    .sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key));
};

/** Events of a kind only, or all */
export const filterHistory = (
  events: HistoryEvent[],
  kinds: HistoryKind[] | null,
) =>
  kinds?.length ? events.filter((event) => kinds.includes(event.kind)) : events;

/** Consecutive events grouped by their day: [["2026-09-28", [...]], …] */
export const groupByDay = (events: HistoryEvent[]) => {
  const groups: [string, HistoryEvent[]][] = [];
  for (const event of events) {
    const day = dayOf(event.at);
    const last = groups.at(-1);
    if (last && last[0] === day) last[1].push(event);
    else groups.push([day, [event]]);
  }
  return groups;
};
