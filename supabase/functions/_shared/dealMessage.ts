import { supabaseAdmin } from "./supabaseAdmin.ts";
import {
  chooseRoute,
  type Route,
  WAZZUP_API,
  wazzupMessageBodies,
} from "./messenger.ts";
import {
  TELEGRAM_BOT,
  telegramMethodUrl,
  telegramSendPlan,
  toSendResult,
  usableChannels,
} from "./telegram.ts";
import {
  DEAL_FILES_BUCKET,
  fileKind,
  messageContentType,
  type OutgoingAttachment,
  SIGNED_URL_TTL_SECONDS,
} from "./attachments.ts";

/** A file of the deal folder sent with the message (already uploaded) */
export type DealMessageFile = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

export type DealMessageResult =
  | { ok: true; message: Record<string, unknown> }
  | {
      ok: false;
      code:
        | "not_connected"
        | "no_route"
        | "send_failed"
        | "store_failed"
        | "file_not_found";
      detail?: string;
    };

/**
 * Sends a text and/or a file to the patient of a deal through Wazzup24 or
 * the clinic's Telegram bot, and stores it as an outgoing message. The chat
 * is the one the patient last wrote from, else a known chat, else WhatsApp on
 * the patient's phone (chooseRoute). Used by messenger_send (an employee),
 * automessages_dispatch and mailings_dispatch (the system). The caller has
 * checked that the deal may be written to, and that the file is in the
 * folder of this deal.
 *
 * A file goes out as a signed link (7 days) the messenger downloads; it is
 * also listed in the deal files (deal_files.message_id).
 */
export const sendDealMessage = async ({
  organizationId,
  dealId,
  patientId,
  text,
  file = null,
  salesId = null,
  automessageId = null,
  mailingMessageId = null,
}: {
  organizationId: number;
  dealId: number;
  patientId: number;
  text: string;
  file?: DealMessageFile | null;
  salesId?: number | null;
  automessageId?: number | null;
  mailingMessageId?: number | null;
}): Promise<DealMessageResult> => {
  let attachment: OutgoingAttachment | null = null;
  if (file) {
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(DEAL_FILES_BUCKET)
      .createSignedUrl(file.path, SIGNED_URL_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      return { ok: false, code: "file_not_found", detail: signError?.message };
    }
    attachment = {
      url: signed.signedUrl,
      name: file.name,
      mime: file.mime,
      size: file.size,
    };
  }

  const sent = await sendToPatient({
    organizationId,
    dealId,
    patientId,
    text,
    attachment,
    salesId,
    // An automatic message or a mailing is failed (and retried or reported
    // by its dispatcher) rather than stored as undelivered
    failUndelivered: automessageId != null || mailingMessageId != null,
  });
  if (!sent.ok) return sent;
  const { route, channel, parts } = sent;

  const common = {
    organization_id: organizationId,
    patient_id: patientId,
    deal_id: dealId,
    channel_id: channel?.id ?? null,
    transport: route.chatType,
    chat_id: route.chatId,
    direction: "out",
    sales_id: salesId,
  };
  // The file and the caption went as one message, or as two (Wazzup24, or a
  // caption too long for Telegram): one row each
  const captionApart = parts.some((part) => part.kind === "text") && !!file;
  const rows = parts.map((part, index) => ({
    ...common,
    text: part.kind === "file" ? (captionApart ? null : text || null) : text,
    status: part.status,
    error: part.error,
    external_id: part.externalId,
    ...(part.kind === "file" && file
      ? {
          content_type: messageContentType(fileKind(file.mime, file.name)),
          attachment_path: file.path,
          attachment_name: file.name,
          attachment_mime: file.mime,
          attachment_size: file.size,
        }
      : {}),
    // With an automessage or a mailing row, a trigger marks it sent (and
    // completes the task of the automessage)
    ...(index === 0 ? { automessage_id: automessageId } : {}),
    ...(index === 0 && mailingMessageId != null
      ? { mailing_message_id: mailingMessageId }
      : {}),
  }));
  let message: Record<string, unknown> | null = null;
  for (const row of rows) {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .insert(row)
      .select()
      .single();
    if (error) {
      console.error("Storing the message failed", error);
      return { ok: false, code: "store_failed", detail: error.message };
    }
    message ??= data;
  }

  if (file && message) {
    const { error } = await supabaseAdmin.from("deal_files").insert({
      organization_id: organizationId,
      deal_id: dealId,
      path: file.path,
      name: file.name,
      size: file.size,
      mime: file.mime,
      sales_id: salesId,
      message_id: message.id,
    });
    if (error) console.error("Listing the sent file failed", error);
  }
  return { ok: true, message: message! };
};

/** One message delivered to the messenger */
export type DeliveredPart = {
  kind: "text" | "file";
  externalId: string;
  /** "error": the Telegram bot could not deliver it */
  status: "sent" | "error";
  error: string | null;
};

