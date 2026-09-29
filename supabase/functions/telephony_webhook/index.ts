import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  fetchRecordingUrl,
  isProvider,
  parseWebhookAddress,
  parseWebhookBody,
  queryPayload,
  toCallEvent,
  verifyWebhook,
  webhookResponseBody,
  webhookResponseType,
} from "../_shared/telephony.ts";

/**
 * Webhook given to the clinic's PBX (Settings → Телефония):
 *   POST /functions/v1/telephony_webhook?provider=<p>&token=<token>
 *   POST /functions/v1/telephony_webhook/mango/<token>   (Mango Office adds /events/...)
 *   GET or POST /functions/v1/telephony_webhook?provider=sipuni&token=<token>
 *     (Sipuni «События АТС» may send the event in the query)
 * The token identifies the clinic (telephony_integrations.webhook_token); the
 * payload is checked with the clinic's secret when one is set, mapped by
 * _shared/telephony.ts and stored by public.ingest_call (see its comment).
 */
Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Zadarma checks the address before saving it: echo zd_echo back
  const echo = url.searchParams.get("zd_echo");
  if (echo) return new Response(echo);

  const address = parseWebhookAddress(url);
  if (
    req.method !== "POST" &&
    !(req.method === "GET" && address.provider === "sipuni")
  ) {
    return new Response("Method Not Allowed", { status: 405 });
  }
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

  // The clinic's provider decides the signature check: the address can
  // name it (some PBXs need it in the URL) but never switch it
  if (address.provider && address.provider !== integration.provider) {
    return new Response("Provider mismatch", { status: 400 });
  }
  const provider = integration.provider;
  if (!isProvider(provider)) {
    return new Response("Unknown provider", { status: 400 });
  }

  const raw = req.method === "GET" ? "" : await req.text();
  const body = {
    ...(provider === "sipuni" ? queryPayload(url) : {}),
    ...parseWebhookBody(raw, req.headers.get("content-type")),
  };
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
      headers: { "Content-Type": webhookResponseType(provider) },
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
    // Sipuni stops sending events after answers other than {"success": true}
    return provider === "sipuni"
      ? ok()
      : new Response("Unsupported call", { status: 400 });
  }
  if (error) {
    console.error("ingest_call failed", error);
    return new Response("Error", { status: 500 });
  }
  return ok();
});
