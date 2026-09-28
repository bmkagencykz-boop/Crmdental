import { describe, expect, it } from "vitest";
import {
  functionsBaseUrl,
  leadFormSnippet,
  leadNoteText,
  leadWebhookUrl,
} from "./leadWebhook";

describe("leadWebhookUrl", () => {
  it("points to the leads_webhook function with the token", () => {
    expect(
      leadWebhookUrl(functionsBaseUrl("https://x.supabase.co/"), "abc"),
    ).toBe("https://x.supabase.co/functions/v1/leads_webhook?token=abc");
    expect(
      leadWebhookUrl(functionsBaseUrl("https://x", "https://hooks.kz"), "a b"),
    ).toBe("https://hooks.kz/leads_webhook?token=a%20b");
  });
});

describe("leadFormSnippet", () => {
  const texts = {
    name: "Имя",
    phone: "Телефон",
    comment: "Комментарий",
    submit: "Записаться",
    thanks: 'Спасибо "<3"',
    error: "Ошибка",
  };

  it("posts the form and the UTM tags to the webhook", () => {
    const snippet = leadFormSnippet("https://h/leads_webhook?token=t", texts);
    expect(snippet).toContain('fetch("https://h/leads_webhook?token=t"');
    expect(snippet).toContain('name="phone" type="tel"');
    expect(snippet).toContain("utm_source");
    expect(snippet).toContain("data.referrer = document.referrer");
    expect(snippet).toContain("data.landing_page");
    expect(snippet).toContain("Записаться</button>");
  });

  it("escapes the texts", () => {
    expect(leadFormSnippet("u", texts)).toContain("Спасибо &quot;&lt;3&quot;");
  });
});

describe("leadNoteText", () => {
  it("writes the form like the database", () => {
    expect(
      leadNoteText({
        repeat: false,
        sourceName: "Сайт",
        name: "Даулет",
        phone: "+77015551234",
        comment: "Перезвоните",
      }),
    ).toBe(
      "Заявка (Сайт)\nИмя: Даулет\nТелефон: +77015551234\nКомментарий: Перезвоните",
    );
    expect(
      leadNoteText({ repeat: true, sourceName: "2GIS", phone: "+7" }),
    ).toBe("Повторная заявка (2GIS)\nТелефон: +7");
  });
});
