import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { chooseRoute, WAZZUP_API } from "../_shared/messenger.ts";

/**
 * Sends a message from the deal card or the inbox. Body: { deal_id, text }.
 * The deal is read with the caller's rights (RLS: a manager can only write
 * in the deals they see), the message goes through Wazzup24 and is stored
 * as outgoing.
 */
Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        const sale = user ? await getUserSale(user) : null;
        if (!sale || sale.disabled)
          return createErrorResponse(403, "Forbidden");

        const { deal_id, text } = await req.json().catch(() => ({}));
        const body = typeof text === "string" ? text.trim() : "";
        if (!deal_id || !body) {
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
        const organizationId = deal.organization_id;

        const [integration, lastMessage, patientChats, patient, channels] =
          await Promise.all([
            supabaseAdmin
              .from("messenger_integrations")
              .select("api_key")
              .eq("organization_id", organizationId)
              .maybeSingle(),
            supabaseAdmin
              .from("messages")
              .select("transport, chat_id, messenger_channels(external_id)")
              .eq("organization_id", organizationId)
              .eq("deal_id", deal.id)
              .order("sent_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabaseAdmin
              .from("patient_chats")
              .select("transport, chat_id")
              .eq("organization_id", organizationId)
              .eq("patient_id", deal.patient_id),
            supabaseAdmin
              .from("patients")
              .select("phones")
              .eq("organization_id", organizationId)
              .eq("id", deal.patient_id)
              .single(),
            supabaseAdmin
              .from("messenger_channels")
              .select("id, external_id, transport, state")
              .eq("organization_id", organizationId),
          ]);

        const apiKey = integration.data?.api_key;
        if (!apiKey) {
          return createErrorResponse(409, "Messengers are not connected", {
            code: "not_connected",
          });
        }
        const route = chooseRoute({
          lastMessage: lastMessage.data
            ? {
                transport: lastMessage.data.transport,
                chat_id: lastMessage.data.chat_id,
                channel_external_id: (
                  lastMessage.data.messenger_channels as {
                    external_id: string;
                  } | null
                )?.external_id,
              }
            : null,
          patientChats: patientChats.data ?? [],
          phones: patient.data?.phones ?? [],
          channels: channels.data ?? [],
        });
        if (!route) {
          return createErrorResponse(409, "No chat to write to", {
            code: "no_route",
          });
        }

        const crmMessageId = crypto.randomUUID();
        const sent = await fetch(`${WAZZUP_API}/message`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...route,
            text: body,
            crmUserId: String(sale.id),
            crmMessageId,
          }),
        });
        if (!sent.ok) {
          const detail = await sent.text();
          console.error("Wazzup24 refused the message", sent.status, detail);
          return createErrorResponse(502, "Wazzup24 refused the message", {
            code: "send_failed",
            detail,
          });
        }
        const { messageId } = await sent.json();

        const channel = (channels.data ?? []).find(
          (c) => c.external_id === route.channelId,
        );
        const { data: message, error } = await supabaseAdmin
          .from("messages")
          .insert({
            organization_id: organizationId,
            patient_id: deal.patient_id,
            deal_id: deal.id,
            channel_id: channel?.id ?? null,
            transport: route.chatType,
            chat_id: route.chatId,
            direction: "out",
            sales_id: sale.id,
            text: body,
            status: "sent",
            external_id: messageId ?? crmMessageId,
          })
          .select()
          .single();
        if (error) {
          console.error("Storing the message failed", error);
          return createErrorResponse(500, "Internal Server Error");
        }
        return new Response(JSON.stringify({ data: message }), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }),
    ),
  ),
);
