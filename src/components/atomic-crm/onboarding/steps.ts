import type { OnboardingProgress, OnboardingStepStatus } from "../types";

/**
 * Steps of the first-run setup wizard («Мастер запуска», stage 24). Every
 * step but the last one («Готово») gets a status in
 * onboarding_progress.steps once it is done or skipped.
 */
export const ONBOARDING_STEPS = [
  "clinic",
  "services",
  "doctors",
  "team",
  "pipeline",
  "channels",
  "import",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type TrackedStep = Exclude<OnboardingStep, "done">;

export const TRACKED_STEPS = ONBOARDING_STEPS.filter(
  (step): step is TrackedStep => step !== "done",
);

/** Steps marked «необязательно» in the step list (every step can be skipped) */
export const OPTIONAL_STEPS: TrackedStep[] = [
  "doctors",
  "team",
  "channels",
  "import",
];

export const isOnboardingStep = (value: unknown): value is OnboardingStep =>
  ONBOARDING_STEPS.includes(value as OnboardingStep);

export type StepState = OnboardingStepStatus | "current" | "todo";

/** What the step list shows next to a step */
export const stepState = (
  progress: Pick<OnboardingProgress, "steps"> | null | undefined,
  step: OnboardingStep,
  current: OnboardingStep,
): StepState => {
  const status = step === "done" ? undefined : progress?.steps?.[step];
  if (step === current) return "current";
  if (status) return status;
  return "todo";
};

/** Steps done or skipped, out of the tracked ones */
export const resolvedCount = (
  progress: Pick<OnboardingProgress, "steps"> | null | undefined,
) => TRACKED_STEPS.filter((step) => progress?.steps?.[step]).length;

export const doneCount = (
  progress: Pick<OnboardingProgress, "steps"> | null | undefined,
) => TRACKED_STEPS.filter((step) => progress?.steps?.[step] === "done").length;

/** 0..100 */
export const progressPercent = (
  progress: Pick<OnboardingProgress, "steps"> | null | undefined,
) => Math.round((resolvedCount(progress) / TRACKED_STEPS.length) * 100);

/** Finished with «Готово», or every step done or skipped */
export const isSetupComplete = (
  progress: OnboardingProgress | null | undefined,
) =>
  !!progress &&
  (!!progress.completed_at || resolvedCount(progress) === TRACKED_STEPS.length);

/**
 * The wizard opens by itself for the owner of a clinic that is not set up,
 * until it is finished, put off («Настроить позже») or hidden for good.
 * Clinics without a progress row (older than the wizard) never see it.
 */
export const shouldOpenWizard = (
  progress: OnboardingProgress | null | undefined,
  isOwner: boolean,
) =>
  isOwner &&
  !!progress &&
  !progress.postponed_at &&
  !progress.dismissed_at &&
  !isSetupComplete(progress);

/** «Продолжить настройку» on the dashboard (owner and head) */
export const shouldShowCard = (
  progress: OnboardingProgress | null | undefined,
  canEdit: boolean,
) =>
  canEdit && !!progress && !progress.dismissed_at && !isSetupComplete(progress);

/** Where the wizard starts: the first step without a status */
export const firstOpenStep = (
  progress: Pick<OnboardingProgress, "steps"> | null | undefined,
): OnboardingStep =>
  TRACKED_STEPS.find((step) => !progress?.steps?.[step]) ?? "done";

export const nextStep = (step: OnboardingStep): OnboardingStep =>
  ONBOARDING_STEPS[
    Math.min(ONBOARDING_STEPS.indexOf(step) + 1, ONBOARDING_STEPS.length - 1)
  ];

export const previousStep = (step: OnboardingStep): OnboardingStep =>
  ONBOARDING_STEPS[Math.max(ONBOARDING_STEPS.indexOf(step) - 1, 0)];

/**
 * The steps after a step is done or skipped. A done step stays done when it
 * is skipped later (the owner went back and forward again).
 */
export const withStepStatus = (
  steps: OnboardingProgress["steps"] | null | undefined,
  step: OnboardingStep,
  status: OnboardingStepStatus,
): OnboardingProgress["steps"] => {
  const current = { ...(steps ?? {}) };
  if (step === "done") return current;
  if (status === "skipped" && current[step] === "done") return current;
  return { ...current, [step]: status };
};

/** Settings section (/#/settings?section=<id>) or page of each step */
export const STEP_LINKS: Record<TrackedStep, string> = {
  clinic: "/settings?section=clinic",
  services: "/settings?section=services",
  doctors: "/settings?section=doctors",
  team: "/sales",
  pipeline: "/settings?section=pipelines",
  channels: "/settings?section=messengers",
  import: "/import",
};
