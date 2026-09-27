import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  telegramFileUrl,
  telegramMedia,
  telegramMethodUrl,
  toTelegramIngestMessage,
  type TelegramUpdate,
} from "../_shared/telegram.ts";
import {
  copyIncomingFile,
  downloadUrl,
  type IngestResult,
  runInBackground,
} from "../_shared/incomingMedia.ts";

/**
 * Webhook of the clinic's Telegram bot, registered by telegram_connect:
 *   POST /functions/v1/telegram_webhook?token=<telegram_bots.webhook_token>
 * Telegram signs every update with the X-Telegram-Bot-Api-Secret-Token
 * header; public.ingest_telegram_message checks it, finds or creates the
 * patient by chat id and stores the message like any other messenger.
 * Telegram retries until it gets a 200. A photo, a document, a voice or a
 * video is then downloaded with the bot token (getFile) and copied to our
 * storage (copyIncomingFile): the token never reaches the browser.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const token = new URL(req.url).searchParams.get("token");
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!token || !secret) return new Response("Unauthorized", { status: 401 });

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const message = toTelegramIngestMessage(update);
  // Groups, edits, service updates: acknowledged and ignored
  if (!message) return new Response("OK");

  const { data: ingested, error } = await supabaseAdmin.rpc(
    "ingest_telegram_message",
    { webhook_token: token, secret_token: secret, message },
  );
  if (error?.code === "28000") {
    return new Response("Unauthorized", { status: 401 });
  }
  if (error) {
    console.error("ingest_telegram_message failed", error);
    return new Response("Error", { status: 500 });
  }
  const media = update.message ? telegramMedia(update.message) : null;
  if (media) {
    await runInBackground(
      copyIncomingFile(ingested as IngestResult, async () => {
        // The secret was checked by ingest_telegram_message
        const { data: bot } = await supabaseAdmin
          .from("telegram_bots")
          .select("bot_token")
          .eq("webhook_token", token)
          .maybeSingle();
        if (!bot?.bot_token) return null;
        const found = await fetch(telegramMethodUrl(bot.bot_token, "getFile"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: media.file_id }),
        })
          .then((response) => response.json())
          .catch(() => null);
        const filePath = found?.ok ? found.result?.file_path : null;
        if (!filePath) return null;
        const file = await downloadUrl(
          telegramFileUrl(bot.bot_token, filePath),
        );
        if (!file) return null;
        return { blob: file.blob, name: media.name, mime: media.mime };
      }),
    );
  }
  return new Response("OK");
});
