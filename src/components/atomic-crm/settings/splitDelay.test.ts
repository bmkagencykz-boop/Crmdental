import { describe, expect, it } from "vitest";
import { splitDelay } from "./TaskRulesEditor";

describe("splitDelay", () => {
  it("shows a delay in its largest exact unit", () => {
    expect(splitDelay(15)).toEqual({ amount: 15, unit: "minutes" });
    expect(splitDelay(120)).toEqual({ amount: 2, unit: "hours" });
    expect(splitDelay(24 * 60)).toEqual({ amount: 1, unit: "days" });
    expect(splitDelay(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(splitDelay(0)).toEqual({ amount: 0, unit: "minutes" });
  });
});
