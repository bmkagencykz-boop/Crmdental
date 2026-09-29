import { describe, expect, it } from "vitest";

import { secureEqual } from "./secureCompare.ts";

describe("secureEqual", () => {
  it("is true only for the same text", () => {
    expect(secureEqual("s3cret-key", "s3cret-key")).toBe(true);
    expect(secureEqual("s3cret-key", "s3cret-kez")).toBe(false);
    expect(secureEqual("s3cret-key", "s3cret")).toBe(false);
    expect(secureEqual("", "x")).toBe(false);
    expect(secureEqual("x", "")).toBe(false);
    expect(secureEqual(null, "x")).toBe(false);
    expect(secureEqual("x", undefined)).toBe(false);
  });
});
