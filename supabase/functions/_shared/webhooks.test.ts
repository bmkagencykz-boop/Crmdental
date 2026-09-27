// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  deliver,
  deliverAll,
  describeDeliveryError,
  isAllowedWebhookUrl,
  isDelivered,
  signatureHeader,
  signWebhook,
  verifyWebhookSignature,
  webhookBody,
  webhookHeaders,
  type ClaimedDelivery,
} from "./webhooks";

const delivery: ClaimedDelivery = {
  id: 42,
  organization_id: 1,
  webhook_id: 7,
  url: "https://partner.example/hooks/crm",
  secret: "s3cr3t",
  event: "deal.stage_changed",
  payload: {
    event: "deal.stage_changed",
    occurred_at: "2026-10-01T10:00:00+05:00",
    organization_id: 1,
    data: { deal_id: 5, previous_stage_id: 1 },
  },
  attempts: 0,
};

describe("webhookBody", () => {
  it("is the payload with the delivery id first", () => {
    const body = webhookBody(delivery);
    expect(
      body.startsWith('{"delivery_id":42,"event":"deal.stage_changed"'),
    ).toBe(true);
    expect(JSON.parse(body)).toEqual({ delivery_id: 42, ...delivery.payload });
  });
});

describe("signature", () => {
  it("is the HMAC-SHA256 of the raw body, hex", async () => {
    const body = webhookBody(delivery);
    const expected = createHmac("sha256", "s3cr3t").update(body).digest("hex");
    expect(await signWebhook("s3cr3t", body)).toBe(expected);
    expect(await signatureHeader("s3cr3t", body)).toBe(`sha256=${expected}`);
  });

  it("signs UTF-8 (Cyrillic texts)", async () => {
    const body = JSON.stringify({ text: "Здравствуйте, запишите меня" });
    expect(await signWebhook("ключ", body)).toBe(
      createHmac("sha256", "ключ").update(body, "utf8").digest("hex"),
    );
  });

  it("is verified by the receiver, and a changed body is refused", async () => {
    const body = webhookBody(delivery);
    const header = await signatureHeader("s3cr3t", body);
    expect(await verifyWebhookSignature("s3cr3t", body, header)).toBe(true);
    expect(await verifyWebhookSignature("other", body, header)).toBe(false);
    expect(
      await verifyWebhookSignature("s3cr3t", body.replace("42", "43"), header),
    ).toBe(false);
    expect(await verifyWebhookSignature("s3cr3t", body, null)).toBe(false);
  });
});

describe("webhookHeaders", () => {
  it("carries the event, the delivery id and the signature", () => {
    expect(webhookHeaders(delivery, "sha256=abc")).toEqual({
      "Content-Type": "application/json",
      "User-Agent": "DentalCRM-Webhooks/1.0",
      "X-DentalCRM-Event": "deal.stage_changed",
      "X-DentalCRM-Delivery": "42",
      "X-DentalCRM-Signature": "sha256=abc",
    });
  });
});

describe("isAllowedWebhookUrl", () => {
  it("accepts public http(s) addresses", () => {
    expect(isAllowedWebhookUrl("https://partner.example/hooks")).toBe(true);
    expect(isAllowedWebhookUrl("http://crm.clinic.kz:8080/in")).toBe(true);
  });

  it("refuses the platform's own network and other schemes", () => {
    for (const url of [
      "http://localhost:54321/functions/v1/users",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.20.0.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "http://db.internal/",
      "ftp://partner.example/",
      "https://user:pass@partner.example/",
      "not a url",
    ]) {
      expect(isAllowedWebhookUrl(url), url).toBe(false);
    }
  });
});

describe("deliver", () => {
  it("posts the signed body and reports a 2xx as delivered", async () => {
    const post = vi.fn(async () => ({ status: 204 }));
    expect(await deliver(delivery, post)).toEqual({
      ok: true,
      status: 204,
      error: null,
    });
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(delivery.url);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(
      await verifyWebhookSignature(
        "s3cr3t",
        init.body as string,
        headers["X-DentalCRM-Signature"],
      ),
    ).toBe(true);
  });

  it("reports other statuses and network errors as failures", async () => {
    expect(await deliver(delivery, async () => ({ status: 500 }))).toEqual({
      ok: false,
      status: 500,
      error: "HTTP 500",
    });
    expect(
      await deliver(delivery, async () => ({ status: 302 })),
    ).toMatchObject({ ok: false, error: "HTTP 302" });
    const timeout = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    expect(
      await deliver(delivery, async () => {
        throw timeout;
      }),
    ).toEqual({ ok: false, status: null, error: "Нет ответа за 10 с" });
    expect(
      await deliver(delivery, async () => {
        throw new Error("connection refused");
      }),
    ).toMatchObject({ error: "Ошибка соединения: connection refused" });
  });

  it("never posts to a private address", async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const result = await deliver(
      { ...delivery, url: "http://169.254.169.254/" },
      post,
    );
    expect(result.ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("isDelivered: 2xx only", () => {
    expect([200, 201, 204, 299].every(isDelivered)).toBe(true);
    expect([199, 301, 400, 500].some(isDelivered)).toBe(false);
  });

  it("describeDeliveryError", () => {
    expect(describeDeliveryError(404)).toBe("HTTP 404");
    expect(describeDeliveryError(null, "boom")).toBe("Ошибка соединения: boom");
    expect(describeDeliveryError(null)).toBe("Ошибка соединения");
  });

  it("deliverAll runs every item with limited concurrency", async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await deliverAll(
      [1, 2, 3, 4, 5, 6, 7],
      async (item) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        done.push(item);
        running--;
      },
      3,
    );
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });
});
