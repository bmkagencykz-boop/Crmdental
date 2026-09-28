// @vitest-environment node
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  binotelToCall,
  fetchRecordingUrl,
  genericToCall,
  mangoRecordingLink,
  mangoSign,
  mangoToCall,
  md5,
  parseWebhookAddress,
  parseWebhookBody,
  toCallEvent,
  toIsoDate,
  verifyGeneric,
  verifyMango,
  verifyWebhook,
  verifyZadarma,
  webhookResponseBody,
  zadarmaAuthorization,
  zadarmaToCall,
} from "./telephony";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("parseWebhookAddress", () => {
  it("reads the provider and the token from the query", () => {
    expect(
      parseWebhookAddress(
        new URL(
          "https://x.supabase.co/functions/v1/telephony_webhook?provider=zadarma&token=abc",
        ),
      ),
    ).toEqual({ provider: "zadarma", token: "abc", event: undefined });
  });

  it("reads the path form with the event Mango Office appends", () => {
    expect(
      parseWebhookAddress(
        new URL(
          "https://x.supabase.co/functions/v1/telephony_webhook/mango/abc/events/summary",
        ),
      ),
    ).toEqual({ provider: "mango", token: "abc", event: "events/summary" });
  });

  it("splits an event appended after the query token", () => {
    expect(
      parseWebhookAddress(
        new URL(
          "https://x.supabase.co/telephony_webhook?provider=mango&token=abc/events/recording",
        ),
      ),
    ).toEqual({ provider: "mango", token: "abc", event: "events/recording" });
  });
});

describe("parseWebhookBody", () => {
  it("parses nested form fields (Binotel)", () => {
    expect(
      parseWebhookBody(
        "requestType=apiCallCompleted&callDetails%5BgeneralCallID%5D=42&callDetails%5BcustomerData%5D%5Bname%5D=Asel",
        "application/x-www-form-urlencoded",
      ),
    ).toEqual({
      requestType: "apiCallCompleted",
      callDetails: { generalCallID: "42", customerData: { name: "Asel" } },
    });
  });

  it("parses JSON", () => {
    expect(parseWebhookBody('{"call_id":"1"}', "application/json")).toEqual({
      call_id: "1",
    });
    expect(parseWebhookBody("{broken", "application/json")).toEqual({});
  });
});

describe("toIsoDate", () => {
  it("reads Unix times and zoned dates, not local ones", () => {
    expect(toIsoDate(1790000000)).toBe("2026-09-21T14:13:20.000Z");
    expect(toIsoDate("1790000000000")).toBe("2026-09-21T14:13:20.000Z");
    expect(toIsoDate("2026-10-06T09:00:00+05:00")).toBe(
      "2026-10-06T04:00:00.000Z",
    );
    expect(toIsoDate("2026-10-06 12:00:00")).toBeNull();
    expect(toIsoDate("")).toBeNull();
  });
});

describe("Binotel", () => {
  const completed = (details: Record<string, unknown>) => ({
    requestType: "apiCallCompleted",
    callDetails: {
      companyID: "1",
      generalCallID: "5501",
      callID: "5502",
      startTime: "1790000000",
      callType: "0",
      internalNumber: "901",
      externalNumber: "0701234567",
      waitsec: "5",
      billsec: "63",
      disposition: "ANSWER",
      customerData: { name: "Асель" },
      ...details,
    },
  });

  it("maps an answered incoming call and asks for its recording", () => {
    expect(binotelToCall(completed({}))).toEqual({
      call: {
        call_id: "5501",
        direction: "in",
        phone: "0701234567",
        extension: "901",
        started_at: "2026-09-21T14:13:20.000Z",
        name: "Асель",
        status: "answered",
        duration: 63,
        record_url: null,
      },
      recording: { provider: "binotel", generalCallId: "5501" },
    });
  });

  it("maps a missed call and an outgoing call", () => {
    const missed = binotelToCall(
      completed({ disposition: "NOANSWER", billsec: "0" }),
    );
    expect(missed?.call.status).toBe("missed");
    expect(missed?.recording).toBeUndefined();
    expect(binotelToCall(completed({ callType: "1" }))?.call.direction).toBe(
      "out",
    );
  });

  it("maps the start of a call", () => {
    expect(
      binotelToCall({
        requestType: "receivedTheCall",
        generalCallID: "77",
        callType: "0",
        externalNumber: "+77011112233",
      }),
    ).toEqual({
      call: {
        call_id: "77",
        direction: "in",
        phone: "+77011112233",
        extension: null,
        started_at: null,
        name: null,
        status: null,
      },
    });
  });

  it("ignores payloads without a call id", () => {
    expect(binotelToCall({ requestType: "ping" })).toBeNull();
  });
});

