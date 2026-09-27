/**
 * The clinic's own Telegram bot (Bot API, https://core.telegram.org/bots/api):
 * updates mapped to the shape of public.ingest_telegram_message, and the
 * helpers of telegram_connect / messenger_send. No Deno import here so that
 * it can be unit tested.
 */

export const TELEGRAM_API = "https://api.telegram.org";

/** Transport of the bot's channels, chats and messages */
export const TELEGRAM_BOT = "telegram_bot" as const;

export const telegramMethodUrl = (botToken: string, method: string) =>
  `${TELEGRAM_API}/bot${botToken}/${method}`;

/** Shape of a BotFather token: <bot id>:<secret> */
export const isBotToken = (value: string) =>
  /^\d{3,}:[A-Za-z0-9_-]{20,}$/.test(value.trim());

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramFile = { file_id: string; file_size?: number };

export type TelegramMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: string; username?: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramFile[];
  document?: TelegramFile & { file_name?: string; mime_type?: string };
  voice?: TelegramFile & { mime_type?: string };
  audio?: TelegramFile & { file_name?: string; mime_type?: string };
  video?: TelegramFile & { file_name?: string; mime_type?: string };
  sticker?: { emoji?: string };
  contact?: {
    phone_number: string;
    first_name?: string;
    last_name?: string;
    user_id?: number;
  };
  location?: { latitude: number; longitude: number };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramIngestMessage = {
  chat_id: string;
  external_id: string;
  direction: "in";
  text: string | null;
  content_uri: null;
  content_type: string;
  sent_at: string;
  contact: {
    name: string | null;
    username: string | null;
    phone: string | null;
  };
};

