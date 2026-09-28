import { describe, expect, it } from "vitest";

import type { OnboardingProgress } from "../types";
import {
  firstOpenStep,
  isSetupComplete,
  nextStep,
  previousStep,
  progressPercent,
  resolvedCount,
  shouldOpenWizard,
  shouldShowCard,
  stepState,
  TRACKED_STEPS,
  withStepStatus,
} from "./steps";

const progress = (
  extra: Partial<OnboardingProgress> = {},
): OnboardingProgress => ({ organization_id: 1, steps: {}, ...extra });

const allResolved = Object.fromEntries(
  TRACKED_STEPS.map((step, index) => [step, index % 2 ? "skipped" : "done"]),
) as OnboardingProgress["steps"];

describe("step order", () => {
  it("walks through the eight steps", () => {
    expect(TRACKED_STEPS).toEqual([
      "clinic",
      "services",
      "doctors",
      "team",
      "pipeline",
      "channels",
      "import",
    ]);
    expect(nextStep("clinic")).toBe("services");
    expect(nextStep("import")).toBe("done");
    expect(nextStep("done")).toBe("done");
    expect(previousStep("services")).toBe("clinic");
    expect(previousStep("clinic")).toBe("clinic");
  });

  it("starts at the first step without a status", () => {
    expect(firstOpenStep(progress())).toBe("clinic");
    expect(
      firstOpenStep(progress({ steps: { clinic: "done", services: "done" } })),
    ).toBe("doctors");
    expect(firstOpenStep(progress({ steps: { services: "done" } }))).toBe(
      "clinic",
    );
    expect(firstOpenStep(progress({ steps: allResolved }))).toBe("done");
    expect(firstOpenStep(null)).toBe("clinic");
  });
});

describe("step statuses", () => {
  it("shows done, skipped, current and todo", () => {
    const p = progress({ steps: { clinic: "done", doctors: "skipped" } });
    expect(stepState(p, "clinic", "services")).toBe("done");
    expect(stepState(p, "doctors", "services")).toBe("skipped");
    expect(stepState(p, "services", "services")).toBe("current");
    expect(stepState(p, "team", "services")).toBe("todo");
    expect(stepState(p, "clinic", "clinic")).toBe("current");
    expect(stepState(p, "done", "clinic")).toBe("todo");
  });

  it("marks a step and keeps a done step done when skipped later", () => {
    expect(withStepStatus({}, "clinic", "done")).toEqual({ clinic: "done" });
    expect(withStepStatus({ team: "skipped" }, "team", "done")).toEqual({
      team: "done",
    });
    expect(withStepStatus({ team: "done" }, "team", "skipped")).toEqual({
      team: "done",
    });
    expect(withStepStatus(null, "doctors", "skipped")).toEqual({
      doctors: "skipped",
    });
    expect(withStepStatus({ clinic: "done" }, "done", "done")).toEqual({
      clinic: "done",
    });
  });

  it("counts the progress", () => {
    const p = progress({ steps: { clinic: "done", doctors: "skipped" } });
    expect(resolvedCount(p)).toBe(2);
    expect(progressPercent(p)).toBe(29);
    expect(progressPercent(progress({ steps: allResolved }))).toBe(100);
    expect(progressPercent(undefined)).toBe(0);
  });
});

describe("completion", () => {
  it("is complete when finished or every step is resolved", () => {
    expect(isSetupComplete(progress())).toBe(false);
    expect(isSetupComplete(progress({ completed_at: "2026-10-01" }))).toBe(
      true,
    );
    expect(isSetupComplete(progress({ steps: allResolved }))).toBe(true);
    expect(isSetupComplete(null)).toBe(false);
  });

  it("opens the wizard for the owner of a clinic that is not set up", () => {
    expect(shouldOpenWizard(progress(), true)).toBe(true);
    expect(shouldOpenWizard(progress(), false)).toBe(false);
    expect(
      shouldOpenWizard(progress({ postponed_at: "2026-10-01" }), true),
    ).toBe(false);
    expect(
      shouldOpenWizard(progress({ dismissed_at: "2026-10-01" }), true),
    ).toBe(false);
    expect(
      shouldOpenWizard(progress({ completed_at: "2026-10-01" }), true),
    ).toBe(false);
    // Clinics older than the wizard have no progress row
    expect(shouldOpenWizard(null, true)).toBe(false);
  });

  it("shows the dashboard card until set up or hidden", () => {
    expect(shouldShowCard(progress({ postponed_at: "2026-10-01" }), true)).toBe(
      true,
    );
    expect(shouldShowCard(progress(), true)).toBe(true);
    expect(shouldShowCard(progress(), false)).toBe(false);
    expect(shouldShowCard(progress({ dismissed_at: "2026-10-01" }), true)).toBe(
      false,
    );
    expect(shouldShowCard(progress({ steps: allResolved }), true)).toBe(false);
    expect(shouldShowCard(undefined, true)).toBe(false);
  });
});
