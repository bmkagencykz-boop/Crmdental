import { describe, expect, it } from "vitest";

import { firstVisitIds } from "./visitMarkers";

const visit = (
  id: number,
  patient_id: number,
  starts_at: string,
  status: "scheduled" | "completed" | "no_show" | "cancelled" = "scheduled",
) => ({ id, patient_id, starts_at, status });

describe("firstVisitIds", () => {
  it("marks the earliest visit of a new patient only", () => {
    const ids = firstVisitIds(
      [
        visit(2, 1, "2026-10-02T10:00:00Z"),
        visit(1, 1, "2026-10-01T10:00:00Z"),
        visit(3, 2, "2026-10-01T09:00:00Z"),
      ],
      [],
    );
    expect([...ids].sort()).toEqual(["1", "3"]);
  });

  it("skips patients who came before the shown days", () => {
    const ids = firstVisitIds(
      [visit(1, 1, "2026-10-01T10:00:00Z")],
      [{ patient_id: 1 }],
    );
    expect(ids.size).toBe(0);
  });

  it("does not count missed and cancelled visits", () => {
    const ids = firstVisitIds(
      [
        visit(1, 1, "2026-10-01T10:00:00Z", "no_show"),
        visit(2, 1, "2026-10-02T10:00:00Z", "cancelled"),
        visit(3, 1, "2026-10-03T10:00:00Z"),
      ],
      [],
    );
    expect([...ids]).toEqual(["3"]);
  });
});
