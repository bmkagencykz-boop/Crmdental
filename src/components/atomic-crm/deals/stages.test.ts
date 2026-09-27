import { describe, expect, it } from "vitest";
import type { Deal, Stage } from "../types";
import { getDealsByStage } from "./stages";

const stage = (id: number): Stage => ({
  id,
  pipeline_id: 1,
  name: `S${id}`,
  position: id,
  color: "#000",
  kind: "open",
});
const deal = (id: number, stage_id: number, index: number) =>
  ({ id, stage_id, index }) as Deal;

describe("getDealsByStage", () => {
  it("groups deals by stage and orders them by index", () => {
    const result = getDealsByStage(
      [deal(1, 10, 2), deal(2, 10, 0), deal(3, 20, 0)],
      [stage(10), stage(20), stage(30)],
    );
    expect(result["10"].map((d) => d.id)).toEqual([2, 1]);
    expect(result["20"].map((d) => d.id)).toEqual([3]);
    expect(result["30"]).toEqual([]);
  });

  it("ignores deals of stages outside the pipeline", () => {
    expect(getDealsByStage([deal(1, 99, 0)], [stage(10)])).toEqual({
      "10": [],
    });
  });
});
