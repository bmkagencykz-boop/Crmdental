/**
 * Telephony webhooks (Binotel, Zadarma, Mango Office, generic JSON) mapped to
 * the provider-neutral shape of public.ingest_call, signature checks and
 * recording links. No Deno import here so that it can be unit tested; the
 * network calls take the fetch function as a parameter.
 *
 * Payload formats follow the providers' public documentation. Fields we are
 * not sure about are read tolerantly (several names, strings or numbers);
 * see docs/stages/12-telephony.md, «проверить на живом аккаунте».
 */

export const PROVIDERS = ["binotel", "zadarma", "mango", "generic"] as const;
export type TelephonyProvider = (typeof PROVIDERS)[number];

export const isProvider = (value: unknown): value is TelephonyProvider =>
  PROVIDERS.includes(value as TelephonyProvider);

export type CallStatus = "in_progress" | "answered" | "missed";

/** Argument `call` of public.ingest_call */
export type IngestCall = {
  call_id: string;
  direction?: "in" | "out";
  phone?: string | null;
  extension?: string | null;
  /** ISO date; null when unknown (the database uses the reception time) */
  started_at?: string | null;
  duration?: number;
  /** null: the call is not over, the stored status is kept */
  status?: CallStatus | null;
  record_url?: string | null;
  name?: string | null;
};

/** What to ask the provider's API for the recording of a call */
export type RecordingRequest =
  | { provider: "binotel"; generalCallId: string }
  | { provider: "zadarma"; callIdWithRec?: string; pbxCallId: string }
  | { provider: "mango"; recordingId: string };

export type CallEvent = { call: IngestCall; recording?: RecordingRequest };

type Payload = Record<string, unknown>;

// --- request ---------------------------------------------------------------

/**
 * Where the webhook came from:
 *   /telephony_webhook?provider=zadarma&token=abc
 *   /telephony_webhook/mango/abc/events/summary   (Mango Office appends the event)
 *   /telephony_webhook?provider=mango&token=abc/events/summary
 */
export const parseWebhookAddress = (url: URL) => {
  const segments = url.pathname.split("/").filter(Boolean);
  const at = segments.indexOf("telephony_webhook");
  const rest = at >= 0 ? segments.slice(at + 1) : [];
  const fromPath = isProvider(rest[0]) ? rest[0] : undefined;
  const pathToken = fromPath ? rest[1] : rest[0];
  const pathEvent = (fromPath ? rest.slice(2) : rest.slice(1)).join("/");
  const [queryToken, ...queryEvent] = (
    url.searchParams.get("token") ?? ""
  ).split("/");
  const queryProvider = url.searchParams.get("provider")?.split("/")[0];
  return {
    provider: (isProvider(queryProvider) ? queryProvider : fromPath) as
      | TelephonyProvider
      | undefined,
    token: queryToken || pathToken || undefined,
    event: queryEvent.join("/") || pathEvent || undefined,
  };
};

/**
 * Form fields (a[b][c]=1 becomes { a: { b: { c: "1" } } }) or JSON.
 * Binotel, Zadarma and Mango Office post forms, the generic format JSON.
 */
export const parseWebhookBody = (
  raw: string,
  contentType?: string | null,
): Payload => {
  const text = raw.trim();
  if (contentType?.includes("json") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  const result: Payload = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const path = key.replace(/\]/g, "").split("[");
    let node = result;
    path.forEach((part, index) => {
      if (index === path.length - 1) {
        node[part] = value;
      } else {
        if (typeof node[part] !== "object" || node[part] == null) {
          node[part] = {};
        }
        node = node[part] as Payload;
      }
    });
  }
  return result;
};

// --- helpers ---------------------------------------------------------------

const text = (value: unknown): string | null => {
  if (value == null) return null;
  const result = String(value).trim();
  return result === "" ? null : result;
};

const number = (value: unknown): number => {
  const result = Number(value);
  return Number.isFinite(result) && result > 0 ? Math.round(result) : 0;
};

const object = (value: unknown): Payload =>
  value && typeof value === "object" ? (value as Payload) : {};

/**
 * ISO date from a Unix time (seconds or milliseconds) or a date with a time
 * zone. A local date without zone ("2026-10-06 12:00:00", Zadarma) gives
 * null: the time zone of the PBX is unknown, the database uses now.
 */
