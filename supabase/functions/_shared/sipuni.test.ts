// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  isProvider,
  parseWebhookAddress,
  parseWebhookBody,
  queryPayload,
  sipuniToCall,
  toCallEvent,
  verifyWebhook,
  webhookResponseBody,
  webhookResponseType,
} from "./telephony";

// Realistic events of one incoming call: start (1), answer (3), end (2)
const base = {
  call_id: "1760003400.2081",
  src_num: "77015550001",
  src_type: "1",
  dst_num: "201",
  dst_type: "2",
  short_dst_num: "201",
  channel: "SIP/sipuni-00003a1f",
  treeName: "Входящие",
};

const headers = { get: () => null };

describe("Sipuni", () => {
  it("is a telephony provider", () => {
    expect(isProvider("sipuni")).toBe(true);
    expect(
      parseWebhookAddress(
        new URL(
          "https://x.supabase.co/functions/v1/telephony_webhook?provider=sipuni&token=abc",
        ),
      ),
    ).toMatchObject({ provider: "sipuni", token: "abc" });
  });

  it("maps the start of an incoming call (event 1)", () => {
    expect(
      sipuniToCall({ ...base, event: "1", timestamp: "1760003400" }),
    ).toEqual({
      call: {
        call_id: "1760003400.2081",
        direction: "in",
        phone: "77015550001",
        extension: "201",
        started_at: "2025-10-09T09:50:00.000Z",
        status: null,
      },
    });
  });

  it("keeps the call going on answer (event 3), with who answered", () => {
    const event = sipuniToCall({
      ...base,
      event: "3",
      timestamp: "1760003405",
      call_start_timestamp: "1760003400",
    });
    expect(event?.call).toMatchObject({
      status: null,
      extension: "201",
      started_at: "2025-10-09T09:50:00.000Z",
    });
  });

  it("ends an answered call with its talk time and recording (event 2)", () => {
    const event = sipuniToCall({
      ...base,
      event: "2",
      status: "ANSWER",
      timestamp: "1760003467",
      call_start_timestamp: "1760003400",
      call_answer_timestamp: "1760003405",
      call_record_link:
        "https://sipuni.com/api/crm/record?id=1760003400.2081&hash=ab12",
    });
    expect(event?.call).toMatchObject({
      call_id: "1760003400.2081",
      direction: "in",
      status: "answered",
      duration: 62,
      record_url:
        "https://sipuni.com/api/crm/record?id=1760003400.2081&hash=ab12",
    });
  });

  it.each(["NOANSWER", "BUSY", "CANCEL", "CONGESTION", "CHANUNAVAIL"])(
    "treats %s as a missed call",
    (status) => {
      const event = sipuniToCall({
        ...base,
        event: "2",
        status,
        timestamp: "1760003430",
        call_start_timestamp: "1760003400",
      });
      expect(event?.call).toMatchObject({
        status: "missed",
        duration: 0,
        record_url: null,
      });
    },
  );

  it("maps an outgoing call: the employee calls a patient", () => {
    const event = sipuniToCall({
      event: "2",
      call_id: "1760009000.77",
      src_num: "202",
      src_type: "2",
      short_src_num: "202",
      dst_num: "87017770011",
      dst_type: "1",
      status: "ANSWER",
      call_start_timestamp: "1760009000",
      call_answer_timestamp: "1760009010",
      timestamp: "1760009100",
    });
    expect(event?.call).toMatchObject({
      direction: "out",
      phone: "87017770011",
      extension: "202",
      status: "answered",
      duration: 90,
    });
  });

  it("tells internal numbers by length when the types are missing", () => {
    const event = sipuniToCall({
      event: "1",
      call_id: "c1",
      src_num: "+7 701 555 00 02",
      dst_num: "105",
    });
    expect(event?.call).toMatchObject({ direction: "in", extension: "105" });
  });

  it("ignores secondary legs, internal calls and events without call id", () => {
    expect(
      sipuniToCall({ ...base, event: "4", status: "NOANSWER" }),
    ).toBeNull();
    expect(
      sipuniToCall({
        event: "1",
        call_id: "c2",
        src_num: "201",
        src_type: "2",
        dst_num: "202",
        dst_type: "2",
      }),
    ).toBeNull();
    expect(sipuniToCall({ event: "1", src_num: "77015550001" })).toBeNull();
    expect(
      sipuniToCall({
        ...base,
        event: "2",
        status: "NOANSWER",
        call_record_link: "not a link",
      })?.call.record_url,
    ).toBeNull();
  });

  it("reads GET queries and POST forms alike", () => {
    const url = new URL(
      "https://x.supabase.co/functions/v1/telephony_webhook?provider=sipuni&token=abc&event=2&call_id=9.1&src_num=77015550001&src_type=1&dst_num=201&dst_type=2&status=NOANSWER",
    );
    const fromQuery = queryPayload(url);
    expect(fromQuery).not.toHaveProperty("token");
    expect(fromQuery).not.toHaveProperty("provider");
    const fromForm = parseWebhookBody(
      "event=2&call_id=9.1&src_num=77015550001&src_type=1&dst_num=201&dst_type=2&status=NOANSWER",
      "application/x-www-form-urlencoded",
    );
    expect(toCallEvent("sipuni", fromQuery)).toEqual(
      toCallEvent("sipuni", fromForm),
    );
    expect(toCallEvent("sipuni", fromForm)?.call.status).toBe("missed");
  });

  it('answers {"success": true} as JSON and needs no signature', async () => {
    expect(JSON.parse(webhookResponseBody("sipuni"))).toEqual({
      success: true,
    });
    expect(webhookResponseType("sipuni")).toBe("application/json");
    expect(webhookResponseType("zadarma")).toBe("text/plain");
    expect(
      await verifyWebhook({
        provider: "sipuni",
        raw: "",
        body: {},
        headers,
        secret: "anything",
      }),
    ).toBe(true);
  });
});
