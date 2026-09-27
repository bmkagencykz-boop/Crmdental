import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  describeSendError,
  dispatchThrottled,
  isDispatchAuthorized,
  type ClaimedAutomessage,
} from "../_shared/automessages.ts";
import { sendDealMessage } from "../_shared/dealMessage.ts";

/** Messages of a clinic taken per run (the run is every minute) */
const PER_CLINIC = 20;

/**
 * Sends the due automatic messages. Started every minute by pg_cron
 * (private.request_automessages_dispatch) with the key
 * AUTOMESSAGES_DISPATCH_KEY. public.claim_automessages does the choosing
 * (and turns "show first" messages into tasks); here the messages go through
 * Wazzup24, a few per second per clinic, and each row is marked: sent by the
 * trigger of the stored message, failed with the reason otherwise.
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

  const { data, error } = await supabaseAdmin.rpc("claim_automessages", {
    per_clinic: PER_CLINIC,
  });
  if (error) {
    console.error("claim_automessages failed", error);
    return new Response("Error", { status: 500 });
  }
  const rows = (data ?? []) as ClaimedAutomessage[];

  const results = await dispatchThrottled(rows, async (row) => {
    const result = await sendDealMessage({
      organizationId: row.organization_id,
      dealId: row.deal_id,
      patientId: row.patient_id,
      text: row.message_text,
      automessageId: row.id,
    });
    return result.ok
      ? { ok: true }
      : { ok: false, error: describeSendError(result.code, result.detail) };
  });

  let failed = 0;
  for (const [id, result] of results) {
    if (result.ok) continue;
    failed++;
    const { error: updateError } = await supabaseAdmin
      .from("automessages")
      .update({
        status: "failed",
        error: result.error.slice(0, 500),
        processed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "sending");
    if (updateError) console.error("Marking failed", id, updateError);
  }

  return new Response(
    JSON.stringify({
      claimed: rows.length,
      sent: rows.length - failed,
      failed,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