export const toIsoDate = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n <= 0) return null;
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
};

const isAudioUrl = (value: string | null): value is string =>
  !!value && /^https?:\/\//i.test(value);

// --- Binotel ---------------------------------------------------------------

/** Binotel dispositions of a call that someone answered */
const BINOTEL_ANSWERED = ["ANSWER", "TRANSFER", "ONLINE"];

/**
 * Binotel (https://developers.binotel.ua/): API CALL SETTINGS webhooks.
 * - receivedTheCall / answeredTheCall: the call starts, an employee picks up;
 * - apiCallCompleted: callDetails[...] of the finished call (generalCallID,
 *   callType 0 incoming / 1 outgoing, externalNumber, internalNumber,
 *   startTime, billsec, disposition).
 * The recording is fetched through the API (stats/call-record).
 */
export const binotelToCall = (body: Payload): CallEvent | null => {
  const details = object(body.callDetails);
  const completed =
    body.requestType === "apiCallCompleted" || Object.keys(details).length > 0;
  const source = completed && Object.keys(details).length ? details : body;
  const callId = text(source.generalCallID) ?? text(source.callID);
  if (!callId) return null;
  const direction = String(source.callType ?? "0") === "1" ? "out" : "in";
  const call: IngestCall = {
    call_id: callId,
    direction,
    phone: text(source.externalNumber),
    extension:
      text(source.internalNumber) ??
      text(object(source.employeeData).extNumber),
    started_at: toIsoDate(source.startTime),
    name: text(object(source.customerData).name),
  };
  if (!completed) return { call: { ...call, status: null } };

  const disposition = String(source.disposition ?? "").toUpperCase();
  const billsec = number(source.billsec);
  const answered = BINOTEL_ANSWERED.includes(disposition) && billsec > 0;
  const directLink =
    text(source.recordingLink) ??
    text(source.callRecordUrl) ??
    text(source.linkToCallRecord);
  return {
    call: {
      ...call,
      status:
        disposition === "ONLINE" && !billsec
          ? null
          : answered
            ? "answered"
            : "missed",
      duration: billsec,
      record_url: isAudioUrl(directLink) ? directLink : null,
    },
    recording:
      answered && !isAudioUrl(directLink)
        ? { provider: "binotel", generalCallId: callId }
        : undefined,
  };
};

// --- Zadarma ---------------------------------------------------------------

/**
 * Zadarma (https://zadarma.com/ru/support/api/#api_webhooks), PBX
 * notifications. pbx_call_id is the same for every event of a call.
 * - NOTIFY_START / NOTIFY_END: incoming call (caller_id, called_did, internal);
 * - NOTIFY_OUT_START / NOTIFY_OUT_END: outgoing call (internal, destination);
 * - NOTIFY_ANSWER: an employee picked up;
 * - NOTIFY_RECORD: the recording is ready (call_id_with_rec), its link comes
 *   from the API (pbx/record/request);
 * - NOTIFY_INTERNAL and others are ignored.
 */
export const zadarmaToCall = (body: Payload): CallEvent | null => {
  const event = text(body.event);
  const callId = text(body.pbx_call_id);
  if (!event || !callId) return null;
  // disposition: answered, busy, cancel, no answer, failed, no money...
  const finalStatus = (): CallStatus =>
    String(body.disposition ?? "").toLowerCase() === "answered"
      ? "answered"
      : "missed";
  switch (event) {
    case "NOTIFY_START":
      return {
        call: {
          call_id: callId,
          direction: "in",
          phone: text(body.caller_id),
          started_at: toIsoDate(body.call_start),
          status: null,
        },
      };
    case "NOTIFY_ANSWER":
      return {
        call: {
          call_id: callId,
          direction: "in",
          phone: text(body.caller_id),
          extension: text(body.internal) ?? text(body.destination),
          status: null,
        },
      };
    case "NOTIFY_END":
      return {
        call: {
          call_id: callId,
          direction: "in",
          phone: text(body.caller_id),
          extension: text(body.internal),
          started_at: toIsoDate(body.call_start),
          duration: number(body.duration),
          status: finalStatus(),
        },
      };
    case "NOTIFY_OUT_START":
      return {
        call: {
          call_id: callId,
          direction: "out",
          phone: text(body.destination),
          extension: text(body.internal),
          started_at: toIsoDate(body.call_start),
          status: null,
        },
      };
    case "NOTIFY_OUT_END":
      return {
        call: {
          call_id: callId,
          direction: "out",
          phone: text(body.destination),
          extension: text(body.internal),
          started_at: toIsoDate(body.call_start),
          duration: number(body.duration),
          status: finalStatus(),
        },
      };
    case "NOTIFY_RECORD":
      return {
        call: { call_id: callId },
        recording: {
          provider: "zadarma",
          pbxCallId: callId,
          callIdWithRec: text(body.call_id_with_rec) ?? undefined,
        },
      };
    default:
      return null;
  }
};

