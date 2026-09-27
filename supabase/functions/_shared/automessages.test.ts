// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  describeSendError,
  dispatchThrottled,
  isDispatchAuthorized,
  type ClaimedAutomessage,
} from "./automessages";

const row = (id: number, organization_id: number): ClaimedAutomessage => ({
  id,
  organization_id,
  deal_id: id,
  patient_id: id,
  message_text: `text ${id}`,
});

describe("dispatchThrottled", () => {
  it("sends the messages of a clinic one by one, with a pause", async () => {
    const log: string[] = [];
    const sleeps: number[] = [];
    await dispatchThrottled(
      [row(1, 10), row(2, 10), row(3, 10)],
      async (r) => {
        log.push(`send ${r.id}`);
        return { ok: true };
      },
      {
        perSecond: 3,
        sleep: async (ms) => {
          sleeps.push(ms);
          log.push("sleep");
        },
      },
    );
    expect(log).toEqual(["send 1", "sleep", "send 2", "sleep", "send 3"]);
    expect(sleeps).toEqual([334, 334]);
  });

  it("does not make a clinic wait for another", async () => {
    const sleeps: number[] = [];
    const results = await dispatchThrottled(
      [row(1, 10), row(2, 20)],
      async () => ({ ok: true }),
      { sleep: async (ms) => sleeps.push(ms) },
    );
    expect(sleeps).toEqual([]);
    expect([...results.keys()].sort()).toEqual([1, 2]);
  });

  it("records a failure of one message and goes on", async () => {
    const results = await dispatchThrottled(
      [row(1, 10), row(2, 10)],
      async (r) => {
        if (r.id === 1) throw new Error("network down");
        return { ok: true };
      },
      { sleep: async () => undefined },
    );
    expect(results.get(1)).toEqual({ ok: false, error: "network down" });
    expect(results.get(2)).toEqual({ ok: true });
  });
});

describe("isDispatchAuthorized", () => {
  it("accepts one of the keys as a bearer token", () => {
    expect(isDispatchAuthorized("Bearer secret", ["other", "secret"])).toBe(
      true,
    );
  });
  it("refuses a missing header, a wrong key, or no configured key", () => {
    expect(isDispatchAuthorized(null, ["secret"])).toBe(false);
    expect(isDispatchAuthorized("Bearer nope", ["secret"])).toBe(false);
    expect(isDispatchAuthorized("Bearer ", [undefined, ""])).toBe(false);
    expect(isDispatchAuthorized("secret", ["secret"])).toBe(false);
  });
});

describe("describeSendError", () => {
  it("explains the known errors in Russian", () => {
    expect(describeSendError("not_connected")).toMatch(/не подключены/);
    expect(describeSendError("send_failed", "429")).toBe(
      "Wazzup24 не принял сообщение: 429",
    );
  });
});
