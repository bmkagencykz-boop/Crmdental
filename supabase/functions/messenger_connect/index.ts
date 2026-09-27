import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { supabaseAdminAs } from "../_shared/auditActor.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import {
  toChannels,
  WAZZUP_API,
  type WazzupChannel,
} from "../_shared/messenger.ts";

/** Public base URL of the functions (Wazzup24 must reach the webhook) */
const functionsUrl = () =>
  Deno.env.get("WEBHOOK_BASE_URL") ??
  `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

/**
 * Settings → Integrations (owner or head): saves the Wazzup24 API key,
 * imports the clinic's channels and registers the webhook.
 * Body: { api_key } to connect, { disconnect: true } to stop.
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
        const organizationId = sale.organization_id;
        // The audit log names the employee who connects or disconnects
        const asEmployee = supabaseAdminAs(sale.id);
        const body = await req.json().catch(() => ({}));

        if (body.disconnect) {
          await asEmployee
            .from("messenger_integrations")
            .update({ api_key: null, connected_at: null, last_error: null })
            .eq("organization_id", organizationId);
          return json({ connected: false });
        }

        const apiKey =
          typeof body.api_key === "string" ? body.api_key.trim() : "";
        if (!apiKey) return createErrorResponse(400, "Missing API key");
        const headers = {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        };

        const channelsResponse = await fetch(`${WAZZUP_API}/channels`, {
          headers,
        });
        if (!channelsResponse.ok) {
          return createErrorResponse(400, "Wazzup24 refused the API key", {
            code: "invalid_api_key",
          });
        }
        const channels = toChannels(
          (await channelsResponse.json()) as WazzupChannel[],
        );

        const { data: integration, error } = await asEmployee
          .from("messenger_integrations")
          .upsert(
            {
              organization_id: organizationId,
              api_key: apiKey,
              connected_at: new Date().toISOString(),
              last_error: null,
            },
            { onConflict: "organization_id" },
          )
          .select("webhook_token")
          .single();
        if (error || !integration) {
          console.error("Saving the integration failed", error);
          return createErrorResponse(500, "Internal Server Error");
        }

        if (channels.length) {
          await supabaseAdmin.from("messenger_channels").upsert(
            channels.map((channel) => ({
              ...channel,
              organization_id: organizationId,
            })),
            { onConflict: "organization_id,external_id" },
          );
        }

        const webhook = await fetch(`${WAZZUP_API}/webhooks`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            webhooksUri: `${functionsUrl()}/wazzup_webhook?token=${integration.webhook_token}`,
            subscriptions: {
              messagesAndStatuses: true,
              contactsAndDealsCreation: false,
            },
          }),
        });
        if (!webhook.ok) {
          const lastError = `Webhook: ${webhook.status} ${await webhook.text()}`;
          await supabaseAdmin
            .from("messenger_integrations")
            .update({ last_error: lastError })
            .eq("organization_id", organizationId);
          return createErrorResponse(502, lastError, {
            code: "webhook_failed",
          });
        }

        return json({ connected: true, channels });
      }),
    ),
  ),
);
