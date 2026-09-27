import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { isDispatchAuthorized } from "../_shared/automessages.ts";
import {
  deliver,
  deliverAll,
  DELIVERY_TIMEOUT_MS,
  type ClaimedDelivery,
} from "../_shared/webhooks.ts";

/** Deliveries taken per run (the run is every minute) */
const PER_RUN = 50;

/**
 * Sends the due outgoing webhooks of the clinics. Started every minute by
 * pg_cron (private.request_webhooks_dispatch) with the dispatchers' key
 * AUTOMESSAGES_DISPATCH_KEY, or by hand with the service role key.
 * public.claim_webhook_deliveries does the choosing; each delivery is posted
 * as JSON signed with HMAC-SHA256 (header X-DentalCRM-Signature) and its
 * result goes to public.complete_webhook_delivery (retries with backoff,
 * switching the webhook off after 10 failures in a row).
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (
    !isDispatchAuthorized(req.headers.get("Authorization"), [
      Deno.env.get("AUTOMESSAGES_DISPATCH_KEY"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ])
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data, error } = await supabaseAdmin.rpc("claim_webhook_deliveries", {
    max_rows: PER_RUN,
  });
  if (error) {
    console.error("claim_webhook_deliveries failed", error);
    return new Response("Error", { status: 500 });
  }
  const rows = (data ?? []) as ClaimedDelivery[];

  let delivered = 0;
  await deliverAll(rows, async (row) => {
    const result = await deliver(row, (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS) }),
    );
    if (result.ok) delivered++;
    const { error: completeError } = await supabaseAdmin.rpc(
      "complete_webhook_delivery",
      {
        delivery_id: row.id,
        delivered: result.ok,
        response_status: result.status,
        error_text: result.error,
      },
    );
    if (completeError) {
      console.error("complete_webhook_delivery failed", row.id, completeError);
    }
  });

  return new Response(
    JSON.stringify({
      claimed: rows.length,
      delivered,
      failed: rows.length - delivered,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