const fullName = (user?: { first_name?: string; last_name?: string }) =>
  [user?.first_name, user?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || null;

/**
 * What the patient sent: text, or a short description of an attachment.
 * The file itself is copied to our storage by telegram_webhook
 * (telegramMedia): a Telegram file link would expose the bot token.
 */
const content = (
  message: TelegramMessage,
): { text: string | null; type: string } => {
  const caption = message.caption?.trim();
  const withCaption = (label: string) =>
    caption ? `${label}: ${caption}` : label;
  if (message.text != null) return { text: message.text, type: "text" };
  if (message.photo) return { text: withCaption("[Фото]"), type: "image" };
  if (message.document) {
    return {
      text: withCaption(`[Файл ${message.document.file_name ?? ""}]`.trim()),
      type: "document",
    };
  }
  if (message.voice) return { text: "[Голосовое сообщение]", type: "audio" };
  if (message.audio) return { text: withCaption("[Аудио]"), type: "audio" };
  if (message.video) return { text: withCaption("[Видео]"), type: "video" };
  if (message.sticker) {
    return { text: message.sticker.emoji ?? "[Стикер]", type: "text" };
  }
  if (message.contact) {
    return { text: `Контакт: ${message.contact.phone_number}`, type: "text" };
  }
  if (message.location) {
    const { latitude, longitude } = message.location;
    return {
      text: `Геопозиция: https://maps.google.com/?q=${latitude},${longitude}`,
      type: "text",
    };
  }
  return { text: caption ?? null, type: "text" };
};

/**
 * An update of the bot, or null when it is not a message of a private chat
 * (groups, channels, edits, bots). The phone is only taken from a contact the
 * user shared about themselves ("Share my phone number" button).
 */
export const toTelegramIngestMessage = (
  update: TelegramUpdate,
): TelegramIngestMessage | null => {
  const message = update.message;
  if (!message || message.chat?.type !== "private" || message.from?.is_bot) {
    return null;
  }
  const chatId = String(message.chat.id);
  const { text, type } = content(message);
  const ownContact =
    message.contact &&
    (message.contact.user_id == null ||
      message.contact.user_id === message.from?.id);
  return {
    chat_id: chatId,
    external_id: `tg:${chatId}:${message.message_id}`,
    direction: "in",
    text,
    content_uri: null,
    content_type: type,
    sent_at: new Date(message.date * 1000).toISOString(),
    contact: {
      name: fullName(message.from) ?? fullName(message.contact),
      username: message.from?.username ?? message.chat.username ?? null,
      phone: ownContact ? message.contact!.phone_number : null,
    },
  };
};

/** The bot as a row of public.messenger_channels */
export const botChannel = (bot: TelegramUser) => ({
  external_id: `tgbot:${bot.id}`,
  transport: TELEGRAM_BOT,
  name: bot.username ? `@${bot.username}` : (fullName(bot) ?? String(bot.id)),
  state: "active",
});

/** setWebhook: updates are signed with the secret token header */
export const webhookBody = (url: string, secretToken: string) => ({
  url,
  secret_token: secretToken,
  allowed_updates: ["message"],
});

export const sendMessageBody = (chatId: string, text: string) => ({
  chat_id: chatId,
  text,
});

/** getFile of the Bot API only serves files up to 20 MB */
const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

/**
 * The file of an incoming message, to copy to our storage (getFile, then
 * download), or null: text, sticker, contact, too big.
 */
export const telegramMedia = (
  message: TelegramMessage,
): {
  file_id: string;
  name: string;
  mime: string;
  size: number | null;
} | null => {
  const pick = (file: TelegramFile | undefined, name: string, mime: string) =>
    file &&
    (file.file_size == null || file.file_size <= TELEGRAM_DOWNLOAD_LIMIT)
      ? { file_id: file.file_id, name, mime, size: file.file_size ?? null }
      : null;
  if (message.photo?.length) {
    // Sizes of the same photo, the largest last
    return pick(message.photo.at(-1), "photo.jpg", "image/jpeg");
  }
  if (message.document) {
    return pick(
      message.document,
      message.document.file_name ?? "file",
      message.document.mime_type ?? "application/octet-stream",
    );
  }
  if (message.voice) {
    return pick(
      message.voice,
      "voice.ogg",
      message.voice.mime_type ?? "audio/ogg",
    );
  }
  if (message.audio) {
    return pick(
      message.audio,
      message.audio.file_name ?? "audio.mp3",
      message.audio.mime_type ?? "audio/mpeg",
    );
  }
  if (message.video) {
    return pick(
      message.video,
      message.video.file_name ?? "video.mp4",
      message.video.mime_type ?? "video/mp4",
    );
  }
  return null;
};

/** Download address of a file (getFile's file_path): keep it server side */
export const telegramFileUrl = (botToken: string, filePath: string) =>
  `${TELEGRAM_API}/file/bot${botToken}/${filePath}`;

/** Telegram limits of a caption and of a photo sent by link / uploaded */
export const TELEGRAM_CAPTION_LIMIT = 1024;
const PHOTO_URL_LIMIT = 5 * 1024 * 1024;
const PHOTO_UPLOAD_LIMIT = 10 * 1024 * 1024;

export type TelegramFileRequest = {
  method:
    | "sendPhoto"
    | "sendDocument"
    | "sendVideo"
    | "sendAudio"
    | "sendVoice";
  /** Field of the file in the request */
  field: "photo" | "document" | "video" | "audio" | "voice";
  /**
   * Telegram downloads the link itself; else the function uploads the file
   * (multipart). By link, sendDocument only takes PDF, GIF and ZIP.
   */
  byUrl: boolean;
  params: { chat_id: string; caption?: string };
};

/**
 * How to send a text and/or a file through the clinic's bot: the file
 * request (with the caption), and a text message when there is no file or
 * the caption is too long for Telegram.
 */
export const telegramSendPlan = (
  chatId: string,
  {
    text,
    file,
  }: {
    text?: string | null;
    file?: { mime: string; size: number } | null;
  },
): {
  file: TelegramFileRequest | null;
  text: { chat_id: string; text: string } | null;
} => {
  if (!file) {
    return { file: null, text: sendMessageBody(chatId, text ?? "") };
  }
  const caption = text?.trim() ? text.trim() : null;
  const fits = caption != null && caption.length <= TELEGRAM_CAPTION_LIMIT;
  const mime = file.mime.toLowerCase();
  let request: Omit<TelegramFileRequest, "params">;
  if (
    ["image/jpeg", "image/png", "image/webp"].includes(mime) &&
    file.size <= PHOTO_UPLOAD_LIMIT
  ) {
    request = {
      method: "sendPhoto",
      field: "photo",
      byUrl: file.size <= PHOTO_URL_LIMIT,
    };
  } else if (mime === "video/mp4") {
    request = { method: "sendVideo", field: "video", byUrl: true };
  } else if (mime === "audio/mpeg" || mime === "audio/mp4") {
    request = { method: "sendAudio", field: "audio", byUrl: true };
  } else if (mime === "audio/ogg") {
    request = { method: "sendVoice", field: "voice", byUrl: true };
  } else {
    request = {
      method: "sendDocument",
      field: "document",
      byUrl: ["application/pdf", "image/gif", "application/zip"].includes(mime),
    };
  }
  return {
    file: {
      ...request,
      params: { chat_id: chatId, ...(fits ? { caption: caption! } : {}) },
    },
    text: caption && !fits ? sendMessageBody(chatId, caption) : null,
  };
};

/** Result of sendMessage as the status of our outgoing message */
export const toSendResult = (
  httpOk: boolean,
  body: unknown,
): {
  status: "sent" | "error";
  external_id: string | null;
  error: string | null;
} => {
  const result = body as {
    ok?: boolean;
    description?: string;
    result?: { message_id?: number; chat?: { id?: number } };
  } | null;
  if (httpOk && result?.ok && result.result?.message_id != null) {
    const chatId = result.result.chat?.id;
    return {
      status: "sent",
      external_id:
        chatId != null
          ? `tg:${chatId}:${result.result.message_id}`
          : `tg:${result.result.message_id}`,
      error: null,
    };
  }
  return {
    status: "error",
    external_id: null,
    error: result?.description ?? "Telegram did not accept the message",
  };
};

/**
 * Channels we can answer through: Wazzup24 channels when the Wazzup24 key is
 * set, the current bot's channel when the bot is connected (a replaced bot's
 * channel is "disconnected": its chats cannot be reached any more).
 */
export const usableChannels = <
  T extends { transport: string; state?: string | null },
>(
  channels: T[],
  connected: { wazzup: boolean; telegramBot: boolean },
) =>
  channels.filter((channel) =>
    channel.transport === TELEGRAM_BOT
      ? connected.telegramBot && channel.state !== "disconnected"
      : connected.wazzup,
  );
