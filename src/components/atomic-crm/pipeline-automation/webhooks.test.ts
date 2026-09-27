import { describe, expect, it } from "vitest";

import {
  curlExamples,
  eventLabelKey,
  isPublicWebhookUrl,
  webhookState,
} from "./webhooks";

describe("isPublicWebhookUrl", () => {
  it("accepts public http(s) addresses only", () => {
    expect(isPublicWebhookUrl("https://mis.clinic.kz/hook")).toBe(true);
    expect(isPublicWebhookUrl(" http://partner.example:8080/in ")).toBe(true);
    for (const url of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.1.2.3/",
      "http://192.168.0.10/",
      "http://172.31.0.1/",
      "http://169.254.169.254/",
      "ftp://mis.clinic.kz/",
      "https://user:secret@mis.clinic.kz/",
      "mis.clinic.kz/hook",
    ]) {
      expect(isPublicWebhookUrl(url), url).toBe(false);
    }
  });
});

describe("webhookState", () => {
  it("working, failing, off after errors, off by hand", () => {
    expect(
      webhookState({ is_active: true, failure_count: 0, disabled_at: null }),
    ).toBe("active");
    expect(
      webhookState({ is_active: true, failure_count: 2, disabled_at: null }),
    ).toBe("failing");
    expect(
      webhookState({
        is_active: false,
        failure_count: 10,
        disabled_at: "2026-10-01T00:00:00Z",
      }),
    ).toBe("disabled");
    expect(
      webhookState({ is_active: false, failure_count: 0, disabled_at: null }),
    ).toBe("off");
  });
});

describe("docs helpers", () => {
  it("event labels and curl examples", () => {
    expect(eventLabelKey("deal.stage_changed")).toBe(
      "api.events.deal_stage_changed",
    );
    const examples = curlExamples(
      "https://x.supabase.co/functions/v1/api",
      "k1",
    );
    expect(examples.listDeals).toContain(
      'curl -H "Authorization: Bearer k1" "https://x.supabase.co/functions/v1/api/deals?',
    );
    expect(examples.createDeal).toContain("-X POST");
    expect(examples.updateDeal).toContain("-X PATCH");
  });
});
