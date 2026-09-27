import { supabaseAdmin } from "./supabaseAdmin.ts";
import { chooseRoute, type Route, WAZZUP_API } from "./messenger.ts";
import {
  sendMessageBody,
  TELEGRAM_BOT,
  telegramMethodUrl,
  toSendResult,
  usableChannels,
} from "./telegram.ts";

export type DealMessageResult =
  | { ok: true; message: Record<string, unknown> }
  | {
      ok: false;
      code: "not_connected" | "no_route" | "send_failed" | "store_failed";
      detail?: string;
    };

/**
 * Sends a text to the patient of a deal through Wazzup24 or the clinic's
 * Telegram bot, and stores it as an outgoing message. The chat is the one the patient last wrote from, else a
 * known chat, else WhatsApp on the patient's phone (chooseRoute). Used by
 * messenger_send (an employee), automessages_dispatch and mailings_dispatch
 * (the system). The caller has checked that the deal may be written to.
 */
export const sendDealMessage = async ({
  organizationId,
  dealId,
  patientId,
  text,
  salesId = null,
  automessageId = null,
  mailingMessageId = null,
}: {
  organizationId: number;
  dealId: number;
  patientId: number;
  text: string;
  salesId?: number | null;
  automessageId?: number | null;
  mailingMessageId?: number | null;
}): Promise<DealMessageResult> => {
  const sent = await sendToPatient({
    organizationId,
    dealId,
    patientId,
    text,
    salesId,
    // An automatic message or a mailing is failed (and retried or reported
    // by its dispatcher) rather than stored as undelivered
    failUndelivered: automessageId != null || mailingMessageId != null,
  });
  if (!sent.ok) return sent;
  const { route, channel, externalId, status, error: deliveryError } = sent;

  // With an automessage or a mailing row, a trigger marks it sent (and
  // completes the task of the automessage)
  const { data: message, error } = await supabaseAdmin
    .from("messages")
    .insert({
      organization_id: organizationId,
      patient_id: patientId,
      deal_id: dealId,
      channel_id: channel?.id ?? null,
      transport: route.chatType,
      chat_id: route.chatId,
      direction: "out",
      sales_id: salesId,
      text,
      status,
      error: deliveryError,
      external_id: externalId,
      automessage_id: automessageId,
      ...(mailingMessageId != null
        ? { mailing_message_id: mailingMessageId }
        : {}),
    })
    .select()
    .single();
  if (error) {
    console.error("Storing the message failed", error);
    return { ok: false, code: "store_failed", detail: error.message };
  }
  return { ok: true, message };
};

export type PatientMessageResult =
  | {
      ok: true;
      route: Route;
      channel: { id: number; external_id: string } | undefined;
      externalId: string;
      /** "error": the Telegram bot could not deliver it */
      status: "sent" | "error";
      error: string | null;
    }
  | {
      ok: false;
      code: "not_connected" | "no_route" | "send_failed";
      detail?: string;
    };

/**
 * Sends a text to a patient through Wazzup24 or the clinic's Telegram bot
 * without storing it: to the chat
 * the patient last wrote from (in this deal, or in any deal when dealId is
 * null), else a known chat, else WhatsApp on the phone. A mailing to a
 * patient without any deal uses it directly: the message is then recorded in
 * mailing_messages only.
 */
export const sendToPatient = async ({
  organizationId,
  dealId,
  patientId,
  text,
  salesId = null,
  failUndelivered = false,
}: {
  organizationId: number;
  dealId: number | null;
  patientId: number;
  text: string;
  salesId?: number | null;
  failUndelivered?: boolean;
}): Promise<PatientMessageResult> => {
  const lastMessageQuery = supabaseAdmin
    .from("messages")
    .select("transport, chat_id, messenger_channels(external_id)")
    .eq("organization_id", organizationId);
  const [integration, telegramBot, lastMessage, patientChats, patient, all] =
    await Promise.all([
      supabaseAdmin
        .from("messenger_integrations")
        .select("api_key")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabaseAdmin
        .from("telegram_bots")
        .select("bot_token")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      (dealId != null
        ? lastMessageQuery.eq("deal_id", dealId)
        : lastMessageQuery.eq("patient_id", patientId)
      )
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("patient_chats")
        .select("transport, chat_id")
        .eq("organization_id", organizationId)
        .eq("patient_id", patientId),
      supabaseAdmin
        .from("patients")
        .select("phones")
        .eq("organization_id", organizationId)
        .eq("id", patientId)
        .single(),
      supabaseAdmin
        .from("messenger_channels")
        .select("id, external_id, transport, state")
        .eq("organization_id", organizationId),
    ]);

  const apiKey = integration.data?.api_key;
  const botToken = telegramBot.data?.bot_token;
  if (!apiKey && !botToken) return { ok: false, code: "not_connected" };
  // Only the channels of the connected providers can be written to
  const channels = {
    data: usableChannels(all.data ?? [], {
      wazzup: !!apiKey,
      telegramBot: !!botToken,
    }),
  };
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
  if (!route) return { ok: false, code: "no_route" };

  const crmMessageId = crypto.randomUUID();
  let delivery: {
    status: "sent" | "error";
    external_id: string | null;
    error: string | null;
  };
  if (route.chatType === TELEGRAM_BOT) {
    // The clinic's own bot: Bot API sendMessage
    const sent = await fetch(telegramMethodUrl(botToken!, "sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sendMessageBody(route.chatId, text)),
    }).catch(() => null);
    delivery = toSendResult(
      !!sent?.ok,
      sent ? await sent.json().catch(() => null) : null,
    );
    if (delivery.status === "error") {
      console.error("Telegram refused the message", delivery.error);
      if (failUndelivered) {
        return {
          ok: false,
          code: "send_failed",
          detail: delivery.error ?? undefined,
        };
      }
    }
  } else {
    const sent = await fetch(`${WAZZUP_API}/message`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...route,
        text,
        ...(salesId != null ? { crmUserId: String(salesId) } : {}),
        crmMessageId,
      }),
    });
    if (!sent.ok) {
      const detail = await sent.text();
      console.error("Wazzup24 refused the message", sent.status, detail);
      return { ok: false, code: "send_failed", detail };
    }
    const { messageId } = await sent.json();
    delivery = { status: "sent", external_id: messageId, error: null };
  }

  const channel = (channels.data ?? []).find(
    (c) => c.external_id === route.channelId,
  );
  return {
    ok: true,
    route,
    channel,
    externalId: delivery.external_id ?? crmMessageId,
    status: delivery.status,
    error: delivery.error,
  };
};
