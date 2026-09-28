import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { ADAPTERS, isMisKind, testConnection } from "../_shared/mis/sync.ts";

/**
 * «Проверить подключение» (Settings → Интеграция с МИС, owner or head):
 * body { kind }. Calls the vendor API with the stored key (adapter
 * pingRequest), records the result in the connection status and the sync
 * log (public.mis_record_sync) and answers { ok, message }.
 */
Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        const sale = user ? await getUserSale(user) : null;
        if (!sale || sale.disabled || !["owner", "head"].includes(sale.role)) {
          return createErrorResponse(403, "Forbidden");
        }
        const body = await req.json().catch(() => ({}));
        if (!isMisKind(body.kind))
          return createErrorResponse(400, "Unknown MIS");

        const { data: connection, error } = await supabaseAdmin
          .from("integrations")
          .select("id, kind, base_url, api_key, settings, status")
          .eq("organization_id", sale.organization_id)
          .eq("kind", body.kind)
          .maybeSingle();
        if (error) return createErrorResponse(500, "Error");
        if (!connection || !connection.api_key) {
          return createErrorResponse(409, "Сначала сохраните ключ API", {
            code: "not_connected",
          });
        }

        const result = await testConnection(
          ADAPTERS[body.kind],
          connection,
          (url, init) =>
            fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }),
        );
        await supabaseAdmin.rpc("mis_record_sync", {
          connection: connection.id,
          operation: "test",
          ok: result.ok,
          message: result.message,
        });
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }),
    ),
  ),
);