describe("Zadarma", () => {
  it("maps the start and the end of an incoming call", () => {
    expect(
      zadarmaToCall({
        event: "NOTIFY_START",
        call_start: "2026-10-06 12:00:00",
        pbx_call_id: "in_abc",
        caller_id: "77015551234",
        called_did: "77273550000",
      }),
    ).toEqual({
      call: {
        call_id: "in_abc",
        direction: "in",
        phone: "77015551234",
        started_at: null,
        status: null,
        // The clinic's number: the branch of a new deal (stage 33)
        line: "77273550000",
      },
    });
    expect(
      zadarmaToCall({
        event: "NOTIFY_END",
        call_start: "2026-10-06 12:00:00",
        pbx_call_id: "in_abc",
        caller_id: "77015551234",
        called_did: "77273550000",
        internal: "101",
        duration: "95",
        disposition: "answered",
        is_recorded: "1",
        call_id_with_rec: "1790000000.123",
      })?.call,
    ).toMatchObject({
      call_id: "in_abc",
      direction: "in",
      extension: "101",
      duration: 95,
      status: "answered",
    });
    expect(
      zadarmaToCall({
        event: "NOTIFY_END",
        pbx_call_id: "in_x",
        caller_id: "7701",
        disposition: "no answer",
        duration: "0",
      })?.call.status,
    ).toBe("missed");
  });

  it("maps outgoing calls", () => {
    expect(
      zadarmaToCall({
        event: "NOTIFY_OUT_END",
        pbx_call_id: "out_1",
        internal: "102",
        destination: "87079990000",
        duration: "40",
        disposition: "answered",
      })?.call,
    ).toMatchObject({
      direction: "out",
      phone: "87079990000",
      extension: "102",
      status: "answered",
    });
  });

  it("asks for the recording of NOTIFY_RECORD and ignores internal calls", () => {
    expect(
      zadarmaToCall({
        event: "NOTIFY_RECORD",
        pbx_call_id: "in_abc",
        call_id_with_rec: "1790000000.123",
      }),
    ).toEqual({
      call: { call_id: "in_abc" },
      recording: {
        provider: "zadarma",
        pbxCallId: "in_abc",
        callIdWithRec: "1790000000.123",
      },
    });
    expect(
      zadarmaToCall({ event: "NOTIFY_INTERNAL", pbx_call_id: "x" }),
    ).toBeNull();
  });

  it("verifies the signature (base64 of the hex hmac, or of the bytes)", async () => {
    const body = {
      event: "NOTIFY_START",
      call_start: "2026-10-06 12:00:00",
      pbx_call_id: "in_abc",
      caller_id: "77015551234",
      called_did: "77273550000",
    };
    const hex = createHmac("sha1", "secret")
      .update("7701555123477273550000" + "2026-10-06 12:00:00")
      .digest("hex");
    const bytes = createHmac("sha1", "secret")
      .update("7701555123477273550000" + "2026-10-06 12:00:00")
      .digest("base64");
    expect(
      await verifyZadarma(body, Buffer.from(hex).toString("base64"), "secret"),
    ).toBe(true);
    expect(await verifyZadarma(body, bytes, "secret")).toBe(true);
    expect(await verifyZadarma(body, bytes, "other")).toBe(false);
    expect(await verifyZadarma(body, null, "secret")).toBe(false);
  });

  it("signs API requests like the Zadarma PHP client", async () => {
    const { query, authorization } = await zadarmaAuthorization(
      "/v1/pbx/record/request/",
      { pbx_call_id: "in_abc", call_id: "1.2" },
      "key",
      "secret",
    );
    expect(query).toBe("call_id=1.2&pbx_call_id=in_abc");
    const hex = createHmac("sha1", "secret")
      .update(
        "/v1/pbx/record/request/" +
          query +
          createHash("md5").update(query).digest("hex"),
      )
      .digest("hex");
    expect(authorization).toBe(`key:${Buffer.from(hex).toString("base64")}`);
  });
});

