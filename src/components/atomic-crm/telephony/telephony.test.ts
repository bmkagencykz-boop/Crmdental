import { describe, expect, it } from "vitest";
import { callStatusKey, telephonyWebhookUrl } from "./telephony";

describe("telephonyWebhookUrl", () => {
  it("puts the provider and the token in the query", () => {
    expect(
      telephonyWebhookUrl("https://abc.supabase.co/", "zadarma", "tok"),
    ).toBe(
      "https://abc.supabase.co/functions/v1/telephony_webhook?provider=zadarma&token=tok",
    );
  });

  it("puts the token in the path for Mango Office", () => {
    expect(telephonyWebhookUrl("https://abc.supabase.co", "mango", "tok")).toBe(
      "https://abc.supabase.co/functions/v1/telephony_webhook/mango/tok",
    );
  });
});

describe("callStatusKey", () => {
  it("names the status of a call", () => {
    expect(
      callStatusKey({ provider: "zadarma", status: "missed", direction: "in" }),
    ).toBe("telephony.call.status.missed");
    expect(
      callStatusKey({
        provider: "zadarma",
        status: "missed",
        direction: "out",
      }),
    ).toBe("telephony.call.status.no_answer");
    expect(
      callStatusKey({
        provider: "generic",
        status: "answered",
        direction: "in",
      }),
    ).toBe("telephony.call.status.answered");
    expect(callStatusKey({ direction: "in" })).toBeNull();
    expect(
      callStatusKey({ provider: null, status: "answered", direction: "out" }),
    ).toBeNull();
  });
});
