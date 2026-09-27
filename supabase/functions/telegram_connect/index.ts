import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import {
  botChannel,
  isBotToken,
  TELEGRAM_BOT,
  telegramMethodUrl,
  webhookBody,
  type TelegramUser,
} from "../_shared/telegram.ts";

/** Public base URL of the functions (Telegram must reach the webhook) */
const functionsUrl = () =>
  Deno.env.get("WEBHOOK_BASE_URL") ??
  `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

const json = (data: unknown) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const callBot = async (botToken: string, method: string, body?: unknown) => {
  const response = await fetch(telegramMethodUrl(botToken, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json().catch(() => null);
  return { ok: response.ok && !!result?.ok, result };
};

/**
 * Settings → Messengers → Telegram bot (owner or head): checks the BotFather
 * token (getMe), keeps it server-side only and registers the webhook with a
 * secret token. Body: { bot_token } to connect, { disconnect: true } to stop.
 */
Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        if (req.method !== "POST") {
          return createErrorResponse(405, "Method Not Allowed");
        }
        const sale = user ? await getUserSale(user) : null;
        if (!sale || sale.disabled || !["owner", "head"].includes(sale.role)) {
          return createErrorResponse(403, "Forbidden");
        }
        const organizationId = sale.organization_id;
        const body = await req.json().catch(() => ({}));

        if (body.disconnect) {
          const { data: bot } = await supabaseAdmin
            .from("telegram_bots")
            .select("bot_token, bot_id")
            .eq("organization_id", organizationId)
            .maybeSingle();
          if (bot?.bot_token) {
            await callBot(bot.bot_token, "deleteWebhook").catch(() => null);
          }
          await supabaseAdmin
            .from("telegram_bots")
            .update({ bot_token: null, connected_at: null, last_error: null })
            .eq("organization_id", organizationId);
          if (bot?.bot_id) {
            await supabaseAdmin
              .from("messenger_channels")
              .update({ state: "disconnected" })
              .eq("organization_id", organizationId)
              .eq("external_id", `tgbot:${bot.bot_id}`);
          }
          return json({ connected: false });
        }

        const botToken =
          typeof body.bot_token === "string" ? body.bot_token.trim() : "";
        if (!isBotToken(botToken)) {
          return createErrorResponse(400, "Invalid bot token", {
            code: "invalid_bot_token",
          });
        }
        const me = await callBot(botToken, "getMe").catch(() => null);
        if (!me?.ok) {
          return createErrorResponse(400, "Telegram refused the bot token", {
            code: "invalid_bot_token",
          });
        }
        const bot = me.result.result as TelegramUser;

        const { data: saved, error } = await supabaseAdmin
          .from("telegram_bots")
          .upsert(
            {
              organization_id: organizationId,
              bot_token: botToken,
              bot_id: bot.id,
              username: bot.username ?? null,
              name: bot.first_name ?? null,
              connected_at: new Date().toISOString(),
              last_error: null,
            },
            { onConflict: "organization_id" },
          )
          .select("webhook_token, secret_token")
          .single();
        if (error || !saved) {
          console.error("Saving the bot failed", error);
          return createErrorResponse(500, "Internal Server Error");
        }

        const channel = botChannel(bot);
        await supabaseAdmin
          .from("messenger_channels")
          .upsert(
            { ...channel, organization_id: organizationId },
            { onConflict: "organization_id,external_id" },
          );
        // A previous bot of the clinic cannot answer its chats any more
        await supabaseAdmin
          .from("messenger_channels")
          .update({ state: "disconnected" })
          .eq("organization_id", organizationId)
          .eq("transport", TELEGRAM_BOT)
          .neq("external_id", channel.external_id);

        const webhook = await callBot(
          botToken,
          "setWebhook",
          webhookBody(
            `${functionsUrl()}/telegram_webhook?token=${saved.webhook_token}`,
            saved.secret_token,
          ),
        ).catch(() => null);
        if (!webhook?.ok) {
          const lastError = `setWebhook: ${
            webhook?.result?.description ?? "no answer from Telegram"
          }`;
          await supabaseAdmin
            .from("telegram_bots")
            .update({ last_error: lastError })
            .eq("organization_id", organizationId);
          return createErrorResponse(502, lastError, {
            code: "telegram_webhook_failed",
          });
        }

        return json({
          connected: true,
          transport: TELEGRAM_BOT,
          username: bot.username ?? null,
          name: bot.first_name ?? null,
        });
      }),
    ),
  ),
);
