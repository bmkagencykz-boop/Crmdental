// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chooseRoute, toChannels, toIngestMessage } from "./messenger";

describe("toIngestMessage", () => {
  it("maps an incoming WhatsApp message", () => {
    expect(
      toIngestMessage({
        messageId: "m1",
        channelId: "c1",
        chatType: "whatsapp",
        chatId: "77015551234",
        dateTime: "2026-09-30T10:00:00.000Z",
        type: "text",
        status: "inbound",
        text: "Здравствуйте",
        contact: { name: "Даулет" },
      }),
    ).toEqual({
      channel_id: "c1",
      transport: "whatsapp",
      chat_id: "77015551234",
      external_id: "m1",
      direction: "in",
      text: "Здравствуйте",
      content_uri: null,
      content_type: "text",
      sent_at: "2026-09-30T10:00:00.000Z",
      contact: { name: "Даулет", phone: null, username: null },
    });
  });

  it("treats echoes (answers from the phone) as outgoing", () => {
    expect(
      toIngestMessage({
        chatType: "tgapi",
        chatId: "42",
        status: "sent",
        isEcho: true,
      }),
    ).toMatchObject({ transport: "telegram", direction: "out" });
  });

  it("ignores group chats and other messengers", () => {
    expect(toIngestMessage({ chatType: "whatsgroup", chatId: "1" })).toBe(null);
    expect(toIngestMessage({ chatType: "vk", chatId: "1" })).toBe(null);
    expect(toIngestMessage({ chatType: "whatsapp" })).toBe(null);
  });
});

describe("toChannels", () => {
  it("keeps WhatsApp, Instagram and Telegram channels", () => {
    expect(
      toChannels([
        { channelId: "a", transport: "whatsapp", plainId: "77010000000" },
        { channelId: "b", transport: "avito" },
        {
          channelId: "c",
          transport: "instagram",
          plainId: "clinic",
          state: "active",
        },
      ]),
    ).toEqual([
      {
        external_id: "a",
        transport: "whatsapp",
        name: "77010000000",
        state: null,
      },
      {
        external_id: "c",
        transport: "instagram",
        name: "clinic",
        state: "active",
      },
    ]);
  });
});

describe("chooseRoute", () => {
  const channels = [
    { external_id: "wa1", transport: "whatsapp" as const, state: "active" },
    { external_id: "ig1", transport: "instagram" as const, state: "active" },
  ];

  it("answers in the chat the patient last wrote from", () => {
    expect(
      chooseRoute({
        lastMessage: {
          transport: "instagram",
          chat_id: "ig-7",
          channel_external_id: "ig1",
        },
        patientChats: [],
        phones: ["+77015551234"],
        channels,
      }),
    ).toEqual({ channelId: "ig1", chatType: "instagram", chatId: "ig-7" });
  });

  it("falls back to WhatsApp on the patient's phone", () => {
    expect(
      chooseRoute({ patientChats: [], phones: ["+77015551234"], channels }),
    ).toEqual({
      channelId: "wa1",
      chatType: "whatsapp",
      chatId: "77015551234",
    });
  });

  it("finds nothing without a channel for the patient", () => {
    expect(
      chooseRoute({
        patientChats: [{ transport: "telegram", chat_id: "1" }],
        phones: [],
        channels,
      }),
    ).toBe(null);
  });
});