describe("Mango Office", () => {
  const form = (data: unknown) => ({
    vpbx_api_key: "key",
    sign: "x",
    json: JSON.stringify(data),
  });

  it("maps the summary of an incoming call", () => {
    expect(
      mangoToCall(
        form({
          entry_id: "MTAx",
          call_direction: 1,
          from: { number: "77015551234" },
          to: { extension: "10", number: "77273550000" },
          create_time: 1790000000,
          forward_time: 1790000003,
          talk_time: 1790000005,
          end_time: 1790000065,
          entry_result: 1,
        }),
        "events/summary",
      ),
    ).toEqual({
      call: {
        call_id: "MTAx",
        direction: "in",
        phone: "77015551234",
        extension: "10",
        started_at: "2026-09-21T14:13:20.000Z",
        duration: 60,
        status: "answered",
      },
    });
  });

  it("maps a missed call, outgoing calls, and ignores internal ones", () => {
    expect(
      mangoToCall(
        form({
          entry_id: "e2",
          call_direction: 1,
          from: { number: "77015551234" },
          to: { number: "77273550000" },
          talk_time: 0,
          end_time: 1790000030,
          entry_result: 0,
        }),
      )?.call,
    ).toMatchObject({ status: "missed", duration: 0 });
    expect(
      mangoToCall(
        form({
          entry_id: "e3",
          call_direction: 2,
          from: { extension: "11", number: "77273550000" },
          to: { number: "87079990000" },
          entry_result: 1,
        }),
      )?.call,
    ).toMatchObject({
      direction: "out",
      phone: "87079990000",
      extension: "11",
    });
    expect(mangoToCall(form({ entry_id: "e4", call_direction: 0 }))).toBeNull();
  });

  it("maps call states and completed recordings", () => {
    expect(
      mangoToCall(
        form({
          entry_id: "e5",
          call_id: "c5",
          call_state: "Appeared",
          timestamp: 1790000000,
          from: { number: "77015551234" },
          to: { extension: "10" },
        }),
      )?.call,
    ).toMatchObject({ call_id: "e5", direction: "in", status: null });
    expect(
      mangoToCall(
        form({
          entry_id: "e5",
          recording_id: "rec-1",
          recording_state: "Completed",
        }),
      ),
    ).toEqual({
      call: { call_id: "e5" },
      recording: { provider: "mango", recordingId: "rec-1" },
    });
    expect(
      mangoToCall(
        form({
          entry_id: "e5",
          recording_id: "rec-1",
          recording_state: "Started",
        }),
      ),
    ).toBeNull();
  });

  it("verifies sha256(key + json + salt)", async () => {
    const json = '{"entry_id":"e1"}';
    const sign = createHash("sha256")
      .update("key" + json + "salt")
      .digest("hex");
    expect(await mangoSign("key", json, "salt")).toBe(sign);
    expect(await verifyMango({ vpbx_api_key: "key", sign, json }, "salt")).toBe(
      true,
    );
    expect(
      await verifyMango({ vpbx_api_key: "key", sign, json }, "salt", "other"),
    ).toBe(false);
    expect(
      await verifyMango({ vpbx_api_key: "key", sign, json }, "pepper"),
    ).toBe(false);
  });

  it("builds a signed recording link", async () => {
    const sign = createHash("sha256")
      .update("key" + 1800000000 + "rec-1" + "salt")
      .digest("hex");
    expect(await mangoRecordingLink("rec-1", "key", "salt", 1800000000)).toBe(
      `https://app.mango-office.ru/vpbx/queries/recording/link/rec-1/play/key/1800000000/${sign}`,
    );
  });
});

describe("generic", () => {
  it("maps the documented JSON", () => {
    expect(
      genericToCall({
        call_id: "g-1",
        direction: "in",
        phone: "+7 701 555 12 34",
        employee_ext: "101",
        started_at: "2026-10-06T09:00:00Z",
        duration: 42,
        status: "answered",
        record_url: "https://pbx.example.kz/rec/g-1.mp3",
      }),
    ).toEqual({
      call: {
        call_id: "g-1",
        direction: "in",
        phone: "+7 701 555 12 34",
        extension: "101",
        started_at: "2026-10-06T09:00:00.000Z",
        duration: 42,
        status: "answered",
        record_url: "https://pbx.example.kz/rec/g-1.mp3",
        name: null,
      },
    });
  });

  it("reads statuses tolerantly", () => {
    const status = (value: string, duration = 0) =>
      genericToCall({ call_id: "1", status: value, duration })?.call.status;
    expect(status("missed")).toBe("missed");
    expect(status("NOANSWER")).toBe("missed");
    expect(status("")).toBeNull();
    expect(status("ringing")).toBeNull();
    expect(status("done", 30)).toBe("answered");
    expect(
      genericToCall({ call_id: "1", record_url: "javascript:alert(1)" })?.call
        .record_url,
    ).toBeNull();
    expect(genericToCall({ phone: "1" })).toBeNull();
  });

  it("verifies the shared secret or the body hmac", async () => {
    const raw = '{"call_id":"1"}';
    const signature = createHmac("sha256", "s3").update(raw).digest("hex");
    expect(
      await verifyGeneric(raw, headers({ "x-webhook-secret": "s3" }), "s3"),
    ).toBe(true);
    expect(
      await verifyGeneric(
        raw,
        headers({ "x-signature": `sha256=${signature}` }),
        "s3",
      ),
    ).toBe(true);
    expect(await verifyGeneric(raw, headers({}), "s3")).toBe(false);
  });
});

