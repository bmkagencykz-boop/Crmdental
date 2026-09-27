import { describe, expect, it } from "vitest";
import type { Pipeline, Stage } from "../types";
import {
  getDefaultPipeline,
  getPipelineStages,
  toChoices,
  toDoctorChoices,
} from "./useDictionaries";

const pipeline = (id: number, is_default = false): Pipeline => ({
  id,
  name: `P${id}`,
  position: id,
  is_default,
});
const stage = (id: number, pipeline_id: number, position: number): Stage => ({
  id,
  pipeline_id,
  position,
  name: `S${id}`,
  color: "#000",
  kind: "open",
});

describe("dictionaries", () => {
  it("picks the default pipeline, else the first one", () => {
    expect(getDefaultPipeline([pipeline(1), pipeline(2, true)])?.id).toBe(2);
    expect(getDefaultPipeline([pipeline(1), pipeline(2)])?.id).toBe(1);
    expect(getDefaultPipeline([])).toBeUndefined();
  });

  it("orders the stages of a pipeline", () => {
    const stages = [stage(1, 1, 2), stage(2, 2, 0), stage(3, 1, 0)];
    expect(getPipelineStages(stages, 1).map((s) => s.id)).toEqual([3, 1]);
  });

  it("hides archived entries unless selected", () => {
    const items = [
      { id: 1, name: "A", is_archived: false },
      { id: 2, name: "B", is_archived: true },
    ];
    expect(toChoices(items).map((c) => c.id)).toEqual([1]);
    expect(toChoices(items, 2).map((c) => c.id)).toEqual([1, 2]);
  });

  it("hides inactive doctors unless selected", () => {
    const doctors = [
      { id: 1, name: "Ахметова", is_active: true, position: 0 },
      { id: 2, name: "Сериков", is_active: false, position: 1 },
    ];
    expect(toDoctorChoices(doctors)).toEqual([{ id: 1, name: "Ахметова" }]);
    expect(toDoctorChoices(doctors, "2").map((c) => c.id)).toEqual([1, 2]);
  });
});
