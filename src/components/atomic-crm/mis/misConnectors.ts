import type { Identifier } from "ra-core";

import type { Stage } from "../types";
import type {
  MisConnection,
  MisKind,
  MisStatus,
  MisStatusMap,
  MisStatusTarget,
} from "./types";

export const MIS_KINDS: MisKind[] = ["dentist_plus", "macdent"];

/** Statuses in the order of the mapping table */
export const MIS_STATUSES: MisStatus[] = [
  "scheduled",
  "confirmed",
  "arrived",
  "completed",
  "in_treatment",
  "cancelled",
  "no_show",
];

/** Suggested API address; the vendors did not publish theirs (уточнить) */
export const DEFAULT_BASE_URLS: Record<MisKind, string> = {
  dentist_plus: "https://api.dentist-plus.com/v1",
  macdent: "https://app.macdent.kz/api/v1",
};

export const isMisKind = (value: unknown): value is MisKind =>
  MIS_KINDS.includes(value as MisKind);

/** Address of the mis_webhook edge function for the clinic's MIS */
export const misWebhookUrl = (
  functionsUrl: string,
  kind: MisKind,
  token: string,
) =>
  `${functionsUrl.replace(/\/+$/, "")}/mis_webhook?kind=${kind}&token=${encodeURIComponent(token)}`;

/** The connection counts as connected: a key and no switch-off */
export const isMisConnected = (
  connection: Pick<MisConnection, "status"> | null | undefined,
) => connection?.status === "connected" || connection?.status === "error";

/** Value of a row of the mapping table: "stage:<id>", "tag:<id>" or "" */
export const targetValue = (target?: MisStatusTarget) =>
  target?.stage_id != null
    ? `stage:${target.stage_id}`
    : target?.tag_id != null
      ? `tag:${target.tag_id}`
      : "";

export const parseTargetValue = (value: string): MisStatusTarget | null => {
  const [type, id] = value.split(":");
  if (!id) return null;
  const numeric = Number(id);
  const parsed: Identifier = Number.isFinite(numeric) ? numeric : id;
  return type === "stage"
    ? { stage_id: parsed }
    : type === "tag"
      ? { tag_id: parsed }
      : null;
};

/** The mapping with one status changed ("" removes it) */
export const withTarget = (
  map: MisStatusMap,
  status: MisStatus,
  value: string,
): MisStatusMap => {
  const next: MisStatusMap = { ...map };
  const target = parseTargetValue(value);
  if (target) next[status] = target;
  else delete next[status];
  return next;
};

/**
 * Stages a status may move a deal to: every stage but the refusals (a
 * refusal needs a reason, the database refuses it as the digital pipeline
 * does), in board order.
 */
export const mappableStages = (stages: Stage[]) =>
  stages
    .filter((stage) => stage.kind !== "lost")
    .sort(
      (a, b) =>
        String(a.pipeline_id).localeCompare(String(b.pipeline_id)) ||
        a.position - b.position,
    );

/**
 * Default mapping of the clinic template, as the database fills it for a
 * new connection (private.mis_default_status_map)
 */
export const defaultStatusMap = (stages: Stage[]): MisStatusMap => {
  const byName = (name: string) =>
    stages.find((stage) => stage.name === name && stage.kind !== "lost")?.id;
  const map: MisStatusMap = {};
  const put = (status: MisStatus, name: string) => {
    const id = byName(name);
    if (id != null) map[status] = { stage_id: id };
  };
  put("scheduled", "Записан");
  put("confirmed", "Записан");
  put("arrived", "Пришёл на консультацию");
  put("completed", "Пришёл на консультацию");
  put("in_treatment", "В лечении");
  return map;
};

/** Key of the result badge of a log line */
export const logResultKey = (result: "ok" | "skipped" | "error") =>
  `mis_connectors.log.results.${result}`;

/** Key of the operation of a log line, with a fallback for new ones */
export const LOG_OPERATIONS = [
  "patient",
  "appointment",
  "visit",
  "payment",
  "stage",
  "poll",
  "push",
  "test",
  "webhook",
] as const;
export const logOperationKey = (operation: string) =>
  (LOG_OPERATIONS as readonly string[]).includes(operation)
    ? `mis_connectors.log.operations.${operation}`
    : null;
