import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  describeSendError,
  isDispatchAuthorized,
} from "../_shared/automessages.ts";
import { sendDealMessage, sendToPatient } from "../_shared/dealMessage.ts";
import {
  dispatchWithPauses,
  type ClaimedMailingMessage,
} from "../_shared/mailings.ts";

/**
 * Messages of a clinic taken per run (the run is every minute). With a
 * random pause of 5-20 s between two messages, 4 fit in a run; the claim
 * also applies the clinic limits (per minute, per day, working hours).
 */
const PER_RUN = 4;

/**
 * Sends the due mailing and recall messages. Started every minute by pg_cron
 * (private.request_mailings_dispatch) with the same key as the automatic
 * messages (AUTOMESSAGES_DISPATCH_KEY). public.claim_mailing_messages does
 * the choosing; a message attached to a deal is stored like any outgoing
 * message (a trigger marks the row sent), a message to a patient without any
 * deal is only recorded on its row.
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

  const { data, error } = await supabaseAdmin.rpc("claim_mailing_messages", {
    per_run: PER_RUN,
  });
  if (error) {
    console.error("claim_mailing_messages failed", error);
    return new Response("Error", { status: 500 });
  }
  const rows = (data ?? []) as ClaimedMailingMessage[];

  const results = await dispatchWithPauses(rows, async (row) => {
    if (row.deal_id != null) {
      const result = await sendDealMessage({
        organizationId: row.organization_id,
        dealId: row.deal_id,
        patientId: row.patient_id,
        text: row.message_text,
        mailingMessageId: row.id,
      });
      return result.ok
        ? { ok: true }
        : { ok: false, error: describeSendError(result.code, result.detail) };
    }
    const result = await sendToPatient({
      organizationId: row.organization_id,
      dealId: null,
      patientId: row.patient_id,
      text: row.message_text,
      failUndelivered: true,
    });
    if (!result.ok) {
      return {
        ok: false,
        error: describeSendError(result.code, result.detail),
      };
    }
    const { error: updateError } = await supabaseAdmin
      .from("mailing_messages")
      .update({
        status: "sent",
        external_id: result.externalId,
        delivery_status: "sent",
        processed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (updateError) console.error("Marking sent", row.id, updateError);
    return { ok: true };
  });

  let failed = 0;
  for (const [id, result] of results) {
    if (result.ok) continue;
    failed++;
    const { error: updateError } = await supabaseAdmin
      .from("mailing_messages")
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