export type PatientMessageResult =
  | {
      ok: true;
      route: Route;
      channel: { id: number; external_id: string } | undefined;
      /** The first message (the file when there is one) */
      externalId: string;
      status: "sent" | "error";
      error: string | null;
      /** Every message sent: the file, then its caption when apart */
      parts: DeliveredPart[];
    }
  | {
      ok: false;
      code: "not_connected" | "no_route" | "send_failed";
      detail?: string;
    };

type Delivery = {
  status: "sent" | "error";
  external_id: string | null;
  error: string | null;
};

/** Bot API call with a JSON body, or multipart when a file is uploaded */
const callTelegram = async (
  botToken: string,
  method: string,
  body: Record<string, string> | FormData,
): Promise<Delivery> => {
  const sent = await fetch(telegramMethodUrl(botToken, method), {
    method: "POST",
    ...(body instanceof FormData
      ? { body }
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  }).catch(() => null);
  return toSendResult(
    !!sent?.ok,
    sent ? await sent.json().catch(() => null) : null,
  );
};

/**
 * Sends a text and/or a file to a patient through Wazzup24 or the clinic's
 * Telegram bot without storing it: to the chat the patient last wrote from
 * (in this deal, or in any deal when dealId is null), else a known chat,
 * else WhatsApp on the phone. A mailing to a patient without any deal uses
 * it directly: the message is then recorded in mailing_messages only.
 */
export const sendToPatient = async ({
  organizationId,
  dealId,
  patientId,
  text,
  attachment = null,
  salesId = null,
  failUndelivered = false,
}: {
  organizationId: number;
  dealId: number | null;
  patientId: number;
  text: string;
  attachment?: OutgoingAttachment | null;
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
            lastMessage.data.messenger_channels as unknown as {
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
  const parts: DeliveredPart[] = [];
  if (route.chatType === TELEGRAM_BOT) {
    // The clinic's own bot: sendMessage, or sendPhoto / sendDocument...
    // with the link (or the uploaded file when Telegram cannot take a link)
    const plan = telegramSendPlan(route.chatId, {
      text,
      file: attachment,
    });
    const requests: {
      kind: DeliveredPart["kind"];
      send: () => Promise<Delivery>;
    }[] = [];
    if (plan.file && attachment) {
      const request = plan.file;
      requests.push({
        kind: "file",
        send: async () => {
          if (request.byUrl) {
            return callTelegram(botToken!, request.method, {
              ...request.params,
              [request.field]: attachment.url,
            });
          }
          const content = await fetch(attachment.url)
            .then((response) => (response.ok ? response.blob() : null))
            .catch(() => null);
          if (!content) {
            return {
              status: "error",
              external_id: null,
              error: "The file could not be read from storage",
            };
          }
          const form = new FormData();
          for (const [key, value] of Object.entries(request.params)) {
            form.append(key, value);
          }
          form.append(request.field, content, attachment.name);
          return callTelegram(botToken!, request.method, form);
        },
      });
    }
    if (plan.text) {
      const body = plan.text;
      requests.push({
        kind: "text",
        send: () => callTelegram(botToken!, "sendMessage", body),
      });
    }
    for (const [index, request] of requests.entries()) {
      const delivery = await request.send();
      if (delivery.status === "error") {
        console.error("Telegram refused the message", delivery.error);
        if (failUndelivered && index === 0) {
          return {
            ok: false,
            code: "send_failed",
            detail: delivery.error ?? undefined,
          };
        }
      }
      parts.push({
        kind: request.kind,
        externalId:
          delivery.external_id ??
          (index === 0 ? crmMessageId : `${crmMessageId}:${index}`),
        status: delivery.status,
        error: delivery.error,
      });
    }
  } else {
    const bodies = wazzupMessageBodies(
      route,
      { text, contentUri: attachment?.url ?? null },
      {
        crmMessageId,
        crmUserId: salesId != null ? String(salesId) : null,
      },
    );
    for (const [index, body] of bodies.entries()) {
      const sent = await fetch(`${WAZZUP_API}/message`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }).catch(() => null);
      const kind = body.contentUri ? "file" : "text";
      if (!sent?.ok) {
        const detail = sent ? await sent.text() : "network error";
        console.error("Wazzup24 refused the message", sent?.status, detail);
        // Nothing went out: the caller shows the error
        if (index === 0) return { ok: false, code: "send_failed", detail };
        // The file went, its caption did not: stored as undelivered
        parts.push({
          kind,
          externalId: body.crmMessageId,
          status: "error",
          error: detail,
        });
        continue;
      }
      const { messageId } = await sent.json();
      parts.push({
        kind,
        externalId: messageId ?? body.crmMessageId,
        status: "sent",
        error: null,
      });
    }
  }

  const channel = (channels.data ?? []).find(
    (c) => c.external_id === route.channelId,
  );
  return {
    ok: true,
    route,
    channel,
    externalId: parts[0].externalId,
    status: parts[0].status,
    error: parts[0].error,
    parts,
  };
};
