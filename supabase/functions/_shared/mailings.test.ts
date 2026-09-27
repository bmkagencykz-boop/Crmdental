// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  dispatchWithPauses,
  MAX_PAUSE_MS,
  MIN_PAUSE_MS,
  randomPause,
  type ClaimedMailingMessage,
} from "./mailings";

const row = (
  id: number,
  organization_id: number,
  deal_id: number | null = id,
): ClaimedMailingMessage => ({
  id,
  organization_id,
  patient_id: id,
  deal_id,
  message_text: `text ${id}`,
});

describe("randomPause", () => {
  it("stays between 5 and 20 seconds", () => {
    expect(randomPause(() => 0)).toBe(MIN_PAUSE_MS);
    expect(randomPause(() => 0.999999)).toBe(MAX_PAUSE_MS);
    expect(randomPause(() => 0.5)).toBe(12_500);
    for (let i = 0; i < 100; i++) {
      const pause = randomPause();
      expect(pause).toBeGreaterThanOrEqual(5_000);
      expect(pause).toBeLessThanOrEqual(20_000);
    }
  });
});

describe("dispatchWithPauses", () => {
  it("pauses between two messages of a clinic, not before the first", async () => {
    const log: string[] = [];
    await dispatchWithPauses(
      [row(1, 10), row(2, 10), row(3, 10)],
      async (r) => {
        log.push(`send ${r.id}`);
        return { ok: true };
      },
      {
        random: () => 0.5,
        sleep: async (ms) => {
          log.push(`sleep ${ms}`);
        },
      },
    );
    expect(log).toEqual([
      "send 1",
      "sleep 12500",
      "send 2",
      "sleep 12500",
      "send 3",
    ]);
  });

  it("sends the clinics in parallel", async () => {
    const sleeps: number[] = [];
    const results = await dispatchWithPauses(
      [row(1, 10), row(2, 20), row(3, 10)],
      async () => ({ ok: true }),
      { random: () => 0, sleep: async (ms) => sleeps.push(ms) },
    );
    expect(sleeps).toEqual([5_000]);
    expect([...results.keys()].sort()).toEqual([1, 2, 3]);
  });

  it("a failing send only fails its message", async () => {
    const results = await dispatchWithPauses(
      [row(1, 10), row(2, 10, null)],
      async (r) => {
        if (r.id === 1) throw new Error("boom");
        return { ok: true };
      },
      { sleep: async () => undefined },
    );
    expect(results.get(1)).toEqual({ ok: false, error: "boom" });
    expect(results.get(2)).toEqual({ ok: true });
  });
});
