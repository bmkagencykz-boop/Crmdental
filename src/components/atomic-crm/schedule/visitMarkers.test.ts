import { describe, expect, it } from "vitest";

import { firstVisitIds, labMarkers } from "./visitMarkers";

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

describe("labMarkers («Лаб», stage 43)", () => {
  it("marks the fitting visit and the visits of a patient with a work to fit or ready", () => {
    const markers = labMarkers(
      [
        { id: 1, patient_id: 10 },
        { id: 2, patient_id: 10 },
        { id: 3, patient_id: 20 },
        { id: 4, patient_id: 30 },
      ],
      [
        { number: 5, status: "ready", patient_id: 10 },
        { number: 7, status: "fitting", patient_id: 10, fitting_visit_id: 2 },
        { number: 8, status: "lab", patient_id: 20 },
        { number: 9, status: "delivered", patient_id: 30 },
      ],
    );
    expect(markers.get("1")).toEqual({ number: 5, status: "ready" });
    expect(markers.get("2")).toEqual({ number: 7, status: "fitting" });
    expect(markers.has("3")).toBe(false);
    expect(markers.has("4")).toBe(false);
  });
});
