import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { sendDealMessage } from "../_shared/dealMessage.ts";
import {
  isDealFilePath,
  resolveMime,
  validateFile,
} from "../_shared/attachments.ts";

const ERRORS = {
  not_connected: [409, "Messengers are not connected"],
  no_route: [409, "No chat to write to"],
  send_failed: [502, "The messenger refused the message"],
  store_failed: [500, "Internal Server Error"],
  file_not_found: [404, "The file was not uploaded"],
} as const;

/**
 * Sends a message from the deal card or the inbox. Body:
 * { deal_id, text, automessage_id?, file? }. file: { path, name, mime, size }
 * of a file the employee uploaded to the deal folder of the "deal-files"
 * bucket (storage policies: only to a deal they see); text is then an
 * optional caption. The deal is read with the caller's
 * rights (RLS: a manager can only write in the deals they see), the message
 * goes through Wazzup24 or the clinic's Telegram bot and is stored as
 * outgoing. With automessage_id (the
 * «Отправить» button of a "show to the employee first" task) the text may
 * have been edited; the automessage is marked sent and its task done.
 */
Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        const sale = user ? await getUserSale(user) : null;
        // The integrator (stage 25) only reads the deals
        if (!sale || sale.disabled || sale.role === "integrator")
          return createErrorResponse(403, "Forbidden");

        const { deal_id, text, automessage_id, file } = await req
          .json()
          .catch(() => ({}));
        const body = typeof text === "string" ? text.trim() : "";
        if (!deal_id || (!body && !file)) {
          return createErrorResponse(400, "deal_id and text are required");
        }

        const asUser = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
          {
            global: {
              headers: { Authorization: req.headers.get("Authorization")! },
            },
          },
        );
        const { data: deal } = await asUser
          .from("deals")
          .select("id, organization_id, patient_id")
          .eq("id", deal_id)
          .maybeSingle();
        if (!deal) return createErrorResponse(404, "Deal not found");

        let attachment = null;
        if (file) {
          const name = typeof file.name === "string" ? file.name.trim() : "";
          const size = Number(file.size);
          const mime = resolveMime(
            typeof file.mime === "string" ? file.mime : null,
            name,
          );
          if (
            automessage_id != null ||
            !isDealFilePath(file.path, deal.organization_id, deal.id) ||
            validateFile({ name, size, mime }) != null
          ) {
            return createErrorResponse(400, "Invalid file", {
              code: "invalid_file",
            });
          }
          attachment = { path: file.path as string, name, mime, size };
        }

        if (automessage_id != null) {
          const { data: automessage } = await supabaseAdmin
            .from("automessages")
            .select("id, status")
            .eq("organization_id", deal.organization_id)
            .eq("deal_id", deal.id)
            .eq("id", automessage_id)
            .maybeSingle();
          if (
            !automessage ||
            !["pending", "awaiting", "failed"].includes(automessage.status)
          ) {
            return createErrorResponse(409, "Message already handled", {
              code: "automessage_closed",
            });
          }
        }

        const result = await sendDealMessage({
          organizationId: deal.organization_id,
          dealId: deal.id,
          patientId: deal.patient_id,
          text: body,
          file: attachment,
          salesId: sale.id,
          automessageId: automessage_id ?? null,
        });
        if (!result.ok) {
          const [status, message] = ERRORS[result.code];
          return createErrorResponse(
            status,
            message,
            result.code === "store_failed"
              ? {}
              : { code: result.code, detail: result.detail },
          );
        }
        return new Response(JSON.stringify({ data: result.message }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }),
    ),
  ),
);
