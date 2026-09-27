import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { isDispatchAuthorized } from "../_shared/automessages.ts";
import {
  formatTelegramNotification,
  isChatGone,
  MESSAGES_PER_SECOND,
  TELEGRAM_API,
  type ClaimedNotification,
} from "../_shared/notify.ts";

/** Notifications taken per run (the run is every minute) */
const MAX_ROWS = 200;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the new notifications to the employees who linked their Telegram.
 * Started every minute by pg_cron (private.notifications_tick ->
 * private.request_notifications_dispatch) with the key
 * NOTIFICATIONS_DISPATCH_KEY, or by hand with the service role key.
 * public.claim_telegram_notifications chooses the rows (linked chat,
 * Telegram on, kind on); each one is marked sent or failed here. A chat that
 * blocked the bot is unlinked.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  if (
    !isDispatchAuthorized(req.headers.get("Authorization"), [
      Deno.env.get("NOTIFICATIONS_DISPATCH_KEY"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    ])
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = Deno.env.get("NOTIFY_TELEGRAM_BOT_TOKEN");
  if (!token) {
    return new Response("NOTIFY_TELEGRAM_BOT_TOKEN is not set", {
      status: 500,
    });
  }

  const { data, error } = await supabaseAdmin.rpc(
    "claim_telegram_notifications",
    { max_rows: MAX_ROWS },
  );
  if (error) {
    console.error("claim_telegram_notifications failed", error);
    return new Response("Error", { status: 500 });
  }
  const rows = (data ?? []) as ClaimedNotification[];
  const appUrl = Deno.env.get("NOTIFY_APP_URL");
  const interval = Math.ceil(1000 / MESSAGES_PER_SECOND);

  let sent = 0;
  let failed = 0;
  const goneChats = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (index > 0) await wait(interval);
    let ok = false;
    if (!goneChats.has(row.chat_id)) {
      try {
        const response = await fetch(
          `${TELEGRAM_API}/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: row.chat_id,
              text: formatTelegramNotification(row, appUrl),
              parse_mode: "HTML",
              link_preview_options: { is_disabled: true },
            }),
          },
        );
        ok = response.ok;
        if (!ok) {
          const detail = await response.json().catch(() => ({}));
          console.error("Telegram refused", response.status, detail);
          if (isChatGone(response.status, detail?.description)) {
            goneChats.add(row.chat_id);
          }
        }
      } catch (sendError) {
        console.error("Telegram unreachable", sendError);
      }
    }
    const { error: updateError } = await supabaseAdmin
      .from("notifications")
      .update(
        ok
          ? {
              telegram_status: "sent",
              telegram_sent_at: new Date().toISOString(),
            }
          : { telegram_status: "failed" },
      )
      .eq("id", row.notification_id)
      .eq("telegram_status", "sending");
    if (updateError) console.error("Marking", row.notification_id, updateError);
    if (ok) sent++;
    else failed++;
  }

  for (const chatId of goneChats) {
    const { error: unlinkError } = await supabaseAdmin.rpc(
      "unlink_telegram_chat",
      { chat_id: chatId },
    );
    if (unlinkError) console.error("Unlinking", chatId, unlinkError);
  }

  return new Response(JSON.stringify({ claimed: rows.length, sent, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