/** The string Zadarma signs for each event (header Signature) */
export const zadarmaSignedString = (body: Payload): string | null => {
  const v = (key: string) => text(body[key]) ?? "";
  switch (body.event) {
    case "NOTIFY_START":
    case "NOTIFY_INTERNAL":
    case "NOTIFY_END":
      return v("caller_id") + v("called_did") + v("call_start");
    case "NOTIFY_ANSWER":
      return v("caller_id") + v("destination") + v("call_start");
    case "NOTIFY_OUT_START":
    case "NOTIFY_OUT_END":
      return v("internal") + v("destination") + v("call_start");
    case "NOTIFY_RECORD":
      return v("pbx_call_id") + v("call_id_with_rec");
    default:
      return null;
  }
};

/**
 * Zadarma signature: base64(hmac_sha1(string, secret)). The PHP samples
 * encode the hex digest, so both forms are accepted.
 */
export const verifyZadarma = async (
  body: Payload,
  signature: string | null,
  secret: string,
) => {
  const signed = zadarmaSignedString(body);
  if (signed == null || !signature) return false;
  const digest = await hmac("SHA-1", secret, signed);
  return (
    signature === base64(new TextEncoder().encode(toHex(digest))) ||
    signature === base64(digest)
  );
};

/** Authorization header of the Zadarma API: key:base64(hex hmac_sha1) */
export const zadarmaAuthorization = async (
  method: string,
  params: Record<string, string>,
  key: string,
  secret: string,
) => {
  const query = Object.keys(params)
    .sort()
    .map(
      (name) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(params[name]).replace(/%20/g, "+")}`,
    )
    .join("&");
  const digest = await hmac("SHA-1", secret, method + query + md5(query));
  return {
    query,
    authorization: `${key}:${base64(new TextEncoder().encode(toHex(digest)))}`,
  };
};

// --- Mango Office ----------------------------------------------------------

/**
 * Mango Office VPBX API (https://www.mango-office.ru/support/api/). Posts a
 * form (vpbx_api_key, sign, json) to <address>/events/<event>:
 * - events/call: call states (Appeared, Connected, Disconnected);
 * - events/summary: the finished call (entry_id, call_direction 1 incoming /
 *   2 outgoing, from/to, create_time, talk_time, end_time, entry_result);
 * - events/recording: the recording is ready (recording_id).
 * entry_id identifies the call across transfers.
 */
export const mangoToCall = (
  body: Payload,
  event?: string,
): CallEvent | null => {
  let data: Payload;
  try {
    data =
      typeof body.json === "string" ? JSON.parse(body.json) : object(body.json);
  } catch {
    return null;
  }
  const callId = text(data.entry_id) ?? text(data.call_id);
  if (!callId) return null;
  const from = object(data.from);
  const to = object(data.to);
  const kind =
    event?.split("/").pop() ??
    (data.recording_id != null
      ? "recording"
      : data.entry_result != null || data.call_direction != null
        ? "summary"
        : data.call_state != null
          ? "call"
          : undefined);

  if (kind === "recording") {
    const recordingId = text(data.recording_id);
    const completed =
      String(data.recording_state ?? "Completed").toLowerCase() === "completed";
    return recordingId && completed
      ? {
          call: { call_id: callId },
          recording: { provider: "mango", recordingId },
        }
      : null;
  }
  if (kind === "summary") {
    const direction = Number(data.call_direction);
    if (direction !== 1 && direction !== 2) return null; // internal call
    const incoming = direction === 1;
    const talk = number(data.talk_time);
    const end = number(data.end_time);
    return {
      call: {
        call_id: callId,
        direction: incoming ? "in" : "out",
        phone: text(incoming ? from.number : to.number),
        extension: text(incoming ? to.extension : from.extension),
        started_at: toIsoDate(data.create_time),
        duration: talk && end > talk ? end - talk : 0,
        status: String(data.entry_result) === "1" ? "answered" : "missed",
      },
    };
  }
  if (kind === "call") {
    // An employee's extension on the "from" side without one on the "to"
    // side is an outgoing call
    const outgoing = !!text(from.extension) && !text(to.extension);
    if (text(from.extension) && text(to.extension)) return null; // internal
    return {
      call: {
        call_id: callId,
        direction: outgoing ? "out" : "in",
        phone: text(outgoing ? to.number : from.number),
        extension: text(outgoing ? from.extension : to.extension),
        started_at: toIsoDate(data.timestamp),
        status: null,
      },
    };
  }
  return null;
};

/** Mango Office signature: sha256(vpbx_api_key + json + salt), hex */
export const mangoSign = async (apiKey: string, json: string, salt: string) =>
  toHex(await sha("SHA-256", apiKey + json + salt));

export const verifyMango = async (
  body: Payload,
  salt: string,
  apiKey?: string | null,
) => {
  const key = text(body.vpbx_api_key);
  const json = typeof body.json === "string" ? body.json : null;
  if (!key || json == null || !body.sign) return false;
  if (apiKey && apiKey !== key) return false;
  return (await mangoSign(key, json, salt)) === String(body.sign).toLowerCase();
};

/**
 * Link to play a Mango Office recording, valid until `expires` (Unix time):
 * /vpbx/queries/recording/link/<id>/play/<key>/<expires>/<sha256(key + expires + id + salt)>
 */
export const mangoRecordingLink = async (
  recordingId: string,
  apiKey: string,
  salt: string,
  expires: number,
) => {
  const sign = toHex(
    await sha("SHA-256", apiKey + expires + recordingId + salt),
  );
  return `https://app.mango-office.ru/vpbx/queries/recording/link/${encodeURIComponent(recordingId)}/play/${apiKey}/${expires}/${sign}`;
};

