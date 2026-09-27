// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chooseRoute } from "./messenger";
import {
  botChannel,
  isBotToken,
  telegramMethodUrl,
  toSendResult,
  toTelegramIngestMessage,
  usableChannels,
  webhookBody,
} from "./telegram";

const from = {
  id: 501,
  first_name: "Aigerim",
  last_name: "S",
  username: "aigerim_s",
};
const chat = { id: 501, type: "private" };

describe("toTelegramIngestMessage", () => {
  it("maps a text message of a private chat", () => {
    expect(
      toTelegramIngestMessage({
        update_id: 1,
        message: {
          message_id: 7,
          date: 1790000000,
          chat,
          from,
          text: "Здравствуйте!",
        },
      }),
    ).toEqual({
      chat_id: "501",
      external_id: "tg:501:7",
      direction: "in",
      text: "Здравствуйте!",
      content_uri: null,
      content_type: "text",
      sent_at: new Date(1790000000 * 1000).toISOString(),
      contact: { name: "Aigerim S", username: "aigerim_s", phone: null },
    });
  });

  it("describes attachments without links", () => {
    expect(
      toTelegramIngestMessage({
        update_id: 2,
        message: {
          message_id: 8,
          date: 1790000000,
          chat,
          from,
          photo: [{ file_id: "a" }],
          caption: "снимок",
        },
      }),
    ).toMatchObject({
      text: "[Фото]: снимок",
      content_type: "image",
      content_uri: null,
    });
    expect(
      toTelegramIngestMessage({
        update_id: 3,
        message: {
          message_id: 9,
          date: 1790000000,
          chat,
          from,
          document: { file_id: "b", file_name: "plan.pdf" },
        },
      }),
    ).toMatchObject({ text: "[Файл plan.pdf]", content_type: "document" });
  });

  it("takes the phone of a contact the user shared about themselves", () => {
    expect(
      toTelegramIngestMessage({
        update_id: 4,
        message: {
          message_id: 10,
          date: 1790000000,
          chat,
          from,
          contact: { phone_number: "77021112233", user_id: 501 },
        },
      }),
    ).toMatchObject({
      text: "Контакт: 77021112233",
      contact: { phone: "77021112233" },
    });
    // Somebody else's contact is only text
    expect(
      toTelegramIngestMessage({
        update_id: 5,
        message: {
          message_id: 11,
          date: 1790000000,
          chat,
          from,
          contact: { phone_number: "77019998877", user_id: 42 },
        },
      })?.contact.phone,
    ).toBe(null);
  });

  it("ignores groups, bots and updates without a message", () => {
    expect(
      toTelegramIngestMessage({
        update_id: 6,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: -100, type: "supergroup" },
          from,
          text: "x",
        },
      }),
    ).toBe(null);
    expect(
      toTelegramIngestMessage({
        update_id: 7,
        message: {
          message_id: 1,
          date: 1,
          chat,
          from: { ...from, is_bot: true },
          text: "x",
        },
      }),
    ).toBe(null);
    expect(toTelegramIngestMessage({ update_id: 8 })).toBe(null);
  });
});

describe("bot helpers", () => {
  it("builds the channel, the webhook and the method URLs", () => {
    expect(
      botChannel({ id: 123, first_name: "Smile", username: "smile_bot" }),
    ).toEqual({
      external_id: "tgbot:123",
      transport: "telegram_bot",
      name: "@smile_bot",
      state: "active",
    });
    expect(webhookBody("https://x/telegram_webhook?token=t", "s")).toEqual({
      url: "https://x/telegram_webhook?token=t",
      secret_token: "s",
      allowed_updates: ["message"],
    });
    expect(telegramMethodUrl("1:a", "getMe")).toBe(
      "https://api.telegram.org/bot1:a/getMe",
    );
  });

  it("checks the shape of a BotFather token", () => {
    expect(isBotToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(
      true,
    );
    expect(isBotToken("not a token")).toBe(false);
  });

  it("turns the sendMessage answer into a delivery status", () => {
    expect(
      toSendResult(true, {
        ok: true,
        result: { message_id: 12, chat: { id: 501 } },
      }),
    ).toEqual({ status: "sent", external_id: "tg:501:12", error: null });
    expect(
      toSendResult(false, {
        ok: false,
        description: "Forbidden: bot was blocked by the user",
      }),
    ).toEqual({
      status: "error",
      external_id: null,
      error: "Forbidden: bot was blocked by the user",
    });
    expect(toSendResult(false, null).status).toBe("error");
  });
});

describe("routing with the bot", () => {
  const channels = [
    { external_id: "wa", transport: "whatsapp" as const, state: "active" },
    { external_id: "tgbot:123", transport: "telegram_bot" as const },
  ];

  it("keeps only the channels of connected providers", () => {
    expect(
      usableChannels(channels, { wazzup: false, telegramBot: true }),
    ).toEqual([channels[1]]);
    expect(
      usableChannels(channels, { wazzup: true, telegramBot: false }),
    ).toEqual([channels[0]]);
    // A replaced bot's channel cannot answer
    expect(
      usableChannels(
        [
          ...channels,
          {
            external_id: "tgbot:99",
            transport: "telegram_bot" as const,
            state: "disconnected",
          },
        ],
        { wazzup: true, telegramBot: true },
      ),
    ).toEqual(channels);
  });

  it("answers in the bot chat the patient last wrote from", () => {
    expect(
      chooseRoute({
        lastMessage: {
          transport: "telegram_bot",
          chat_id: "501",
          channel_external_id: "tgbot:123",
        },
        patientChats: [],
        phones: ["+77015551234"],
        channels,
      }),
    ).toEqual({
      channelId: "tgbot:123",
      chatType: "telegram_bot",
      chatId: "501",
    });
  });

  it("falls back to WhatsApp when the bot is disconnected", () => {
    expect(
      chooseRoute({
        lastMessage: { transport: "telegram_bot", chat_id: "501" },
        patientChats: [{ transport: "telegram_bot", chat_id: "501" }],
        phones: ["+77015551234"],
        channels: usableChannels(channels, {
          wazzup: true,
          telegramBot: false,
        }),
      }),
    ).toEqual({
      channelId: "wa",
      chatType: "whatsapp",
      chatId: "77015551234",
    });
  });
});
