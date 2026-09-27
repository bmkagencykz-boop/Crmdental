import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { toIngestMessage, type WazzupMessage } from "../_shared/messenger.ts";

/**
 * Webhook given to Wazzup24 by messenger_connect:
 *   POST /functions/v1/wazzup_webhook?token=<messenger_integrations.webhook_token>
 * Receives messages and delivery statuses. The token identifies the clinic;
 * everything else happens in public.ingest_message (see its comment).
 * Wazzup24 expects a quick 200, and retries otherwise.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response("Missing token", { status: 401 });

  let body: {
    test?: boolean;
    messages?: WazzupMessage[];
    statuses?: {
      messageId: string;
      status: string;
      error?: { error?: string; description?: string };
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  // Sent by Wazzup24 when the webhook is registered
  if (body.test) return new Response("OK");

  for (const raw of body.messages ?? []) {
    const message = toIngestMessage(raw);
    if (!message) continue;
    const { error } = await supabaseAdmin.rpc("ingest_message", {
      webhook_token: token,
      message,
    });
    if (error?.code === "28000") {
      return new Response("Unknown token", { status: 401 });
    }
    if (error) {
      console.error("ingest_message failed", error);
      return new Response("Error", { status: 500 });
    }
  }

  for (const status of body.statuses ?? []) {
    const { error } = await supabaseAdmin.rpc("update_message_status", {
      webhook_token: token,
      external_id: status.messageId,
      status: status.status,
      error: status.error?.description ?? status.error?.error ?? null,
    });
    if (error?.code === "28000") {
      return new Response("Unknown token", { status: 401 });
    }
    if (error) console.error("update_message_status failed", error);
  }

  return new Response("OK");
});
