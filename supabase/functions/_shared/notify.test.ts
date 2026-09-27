// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  botReply,
  dealUrl,
  escapeHtml,
  formatTelegramNotification,
  isChatGone,
  isWebhookAuthorized,
  parseBotUpdate,
} from "./notify";

describe("formatTelegramNotification", () => {
  it("writes the title in bold, the body, the clinic and a link to the deal", () => {
    expect(
      formatTelegramNotification(
        {
          notification_kind: "response_overdue",
          notification_title: "Пациент ждёт ответа",
          notification_body: "Иванова Асель · Имплант · ждёт 20 мин",
          notification_deal_id: 42,
          clinic_name: "Улыбка",
        },
        "https://crm.example.kz/",
      ),
    ).toBe(
      [
        "🔥 <b>Пациент ждёт ответа</b>",
        "Иванова Асель · Имплант · ждёт 20 мин",
        "<i>Улыбка</i>",
        '<a href="https://crm.example.kz/deals/42/show">Открыть сделку</a>',
      ].join("\n"),
    );
  });

  it("escapes the text of the patient", () => {
    const text = formatTelegramNotification({
      notification_kind: "patient_message",
      notification_title: "Новое сообщение",
      notification_body: "Асель: <b>1 & 2</b>",
      notification_deal_id: 1,
      clinic_name: null,
    });
    expect(text).toBe(
      "💬 <b>Новое сообщение</b>\nАсель: &lt;b&gt;1 &amp; 2&lt;/b&gt;",
    );
  });

  it("shortens a long body and leaves out what is missing", () => {
    const text = formatTelegramNotification({
      notification_kind: "task_overdue",
      notification_title: "Задача просрочена",
      notification_body: "x".repeat(5000),
      notification_deal_id: null,
      clinic_name: " ",
    });
    const [title, body, ...rest] = text.split("\n");
    expect(title).toBe("⏰ <b>Задача просрочена</b>");
    expect(body).toHaveLength(1000);
    expect(body.endsWith("…")).toBe(true);
    expect(rest).toEqual([]);
  });
});

describe("dealUrl", () => {
  it("needs the address of the app and a deal", () => {
    expect(dealUrl("https://crm.kz", 5)).toBe("https://crm.kz/deals/5/show");
    expect(dealUrl(undefined, 5)).toBeNull();
    expect(dealUrl("https://crm.kz", null)).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the HTML of Telegram", () => {
    expect(escapeHtml("a < b > c & d")).toBe("a &lt; b &gt; c &amp; d");
  });
});

const update = (text: string, chatType = "private") => ({
  update_id: 1,
  message: {
    message_id: 1,
    from: { id: 99, username: "aigerim" },
    chat: { id: 99, type: chatType },
    text,
  },
});

describe("parseBotUpdate", () => {
  it("reads /start with the code of the deep link", () => {
    expect(parseBotUpdate(update("/start 0a1b2c3d4e5f6a7b"))).toEqual({
      type: "start",
      chatId: "99",
      code: "0a1b2c3d4e5f6a7b",
      username: "aigerim",
    });
  });
  it("reads /start without a code, or with an invalid one", () => {
    expect(parseBotUpdate(update("/start"))).toMatchObject({
      type: "start",
      code: null,
    });
    expect(parseBotUpdate(update("/start <script>"))).toMatchObject({
      type: "start",
      code: null,
    });
  });
  it("reads /stop and any other text", () => {
    expect(parseBotUpdate(update("/stop"))).toEqual({
      type: "stop",
      chatId: "99",
    });
    expect(parseBotUpdate(update("/stop@crm_notify_bot"))).toMatchObject({
      type: "stop",
    });
    expect(parseBotUpdate(update("привет"))).toEqual({
      type: "other",
      chatId: "99",
    });
  });
  it("ignores group chats and other updates", () => {
    expect(parseBotUpdate(update("/start abc", "group"))).toBeNull();
    expect(parseBotUpdate({ update_id: 2, edited_message: {} })).toBeNull();
    expect(parseBotUpdate(null)).toBeNull();
  });
});

describe("botReply", () => {
  const start = { type: "start" as const, chatId: "1", username: null };
  it("greets, links, or explains that the code is wrong", () => {
    expect(botReply({ ...start, code: null })).toMatch(/Подключить Telegram/);
    expect(botReply({ ...start, code: "x" }, { linked: false })).toMatch(
      /не подошёл/,
    );
    expect(
      botReply(
        { ...start, code: "x" },
        { linked: true, first_name: "Айгерим", clinic: "Улыбка" },
      ),
    ).toBe(
      "Готово, Айгерим! Уведомления клиники «Улыбка» будут приходить сюда. Отключить: /stop или в профиле CRM.",
    );
  });
  it("confirms /stop", () => {
    expect(botReply({ type: "stop", chatId: "1" }, null, 1)).toMatch(
      /отключены/,
    );
    expect(botReply({ type: "stop", chatId: "1" }, null, 0)).toMatch(
      /не подключён/,
    );
  });
});

describe("isWebhookAuthorized", () => {
  it("compares the secret token header", () => {
    expect(isWebhookAuthorized("s3cret", "s3cret")).toBe(true);
    expect(isWebhookAuthorized("nope", "s3cret")).toBe(false);
    expect(isWebhookAuthorized(null, "s3cret")).toBe(false);
    expect(isWebhookAuthorized("", "")).toBe(false);
    expect(isWebhookAuthorized("x", undefined)).toBe(false);
  });
});

describe("isChatGone", () => {
  it("recognises a blocked bot or a deleted chat", () => {
    expect(isChatGone(403, "Forbidden: bot was blocked by the user")).toBe(
      true,
    );
    expect(isChatGone(400, "Bad Request: chat not found")).toBe(true);
    expect(isChatGone(400, "Bad Request: message is too long")).toBe(false);
    expect(isChatGone(429)).toBe(false);
  });
});
