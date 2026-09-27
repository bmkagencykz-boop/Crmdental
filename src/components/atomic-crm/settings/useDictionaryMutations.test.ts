import { describe, expect, it } from "vitest";
import { explainError, moveItem } from "./useDictionaryMutations";

const items = [
  { id: 1, position: 0 },
  { id: 2, position: 1 },
  { id: 3, position: 2 },
];

describe("moveItem", () => {
  it("swaps positions with the neighbour", () => {
    expect(moveItem(items, 2, -1)).toEqual([
      [items[1], 0],
      [items[0], 1],
    ]);
  });

  it("does nothing at the ends", () => {
    expect(moveItem(items, 1, -1)).toEqual([]);
    expect(moveItem(items, 3, 1)).toEqual([]);
  });

  it("handles equal positions", () => {
    const flat = [
      { id: 1, position: 0 },
      { id: 2, position: 0 },
    ];
    expect(moveItem(flat, 1, 1)).toEqual([
      [flat[0], 1],
      [flat[1], 0],
    ]);
  });
});

describe("explainError", () => {
  it("explains foreign key errors", () => {
    expect(
      explainError({
        message: 'violates foreign key constraint "deals_stage_id_fkey"',
      }),
    ).toBe("crm.settings.errors.in_use");
  });

  it("keeps other messages", () => {
    expect(explainError({ message: "Укажите причину отказа" })).toBe(
      "Укажите причину отказа",
    );
  });
});