describe("dispatch", () => {
  it("routes by provider", () => {
    expect(
      toCallEvent("generic", { call_id: "1", status: "missed" })?.call.status,
    ).toBe("missed");
    expect(
      toCallEvent("zadarma", { event: "NOTIFY_OUT_START", pbx_call_id: "o" })
        ?.call.direction,
    ).toBe("out");
  });

  it("accepts every webhook when no secret is set; Binotel is not signed", async () => {
    const args = { raw: "", body: {}, headers: headers({}) };
    expect(
      await verifyWebhook({ ...args, provider: "zadarma", secret: null }),
    ).toBe(true);
    expect(
      await verifyWebhook({ ...args, provider: "binotel", secret: "s" }),
    ).toBe(true);
    expect(
      await verifyWebhook({ ...args, provider: "generic", secret: "s" }),
    ).toBe(false);
  });

  it("answers Binotel in JSON", () => {
    expect(webhookResponseBody("binotel")).toBe('{"status":"success"}');
    expect(webhookResponseBody("zadarma")).toBe("OK");
  });
});

describe("fetchRecordingUrl", () => {
  const json = (data: unknown) =>
    ({ json: async () => data }) as unknown as Response;

  it("asks Binotel for the call record", async () => {
    const fetchFn = vi.fn(async () =>
      json({ status: "success", url: "https://r/1.mp3" }),
    );
    expect(
      await fetchRecordingUrl(
        { provider: "binotel", generalCallId: "5501" },
        { apiKey: "k", secret: "s" },
        fetchFn,
      ),
    ).toBe("https://r/1.mp3");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.binotel.com/api/4.0/stats/call-record.json",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "k", secret: "s", generalCallID: "5501" }),
      }),
    );
  });

  it("asks Zadarma with a signed request", async () => {
    const fetchFn = vi.fn(async () =>
      json({ status: "success", link: "https://z/1.mp3" }),
    );
    expect(
      await fetchRecordingUrl(
        { provider: "zadarma", pbxCallId: "in_abc", callIdWithRec: "1.2" },
        { apiKey: "k", secret: "s" },
        fetchFn,
      ),
    ).toBe("https://z/1.mp3");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      "https://api.zadarma.com/v1/pbx/record/request/?call_id=1.2",
    );
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^k:/,
    );
  });

  it("signs a Mango Office link, needs credentials, survives errors", async () => {
    expect(
      await fetchRecordingUrl(
        { provider: "mango", recordingId: "rec-1" },
        { apiKey: "key", secret: "salt" },
        undefined,
        1_800_000_000_000 - 365 * 24 * 60 * 60 * 1000,
      ),
    ).toMatch(/\/rec-1\/play\/key\/1800000000\/[0-9a-f]{64}$/);
    expect(
      await fetchRecordingUrl(
        { provider: "binotel", generalCallId: "1" },
        { apiKey: null, secret: "s" },
      ),
    ).toBeNull();
    expect(
      await fetchRecordingUrl(
        { provider: "binotel", generalCallId: "1" },
        { apiKey: "k", secret: "s" },
        async () => {
          throw new Error("offline");
        },
      ),
    ).toBeNull();
  });
});

describe("md5", () => {
  it("matches the reference digests", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    const long = "звонок ".repeat(40);
    expect(md5(long)).toBe(createHash("md5").update(long).digest("hex"));
  });
});

describe("the clinic's line (branches, stage 33)", () => {
  it("passes the number the call went through when the PBX sends it", () => {
    expect(
      genericToCall({
        call_id: "g-2",
        phone: "+77015551234",
        line: "+7 727 222 22 22",
      })?.call.line,
    ).toBe("+7 727 222 22 22");
    expect(
      zadarmaToCall({
        event: "NOTIFY_START",
        pbx_call_id: "z-2",
        caller_id: "77015551234",
        called_did: "77272222222",
      })?.call.line,
    ).toBe("77272222222");
  });
  it("leaves it out otherwise", () => {
    expect(
      genericToCall({ call_id: "g-3", phone: "+77015551234" })?.call,
    ).not.toHaveProperty("line");
  });
});