// --- generic ---------------------------------------------------------------

const INCOMING = ["in", "incoming", "inbound", "0"];
const OUTGOING = ["out", "outgoing", "outbound", "1"];
const ANSWERED = ["answered", "completed", "success"];
const MISSED = ["missed", "noanswer", "no_answer", "busy", "failed", "cancel"];
const IN_PROGRESS = ["in_progress", "ringing", "started", "start"];

/**
 * Documented JSON for any other PBX (docs/stages/12-telephony.md):
 *   { call_id, direction: in|out, phone, employee_ext, started_at,
 *     duration, status: answered|missed, record_url }
 */
export const genericToCall = (body: Payload): CallEvent | null => {
  const callId = text(body.call_id) ?? text(body.id);
  if (!callId) return null;
  const direction = String(body.direction ?? "").toLowerCase();
  const status = String(body.status ?? "").toLowerCase();
  const recordUrl = text(body.record_url) ?? text(body.recording_url);
  return {
    call: {
      call_id: callId,
      direction: OUTGOING.includes(direction)
        ? "out"
        : INCOMING.includes(direction)
          ? "in"
          : undefined,
      phone: text(body.phone),
      extension: text(body.employee_ext) ?? text(body.extension),
      started_at: toIsoDate(body.started_at),
      duration: number(body.duration),
      status: ANSWERED.includes(status)
        ? "answered"
        : MISSED.includes(status)
          ? "missed"
          : IN_PROGRESS.includes(status) || status === ""
            ? null
            : number(body.duration) > 0
              ? "answered"
              : "missed",
      record_url: isAudioUrl(recordUrl) ? recordUrl : null,
      name: text(body.name),
    },
  };
};

/**
 * Generic signature, when the clinic set a secret: the header
 * X-Webhook-Secret equal to it, or X-Signature = hex hmac_sha256(body, secret).
 */
export const verifyGeneric = async (
  raw: string,
  headers: { get(name: string): string | null },
  secret: string,
) => {
  if (headers.get("x-webhook-secret") === secret) return true;
  const signature = headers
    .get("x-signature")
    ?.replace(/^sha256=/i, "")
    .toLowerCase();
  if (!signature) return false;
  return toHex(await hmac("SHA-256", secret, raw)) === signature;
};

