import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  botReply,
  isWebhookAuthorized,
  parseBotUpdate,
  TELEGRAM_API,
  type LinkResult,
} from "../_shared/notify.ts";

/**
 * Webhook of the platform notification bot (NOTIFY_TELEGRAM_BOT_TOKEN).
 * Registered with setWebhook and secret_token = NOTIFY_TELEGRAM_WEBHOOK_SECRET
 * (see docs/stages/16-notifications.md). An employee opens
 * t.me/<bot>?start=<code> from their profile: /start <code> links the chat to
 * them (public.link_telegram_chat); /stop unlinks it. Telegram gets 200 even
 * when the command fails, otherwise it keeps retrying.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (
    !isWebhookAuthorized(
      req.headers.get("X-Telegram-Bot-Api-Secret-Token"),
      Deno.env.get("NOTIFY_TELEGRAM_WEBHOOK_SECRET"),
    )
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = Deno.env.get("NOTIFY_TELEGRAM_BOT_TOKEN");
  const command = parseBotUpdate(await req.json().catch(() => null));
  if (!command || !token) return new Response("ok");

  let result: LinkResult | null = null;
  let unlinked = 0;
  if (command.type === "start" && command.code) {
    const { data, error } = await supabaseAdmin.rpc("link_telegram_chat", {
      link_code: command.code,
      chat_id: command.chatId,
      chat_username: command.username,
    });
    if (error) console.error("link_telegram_chat failed", error);
    result = (data as LinkResult | null) ?? { linked: false };
  } else if (command.type === "stop") {
    const { data, error } = await supabaseAdmin.rpc("unlink_telegram_chat", {
      chat_id: command.chatId,
    });
    if (error) console.error("unlink_telegram_chat failed", error);
    unlinked = (data as number | null) ?? 0;
  }

  const reply = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: command.chatId,
      text: botReply(command, result, unlinked),
    }),
  }).catch((error) => {
    console.error("Telegram unreachable", error);
    return null;
  });
  if (reply && !reply.ok) {
    console.error("Telegram refused the reply", reply.status);
  }
  return new Response("ok");
});
