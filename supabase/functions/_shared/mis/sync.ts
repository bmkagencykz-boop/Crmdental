/**
 * What the MIS edge functions do, without Deno: apply vendor records through
 * the SQL functions, poll the changes of a connection, test the key, push an
 * appointment of the queue. The database client (rpc) and fetch are
 * parameters, so all of it is unit tested.
 */

import type {
  Connection,
  HttpRequest,
  MisAdapter,
  MisResource,
} from "./adapter.ts";
import { dentistPlus } from "./dentistPlus.ts";
import { macdent } from "./macdent.ts";
import type { MisItem, MisKind } from "./normalize.ts";

export const ADAPTERS: Record<MisKind, MisAdapter> = {
  dentist_plus: dentistPlus,
  macdent,
};

export const isMisKind = (value: unknown): value is MisKind =>
  value === "dentist_plus" || value === "macdent";

export type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const FUNCTIONS: Record<MisItem["type"], string> = {
  patient: "mis_upsert_patient",
  appointment: "mis_upsert_appointment",
  payment: "mis_upsert_payment",
  visit: "mis_visit_completed",
};

const ARGUMENT: Record<MisItem["type"], string> = {
  patient: "patient",
  appointment: "appt",
  payment: "payment",
  visit: "visit",
};

export type ApplyResult = {
  processed: number;
  errors: number;
  skipped: number;
};

/**
 * Records in order (patients before their appointments before payments):
 * each goes through its SQL function, which logs it. Errors of one record
 * do not stop the others.
 */
export const applyItems = async (
  rpc: Rpc,
  connectionId: number,
  items: MisItem[],
): Promise<ApplyResult> => {
  const order: MisItem["type"][] = [
    "patient",
    "appointment",
    "visit",
    "payment",
  ];
  const sorted = [...items].sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
  );
  const result: ApplyResult = { processed: 0, errors: 0, skipped: 0 };
  for (const item of sorted) {
    const { data, error } = await rpc(FUNCTIONS[item.type], {
      connection: connectionId,
      [ARGUMENT[item.type]]: item.data,
    });
    const outcome = (data as { result?: string } | null)?.result;
    if (error || outcome === "error") result.errors++;
    else if (outcome === "skipped") result.skipped++;
    else result.processed++;
  }
  return result;
};

export class MisHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Human text of a failed call, for the log of the settings */
export const describeHttpError = (status: number, body: string) => {
  const hint =
    status === 401 || status === 403
      ? "ключ API не принят"
      : status === 404
        ? "адрес API не найден — проверьте адрес и пути в документации вендора"
        : status === 429
          ? "слишком много запросов"
          : status >= 500
            ? "ошибка на стороне МИС"
            : "запрос отклонён";
  const detail = body.replace(/\s+/g, " ").trim().slice(0, 200);
  return `HTTP ${status}: ${hint}${detail ? ` (${detail})` : ""}`;
};

export const call = async (fetchFn: Fetch, request: HttpRequest) => {
  let response: Response;
  try {
    response = await fetchFn(request.url, request.init);
  } catch (error) {
    throw new MisHttpError(
      `МИС недоступна: ${(error as Error)?.message ?? String(error)}`,
    );
  }
  const body = await response.text();
  if (!response.ok) {
    throw new MisHttpError(
      describeHttpError(response.status, body),
      response.status,
    );
  }
  try {
    return body.trim() ? JSON.parse(body) : {};
  } catch {
    throw new MisHttpError("МИС ответила не JSON");
  }
};

