import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { isDispatchAuthorized } from "../_shared/automessages.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import {
  ADAPTERS,
  isMisKind,
  pollConnection,
  pushAppointment,
  type OutboxRow,
} from "../_shared/mis/sync.ts";
import type { MisKind } from "../_shared/mis/normalize.ts";

/** Queue rows sent per run */
const PUSH_PER_RUN = 20;
/** Time given to one vendor request */
const TIMEOUT_MS = 20_000;

const timedFetch = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

const rpc = (fn: string, args: Record<string, unknown>) =>
  supabaseAdmin.rpc(fn, args);

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

type ConnectionRow = {
  id: number;
  organization_id: number;
  kind: MisKind;
  base_url: string | null;
  api_key: string | null;
  settings: Record<string, unknown> | null;
  sync_cursor: string | null;
  sync_patients: boolean;
  sync_appointments: boolean;
  sync_payments: boolean;
};

const CONNECTION_COLUMNS =
  "id, organization_id, kind, base_url, api_key, settings, sync_cursor, sync_patients, sync_appointments, sync_payments";

/** Polls one connection and records the result (status, cursor, log) */
const poll = async (connection: ConnectionRow) => {
  const outcome = await pollConnection({
    adapter: ADAPTERS[connection.kind],
    connection,
    cursor: connection.sync_cursor,
    rpc,
    fetchFn: timedFetch,
    directions: {
      patients: connection.sync_patients,
      appointments: connection.sync_appointments,
      payments: connection.sync_payments,
    },
  });
  const { error } = await rpc("mis_record_sync", {
    connection: connection.id,
    operation: "poll",
    ok: outcome.ok,
    message: outcome.message,
    new_cursor: outcome.cursor,
  });
  if (error) console.error("mis_record_sync failed", connection.id, error);
  return { connection: connection.id, ...outcome };
};

/** Sends the due appointments of the push queue */
const push = async () => {
  const { data, error } = await rpc("claim_mis_outbox", {
    max_rows: PUSH_PER_RUN,
  });
  if (error) {
    console.error("claim_mis_outbox failed", error);
    return { claimed: 0, sent: 0 };
  }
  const rows = (data ?? []) as OutboxRow[];
  let sent = 0;
  for (const row of rows) {
    const outcome = await pushAppointment(ADAPTERS[row.kind], row, timedFetch);
    if (outcome.ok) sent++;
    const { error: completeError } = await rpc("complete_mis_outbox", {
      outbox_id: row.id,
      delivered: outcome.ok,
      error_text: outcome.ok ? null : outcome.error,
      result: outcome.ok ? outcome.result : {},
    });
    if (completeError)
      console.error("complete_mis_outbox failed", row.id, completeError);
  }
  return { claimed: rows.length, sent };
};

const activeConnections = (organizationId?: number, kind?: MisKind) => {
  let query = supabaseAdmin
    .from("integrations")
    .select(CONNECTION_COLUMNS)
    .in("kind", ["dentist_plus", "macdent"])
    .in("status", ["connected", "error"])
    .not("api_key", "is", null);
  if (organizationId != null)
    query = query.eq("organization_id", organizationId);
  if (kind) query = query.eq("kind", kind);
  return query;
};

/**
 * MIS synchronisation.
 * - pg_cron (private.request_mis_sync) with the dispatchers' key:
 *   { mode: "poll" } every 10 minutes — changes of every active connection
 *   since its cursor; { mode: "push" } every minute — the push queue.
 * - «Синхронизировать сейчас» of the settings (owner or head, user JWT):
 *   { kind } — that connection of the clinic, then the queue.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return OptionsMiddleware(req, async () => new Response(null));
  }
  if (req.method !== "POST")
    return createErrorResponse(405, "Method Not Allowed");

  if (
    isDispatchAuthorized(req.headers.get("Authorization"), [
      Deno.env.get("AUTOMESSAGES_DISPATCH_KEY"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ])
  ) {
    const body = await req.json().catch(() => ({}));
    if (body.mode === "push") return json(await push());
    const { data, error } = await activeConnections();
    if (error) {
      console.error("integrations read failed", error);
      return createErrorResponse(500, "Error");
    }
    const results = [];
    for (const connection of (data ?? []) as ConnectionRow[]) {
      results.push(await poll(connection));
    }
    return json({
      polled: results.length,
      results: results.map(({ result, ok, connection }) => ({
        connection,
        ok,
        ...result,
      })),
    });
  }

  return AuthMiddleware(req, async (req) =>
    UserMiddleware(req, async (req, user) => {
      const sale = user ? await getUserSale(user) : null;
      if (!sale || sale.disabled || !["owner", "head"].includes(sale.role)) {
        return createErrorResponse(403, "Forbidden");
      }
      const body = await req.json().catch(() => ({}));
      if (!isMisKind(body.kind)) return createErrorResponse(400, "Unknown MIS");
      const { data, error } = await activeConnections(
        sale.organization_id,
        body.kind,
      );
      if (error) return createErrorResponse(500, "Error");
      const connection = (data ?? [])[0] as ConnectionRow | undefined;
      if (!connection) {
        return createErrorResponse(
          409,
          "МИС не подключена: сохраните ключ API",
          {
            code: "not_connected",
          },
        );
      }
      const outcome = await poll(connection);
      const pushed = await push();
      return json({
        ok: outcome.ok,
        message: outcome.message,
        ...outcome.result,
        pushed: pushed.sent,
      });
    }),
  );
});
