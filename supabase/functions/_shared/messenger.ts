/**
 * Wazzup24 API v3 (https://wazzup24.com/help/api-en/) mapped to the
 * provider-neutral shape of public.ingest_message. No Deno import here so
 * that it can be unit tested.
 */

export const WAZZUP_API = "https://api.wazzup24.com/v3";

export type Transport = "whatsapp" | "instagram" | "telegram";

/** Wazzup transports / chat types we support, and ours */
const TRANSPORTS: Record<string, Transport> = {
  whatsapp: "whatsapp",
  wapi: "whatsapp",
  instagram: "instagram",
  telegram: "telegram",
  tgapi: "telegram",
};

export const toTransport = (value: unknown): Transport | null =>
  typeof value === "string" ? (TRANSPORTS[value] ?? null) : null;

/** Chat type Wazzup expects when sending to one of our transports */
export const toChatType = (transport: Transport) => transport;

export type WazzupMessage = {
  messageId?: string;
  channelId?: string;
  chatType?: string;
  chatId?: string;
  dateTime?: string;
  type?: string;
  status?: string;
  text?: string;
  contentUri?: string;
  isEcho?: boolean;
  contact?: { name?: string; phone?: string; username?: string };
};

export type IngestMessage = {
  channel_id: string | null;
  transport: Transport;
  chat_id: string;
  external_id: string | null;
  direction: "in" | "out";
  text: string | null;
  content_uri: string | null;
  content_type: string;
  sent_at: string | null;
  contact: {
    name: string | null;
    phone: string | null;
    username: string | null;
  };
};

/**
 * A webhook message, or null when it is not for us (group chats, other
 * messengers, service messages without a chat).
 */
export const toIngestMessage = (
  message: WazzupMessage,
): IngestMessage | null => {
  const transport = toTransport(message.chatType);
  const chatId = message.chatId?.toString().trim();
  if (!transport || !chatId) return null;
  const incoming = message.status === "inbound" && !message.isEcho;
  return {
    channel_id: message.channelId ?? null,
    transport,
    chat_id: chatId,
    external_id: message.messageId ?? null,
    direction: incoming ? "in" : "out",
    text: message.text ?? null,
    content_uri: message.contentUri ?? null,
    content_type: message.type ?? "text",
    sent_at: message.dateTime ?? null,
    contact: {
      name: message.contact?.name ?? null,
      phone: message.contact?.phone ?? null,
      username: message.contact?.username ?? null,
    },
  };
};

export type WazzupChannel = {
  channelId: string;
  transport: string;
  plainId?: string;
  state?: string;
};

/** Channels we can use, as rows of public.messenger_channels */
export const toChannels = (channels: WazzupChannel[]) =>
  channels.flatMap((channel) => {
    const transport = toTransport(channel.transport);
    return transport
      ? [
          {
            external_id: channel.channelId,
            transport,
            name: channel.plainId ?? null,
            state: channel.state ?? null,
          },
        ]
      : [];
  });

export type Route = { channelId: string; chatType: Transport; chatId: string };

/**
 * Where to answer a deal: the chat the patient last wrote from, else a chat
 * known for the patient, else WhatsApp on the patient's phone.
 */
export const chooseRoute = ({
  lastMessage,
  patientChats,
  phones,
  channels,
}: {
  lastMessage?: {
    transport: Transport;
    chat_id: string;
    channel_external_id?: string | null;
  } | null;
  patientChats: { transport: Transport; chat_id: string }[];
  phones: string[];
  channels: {
    external_id: string;
    transport: Transport;
    state?: string | null;
  }[];
}): Route | null => {
  const channelFor = (transport: Transport, preferred?: string | null) =>
    channels.find(
      (channel) =>
        channel.external_id === preferred && channel.transport === transport,
    ) ??
    channels.find(
      (channel) =>
        channel.transport === transport &&
        (channel.state == null || channel.state === "active"),
    ) ??
    channels.find((channel) => channel.transport === transport);

  const candidates: {
    transport: Transport;
    chatId: string;
    channel?: string | null;
  }[] = [
    ...(lastMessage
      ? [
          {
            transport: lastMessage.transport,
            chatId: lastMessage.chat_id,
            channel: lastMessage.channel_external_id,
          },
        ]
      : []),
    ...patientChats.map((chat) => ({
      transport: chat.transport,
      chatId: chat.chat_id,
    })),
    ...phones.map((phone) => ({
      transport: "whatsapp" as const,
      chatId: phone.replace(/\D/g, ""),
    })),
  ];
  for (const candidate of candidates) {
    const channel = channelFor(candidate.transport, candidate.channel);
    if (channel && candidate.chatId) {
      return {
        channelId: channel.external_id,
        chatType: toChatType(candidate.transport),
        chatId: candidate.chatId,
      };
    }
  }
  return null;
};
