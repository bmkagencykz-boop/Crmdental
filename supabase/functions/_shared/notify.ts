/**
 * Employee notifications in Telegram (stage 16): one platform-wide bot
 * (NOTIFY_TELEGRAM_BOT_TOKEN), used by the edge functions
 * notifications_dispatch (sends) and notify_telegram_webhook (links a chat
 * with /start <code>). Pure functions only, so that they can be unit tested.
 */

export const TELEGRAM_API = "https://api.telegram.org";

export type NotificationKind =
  | "lead_assigned"
  | "patient_message"
  | "task_overdue"
  | "response_overdue"
  | "bot_handoff";

/** A notification to send, as returned by public.claim_telegram_notifications */
export type ClaimedNotification = {
  notification_id: number;
  chat_id: string;
  notification_kind: NotificationKind;
  notification_title: string;
  notification_body: string | null;
  notification_deal_id: number | null;
  clinic_name: string | null;
};

const KIND_ICONS: Record<NotificationKind, string> = {
  lead_assigned: "🆕",
  patient_message: "💬",
  task_overdue: "⏰",
  response_overdue: "🔥",
  bot_handoff: "🤝",
};

/** Telegram HTML parse mode: only &, < and > must be escaped */
export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Link to the deal page, when the address of the app is known */
export const dealUrl = (
  appUrl: string | null | undefined,
  dealId: number | null | undefined,
) => {
  const base = appUrl?.trim().replace(/\/+$/, "");
  if (!base || dealId == null) return null;
  return `${base}/deals/${dealId}/show`;
};

/** Telegram refuses messages longer than 4096 characters */
const MAX_BODY = 1000;

/**
 * The text of a notification in Telegram (HTML):
 *   🔥 <b>Пациент ждёт ответа</b>
 *   Иванова Асель · Имплантация · ждёт 20 мин
 *   <i>Клиника Улыбка</i>
 *   Открыть сделку
 */
export const formatTelegramNotification = (
  notification: Pick<
    ClaimedNotification,
    | "notification_kind"
    | "notification_title"
    | "notification_body"
    | "notification_deal_id"
    | "clinic_name"
  >,
  appUrl?: string | null,
) => {
  const icon = KIND_ICONS[notification.notification_kind] ?? "🔔";
  const lines = [
    `${icon} <b>${escapeHtml(notification.notification_title)}</b>`,
  ];
  const body = notification.notification_body?.trim();
  if (body) {
    lines.push(
      escapeHtml(
        body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
      ),
    );
  }
  if (notification.clinic_name?.trim()) {
    lines.push(`<i>${escapeHtml(notification.clinic_name.trim())}</i>`);
  }
  const url = dealUrl(appUrl, notification.notification_deal_id);
  if (url) {
    lines.push(`<a href="${escapeHtml(url)}">Открыть сделку</a>`);
  }
  return lines.join("\n");
};

/** A command sent to the bot by an employee */
export type BotCommand =
  | {
      type: "start";
      chatId: string;
      code: string | null;
      username: string | null;
    }
  | { type: "stop"; chatId: string }
  | { type: "other"; chatId: string };

/**
 * Reads a Telegram update (webhook body): /start <code>, /stop, or anything
 * else in a private chat. Group chats and other updates are ignored (null).
 */
export const parseBotUpdate = (update: unknown): BotCommand | null => {
  const message = (update as { message?: Record<string, any> } | null)?.message;
  const chat = message?.chat;
  if (!chat || chat.type !== "private" || chat.id == null) return null;
  const chatId = String(chat.id);
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const match = text.match(/^\/(start|stop)(?:@\w+)?(?:\s+(\S+))?/i);
  if (match?.[1]?.toLowerCase() === "start") {
    const code = match[2]?.trim() || null;
    return {
      type: "start",
      chatId,
      code: code && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : null,
      username:
        typeof message.from?.username === "string"
          ? message.from.username
          : null,
    };
  }
  if (match?.[1]?.toLowerCase() === "stop") return { type: "stop", chatId };
  return { type: "other", chatId };
};

/** Result of public.link_telegram_chat */
export type LinkResult = {
  linked: boolean;
  first_name?: string | null;
  clinic?: string | null;
};

/** What the bot answers, in Russian */
export const botReply = (
  command: BotCommand,
  result?: LinkResult | null,
  unlinked?: number,
) => {
  switch (command.type) {
    case "start":
      if (!command.code) {
        return "Здравствуйте! Это бот уведомлений CRM. Чтобы получать уведомления, откройте в CRM свой профиль и нажмите «Подключить Telegram».";
      }
      if (!result?.linked) {
        return "Код не подошёл или устарел. Откройте профиль в CRM и нажмите «Подключить Telegram» ещё раз.";
      }
      return `Готово${result.first_name ? `, ${result.first_name}` : ""}! Уведомления${result.clinic ? ` клиники «${result.clinic}»` : " CRM"} будут приходить сюда. Отключить: /stop или в профиле CRM.`;
    case "stop":
      return unlinked
        ? "Уведомления CRM отключены. Подключить снова можно в профиле CRM."
        : "Этот чат не подключён к уведомлениям CRM.";
    default:
      return "Этот бот только присылает уведомления CRM. Подключение — в профиле CRM, кнопка «Подключить Telegram». Отключить: /stop.";
  }
};

/**
 * The webhook of the bot is registered with a secret token (setWebhook
 * secret_token = NOTIFY_TELEGRAM_WEBHOOK_SECRET); Telegram sends it back in
 * the X-Telegram-Bot-Api-Secret-Token header.
 */
export const isWebhookAuthorized = (
  header: string | null,
  secret: string | null | undefined,
) => !!secret && !!header && header === secret;

/**
 * Telegram answered that the chat cannot receive messages any more (the
 * employee blocked the bot, deleted the chat): the chat is unlinked.
 */
export const isChatGone = (status: number, description?: string | null) =>
  status === 403 ||
  (status === 400 && /chat not found/i.test(description ?? ""));

/** Telegram allows about 30 messages per second in total for a bot */
export const MESSAGES_PER_SECOND = 20;
