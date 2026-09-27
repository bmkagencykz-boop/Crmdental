import { describe, expect, it } from "vitest";

import {
  chunk,
  distinctIds,
  failure,
  isAllowedAction,
  mergeResults,
  nextTags,
} from "./bulk";

describe("bulk helpers", () => {
  it("splits the ids into chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("merges the answers of several calls", () => {
    expect(
      mergeResults("stage", [
        {
          action: "stage",
          results: [{ id: 1, ok: true }],
          ok: 1,
          failed: 0,
        },
        {
          action: "stage",
          results: [{ id: 2, ok: false, error: "x", code: "c" }],
          ok: 0,
          failed: 1,
          mailing_id: 9,
        },
      ]),
    ).toEqual({
      action: "stage",
      results: [
        { id: 1, ok: true },
        { id: 2, ok: false, error: "x", code: "c" },
      ],
      ok: 1,
      failed: 1,
      mailing_id: 9,
    });
  });

  it("keeps distinct ids in order", () => {
    expect(distinctIds([3, 1, "3", 2, 1])).toEqual([3, 1, 2]);
  });

  it("adds tags once and removes them", () => {
    expect(nextTags("add_tags", [5, 2], [2, 9, 1, 9])).toEqual([5, 2, 1, 9]);
    expect(nextTags("remove_tags", [5, 2, 9], [2, "9"])).toEqual([5]);
  });

  it("reports an error with the rule (hint) of the database", () => {
    expect(
      failure(4, {
        message: "Выполните чек-лист этапа «Новый лид»",
        hint: "stage_checklist_incomplete",
      }),
    ).toEqual({
      id: 4,
      ok: false,
      error: "Выполните чек-лист этапа «Новый лид»",
      code: "stage_checklist_incomplete",
    });
    expect(failure(4, new Error("boom")).code).toBe("error");
  });

  it("keeps messages, archive and delete for the owner and the head", () => {
    expect(isAllowedAction("stage", "manager")).toBe(true);
    expect(isAllowedAction("export", "manager")).toBe(true);
    expect(isAllowedAction("delete", "manager")).toBe(false);
    expect(isAllowedAction("message", "head")).toBe(true);
    expect(isAllowedAction("archive", "owner")).toBe(true);
  });
});
