import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  fetchRecordingUrl,
  isProvider,
  parseWebhookAddress,
  parseWebhookBody,
  toCallEvent,
  verifyWebhook,
  webhookResponseBody,
} from "../_shared/telephony.ts";

/**
 * Webhook given to the clinic's PBX (Settings → Телефония):
 *   POST /functions/v1/telephony_webhook?provider=<p>&token=<token>
 *   POST /functions/v1/telephony_webhook/mango/<token>   (Mango Office adds /events/...)
 * The token identifies the clinic (telephony_integrations.webhook_token); the
 * payload is checked with the clinic's secret when one is set, mapped by
 * _shared/telephony.ts and stored by public.ingest_call (see its comment).
 */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Zadarma checks the address before saving it: echo zd_echo back
  const echo = url.searchParams.get("zd_echo");
  if (echo) return new Response(echo);

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const address = parseWebhookAddress(url);
  if (!address.token) return new Response("Missing token", { status: 401 });

  const { data: integration, error: integrationError } = await supabaseAdmin
    .from("telephony_integrations")
    .select("provider, secret, api_key")
    .eq("webhook_token", address.token)
    .maybeSingle();
  if (integrationError) {
    console.error("telephony_integrations read failed", integrationError);
    return new Response("Error", { status: 500 });
  }
  if (!integration) return new Response("Unknown token", { status: 401 });

  const provider = address.provider ?? integration.provider;
  if (!isProvider(provider)) {
    return new Response("Unknown provider", { status: 400 });
  }

  const raw = await req.text();
  const body = parseWebhookBody(raw, req.headers.get("content-type"));
  const verified = await verifyWebhook({
    provider,
    raw,
    body,
    headers: req.headers,
    secret: integration.secret,
    apiKey: integration.api_key,
  });
  if (!verified) return new Response("Bad signature", { status: 403 });

  const ok = () =>
    new Response(webhookResponseBody(provider), {
      headers: {
        "Content-Type":
          provider === "binotel" ? "application/json" : "text/plain",
      },
    });

  const event = toCallEvent(provider, body, address.event);
  if (!event) return ok();

  let call = event.call;
  if (event.recording) {
    const recordUrl = await fetchRecordingUrl(event.recording, {
      apiKey: integration.api_key,
      secret: integration.secret,
    });
    if (recordUrl) call = { ...call, record_url: recordUrl };
  }

  const { error } = await supabaseAdmin.rpc("ingest_call", {
    webhook_token: address.token,
    provider,
    call,
  });
  if (error?.code === "28000") {
    return new Response("Unknown token", { status: 401 });
  }
  if (error?.code === "22023") {
    return new Response("Unsupported call", { status: 400 });
  }
  if (error) {
    console.error("ingest_call failed", error);
    return new Response("Error", { status: 500 });
  }
  return ok();
});