/** «Проверить подключение»: an authenticated request with the key */
export const testConnection = async (
  adapter: MisAdapter,
  connection: Connection,
  fetchFn: Fetch,
): Promise<{ ok: boolean; message: string }> => {
  if (!connection.api_key) return { ok: false, message: "Не указан ключ API" };
  try {
    const json = await call(fetchFn, adapter.pingRequest(connection));
    const count = adapter.listItems(json).length;
    return {
      ok: true,
      message: `${adapter.config.label} ответила${count ? `, записей в ответе: ${count}` : ""}`,
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
};

const RESOURCES: Array<[MisResource, MisItem["type"]]> = [
  ["patients", "patient"],
  ["appointments", "appointment"],
  ["payments", "payment"],
];

/**
 * Polls the changes since the cursor (patients, appointments, payments,
 * page by page) and applies them. The new cursor is the start of this run,
 * so nothing changed during it is missed (the SQL functions are
 * idempotent). A failed request stops the run and keeps the old cursor.
 */
export const pollConnection = async ({
  adapter,
  connection,
  cursor,
  rpc,
  fetchFn,
  now = new Date(),
  directions = { patients: true, appointments: true, payments: true },
}: {
  adapter: MisAdapter;
  connection: Connection;
  cursor: string | null;
  rpc: Rpc;
  fetchFn: Fetch;
  now?: Date;
  directions?: Record<MisResource, boolean>;
}): Promise<{
  ok: boolean;
  message: string;
  cursor: string | null;
  result: ApplyResult;
}> => {
  const total: ApplyResult = { processed: 0, errors: 0, skipped: 0 };
  try {
    for (const [resource, type] of RESOURCES) {
      if (!directions[resource]) continue;
      for (let page = 1; page <= adapter.config.maxPages; page++) {
        const json = await call(
          fetchFn,
          adapter.listRequest(connection, resource, cursor, page),
        );
        const records = adapter.listItems(json);
        const items: MisItem[] = [];
        for (const record of records) {
          if (type === "patient") {
            const data = adapter.mapPatient(record);
            if (data) items.push({ type, data });
          } else if (type === "payment") {
            const data = adapter.mapPayment(record);
            if (data) items.push({ type, data });
          } else {
            const data = adapter.mapAppointment(record);
            if (data) items.push({ type: "appointment", data });
          }
        }
        const applied = await applyItems(rpc, connection.id, items);
        total.processed += applied.processed;
        total.errors += applied.errors;
        total.skipped += applied.skipped;
        if (records.length < adapter.config.perPage) break;
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: (error as Error).message,
      cursor: null,
      result: total,
    };
  }
  return {
    ok: true,
    message: summary(total),
    cursor: now.toISOString(),
    result: total,
  };
};

export const summary = (result: ApplyResult) =>
  `Принято: ${result.processed}, без изменений: ${result.skipped}, ошибок: ${result.errors}`;

export type OutboxRow = {
  id: number;
  kind: MisKind;
  connection_id: number;
  base_url: string | null;
  api_key: string | null;
  settings: Record<string, unknown> | null;
  deal_id: number;
  payload: {
    deal_id: number;
    patient: Record<string, unknown> & { external_id?: string | null };
    appointment: Record<string, unknown>;
  };
  attempts: number;
};

/**
 * One appointment of the queue: the patient is created in the MIS when it
 * has no MIS id yet, then the appointment. Returns the ids the MIS gave.
 */
export const pushAppointment = async (
  adapter: MisAdapter,
  row: OutboxRow,
  fetchFn: Fetch,
): Promise<
  | {
      ok: true;
      result: {
        patient_external_id: string;
        appointment_external_id: string | null;
      };
    }
  | { ok: false; error: string }
> => {
  const connection: Connection = {
    id: row.connection_id,
    kind: row.kind,
    base_url: row.base_url,
    api_key: row.api_key,
    settings: row.settings,
  };
  try {
    let patientId = row.payload.patient.external_id ?? null;
    if (!patientId) {
      const created = await call(
        fetchFn,
        adapter.createPatientRequest(connection, row.payload.patient),
      );
      patientId = adapter.createdId(created);
      if (!patientId) return { ok: false, error: "МИС не вернула ID пациента" };
    }
    const appointment = await call(
      fetchFn,
      adapter.createAppointmentRequest(
        connection,
        patientId,
        row.payload.appointment,
      ),
    );
    return {
      ok: true,
      result: {
        patient_external_id: patientId,
        appointment_external_id: adapter.createdId(appointment),
      },
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
};

/** Address of the webhook for the MIS (Settings → Интеграция с МИС) */
export const misWebhookUrl = (
  functionsUrl: string,
  kind: MisKind,
  token: string,
) =>
  `${functionsUrl.replace(/\/+$/, "")}/mis_webhook?kind=${kind}&token=${encodeURIComponent(token)}`;