// --- dispatch --------------------------------------------------------------

export const toCallEvent = (
  provider: TelephonyProvider,
  body: Payload,
  event?: string,
): CallEvent | null => {
  switch (provider) {
    case "binotel":
      return binotelToCall(body);
    case "zadarma":
      return zadarmaToCall(body);
    case "mango":
      return mangoToCall(body, event);
    case "generic":
      return genericToCall(body);
  }
};

/**
 * Is the webhook really from the clinic's PBX? Without a stored secret the
 * token of the address is the only check. Binotel does not sign its
 * webhooks (its secret is the API one): the token is the check.
 */
export const verifyWebhook = async ({
  provider,
  raw,
  body,
  headers,
  secret,
  apiKey,
}: {
  provider: TelephonyProvider;
  raw: string;
  body: Payload;
  headers: { get(name: string): string | null };
  secret?: string | null;
  apiKey?: string | null;
}) => {
  if (!secret) return true;
  switch (provider) {
    case "zadarma":
      return verifyZadarma(body, headers.get("signature"), secret);
    case "mango":
      return verifyMango(body, secret, apiKey);
    case "generic":
      return verifyGeneric(raw, headers, secret);
    case "binotel":
      return true;
  }
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The recording link, from the provider API when the clinic gave its key.
 * Links of Binotel and Zadarma are temporary (see the docs).
 */
export const fetchRecordingUrl = async (
  request: RecordingRequest,
  credentials: { apiKey?: string | null; secret?: string | null },
  fetchFn: Fetch = fetch,
  now = Date.now(),
): Promise<string | null> => {
  const { apiKey, secret } = credentials;
  if (!apiKey || !secret) return null;
  try {
    if (request.provider === "binotel") {
      const response = await fetchFn(
        "https://api.binotel.com/api/4.0/stats/call-record.json",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: apiKey,
            secret,
            generalCallID: request.generalCallId,
          }),
        },
      );
      const data = await response.json();
      return text(data?.url);
    }
    if (request.provider === "zadarma") {
      const method = "/v1/pbx/record/request/";
      const params: Record<string, string> = request.callIdWithRec
        ? { call_id: request.callIdWithRec }
        : { pbx_call_id: request.pbxCallId };
      const { query, authorization } = await zadarmaAuthorization(
        method,
        params,
        apiKey,
        secret,
      );
      const response = await fetchFn(
        `https://api.zadarma.com${method}?${query}`,
        { headers: { Authorization: authorization } },
      );
      const data = await response.json();
      return text(data?.link) ?? text(data?.links?.[0]);
    }
    // Mango Office: a signed link, valid one year
    return await mangoRecordingLink(
      request.recordingId,
      apiKey,
      secret,
      Math.floor(now / 1000) + 365 * 24 * 60 * 60,
    );
  } catch {
    return null;
  }
};

/** What the PBX expects back */
export const webhookResponseBody = (provider: TelephonyProvider) =>
  provider === "binotel" ? JSON.stringify({ status: "success" }) : "OK";

// --- crypto ----------------------------------------------------------------

const hmac = async (hash: "SHA-1" | "SHA-256", key: string, data: string) => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data)),
  );
};

const sha = async (hash: "SHA-256", data: string) =>
  new Uint8Array(
    await crypto.subtle.digest(hash, new TextEncoder().encode(data)),
  );

export const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** MD5 hex digest (the Zadarma API signs md5 of the query; not in Web Crypto) */
export const md5 = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  const length = bytes.length;
  const words = new Uint32Array((((length + 8) >> 6) + 1) * 16);
  for (let i = 0; i < length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[length >> 2] |= 0x80 << ((length % 4) * 8);
  words[words.length - 2] = length * 8;
  words[words.length - 1] = Math.floor((length * 8) / 2 ** 32);
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const k = Array.from({ length: 64 }, (_, i) =>
    Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
  );
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      let f: number;
      let g: number;
      if (round === 0) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (round === 1) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (round === 2) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const shift = shifts[round * 4 + (i % 4)];
      const sum = (a + f + k[i] + words[block + g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((word) =>
      Array.from({ length: 4 }, (_, i) =>
        ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0"),
      ).join(""),
    )
    .join("");
};
