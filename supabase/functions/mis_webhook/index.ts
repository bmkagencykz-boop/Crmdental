import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { parseWebhookBody } from "../_shared/telephony.ts";
import {
  ADAPTERS,
  applyItems,
  isMisKind,
  summary,
} from "../_shared/mis/sync.ts";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Pushes of the clinic's MIS (Settings → Интеграция с МИС, «Адрес для
 * МИС»): POST (JSON or form) or GET to
 *   /functions/v1/mis_webhook?kind=dentist_plus|macdent&token=<token>
 * The token identifies the connection (integrations.webhook_token). The
 * vendor adapter (_shared/mis) turns the payload into patients,
 * appointments, visits and payments, applied by the public.mis_* functions
 * (they log every record). Whether the vendors can push at all is still to
 * be confirmed with them (docs/stages/27-mis-connectors.md).
 */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const token = url.searchParams.get("token");
  if (!isMisKind(kind) || !token)
    return json({ error: "Unknown address" }, 401);
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const { data: connection, error } = await supabaseAdmin
    .from("integrations")
    .select("id, kind, status")
    .eq("webhook_token", token)
    .eq("kind", kind)
    .maybeSingle();
  if (error) {
    console.error("integrations read failed", error);
    return json({ error: "Error" }, 500);
  }
  if (!connection) return json({ error: "Unknown address" }, 401);
  if (!["connected", "error"].includes(connection.status)) {
    return json({ error: "The MIS connection is off" }, 409);
  }

  let body: unknown;
  if (req.method === "GET") {
    body = Object.fromEntries(
      [...url.searchParams].filter(([key]) => !["kind", "token"].includes(key)),
    );
  } else {
    body = parseWebhookBody(await req.text(), req.headers.get("content-type"));
  }
  const items = ADAPTERS[kind].parseWebhook(body);
  const result = await applyItems(
    (fn, args) => supabaseAdmin.rpc(fn, args),
    connection.id,
    items,
  );
  await supabaseAdmin.rpc("mis_record_sync", {
    connection: connection.id,
    operation: "webhook",
    ok: true,
    message: items.length
      ? `Вебхук: ${summary(result)}`
      : "Вебхук: в запросе нет записей, которые понимает коннектор",
  });
  return json({ ok: true, received: items.length, ...result });
});
