/**
 * Outgoing webhooks of a clinic (edge function webhooks_dispatch): body,
 * HMAC-SHA256 signature and headers of a delivery. No Deno import here so
 * that it can be unit tested (Web Crypto is global in Deno and Node).
 */

/** A due delivery, as returned by public.claim_webhook_deliveries */
export type ClaimedDelivery = {
  id: number;
  organization_id: number;
  webhook_id: number;
  url: string;
  secret: string;
  event: string;
  /** { event, occurred_at, organization_id, data } */
  payload: Record<string, unknown>;
  attempts: number;
};

export type DeliveryResult = {
  ok: boolean;
  status: number | null;
  error: string | null;
};

export const SIGNATURE_HEADER = "X-DentalCRM-Signature";
export const EVENT_HEADER = "X-DentalCRM-Event";
export const DELIVERY_HEADER = "X-DentalCRM-Delivery";

/** A receiver answering slower than this counts as a failure */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** The JSON posted: the queued payload with the id of the delivery first */
export const webhookBody = (delivery: ClaimedDelivery) =>
  JSON.stringify({ delivery_id: delivery.id, ...delivery.payload });

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** HMAC-SHA256 of the raw body with the webhook secret, hex */
export const signWebhook = async (secret: string, body: string) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
};

/** Header value: sha256=<hex>, as GitHub and Stripe-like receivers expect */
export const signatureHeader = async (secret: string, body: string) =>
  `sha256=${await signWebhook(secret, body)}`;

/**
 * How a receiver checks a delivery (same as the example of the API docs):
 * the header must be the HMAC of the raw body. Constant-time comparison.
 */
export const verifyWebhookSignature = async (
  secret: string,
  body: string,
  header: string | null | undefined,
) => {
  if (!header) return false;
  const expected = await signatureHeader(secret, body);
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ header.charCodeAt(index);
  }
  return diff === 0;
};

export const webhookHeaders = (
  delivery: ClaimedDelivery,
  signature: string,
) => ({
  "Content-Type": "application/json",
  "User-Agent": "DentalCRM-Webhooks/1.0",
  [EVENT_HEADER]: delivery.event,
  [DELIVERY_HEADER]: String(delivery.id),
  [SIGNATURE_HEADER]: signature,
});

/** Any 2xx answer is a delivery; redirects are not followed */
export const isDelivered = (status: number) => status >= 200 && status < 300;

/** Error shown in the settings, in Russian */
export const describeDeliveryError = (
  status: number | null,
  error?: unknown,
): string => {
  if (status != null) {
    return `HTTP ${status}`;
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return `Нет ответа за ${DELIVERY_TIMEOUT_MS / 1000} с`;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message ? `Ошибка соединения: ${message}` : "Ошибка соединения";
};

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$/i;

/**
 * Deliveries only go to public http(s) addresses: not to the servers of the
 * platform itself (localhost, private networks, cloud metadata).
 */
export const isAllowedWebhookUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password &&
    !PRIVATE_HOST.test(url.hostname)
  );
};

/**
 * Posts one delivery. `post` is fetch in the function, a stub in the tests.
 */
export const deliver = async (
  delivery: ClaimedDelivery,
  post: (url: string, init: RequestInit) => Promise<{ status: number }>,
): Promise<DeliveryResult> => {
  if (!isAllowedWebhookUrl(delivery.url)) {
    return {
      ok: false,
      status: null,
      error: "Адрес недоступен: нужен публичный http(s)-адрес",
    };
  }
  const body = webhookBody(delivery);
  const signature = await signatureHeader(delivery.secret, body);
  try {
    const response = await post(delivery.url, {
      method: "POST",
      headers: webhookHeaders(delivery, signature),
      body,
      redirect: "manual",
    });
    return isDelivered(response.status)
      ? { ok: true, status: response.status, error: null }
      : {
          ok: false,
          status: response.status,
          error: describeDeliveryError(response.status),
        };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: describeDeliveryError(null, error),
    };
  }
};

/** Runs the deliveries a few at a time (one slow receiver does not stall all) */
export const deliverAll = async <T>(
  items: T[],
  send: (item: T) => Promise<void>,
  concurrency = 5,
) => {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await send(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
};
