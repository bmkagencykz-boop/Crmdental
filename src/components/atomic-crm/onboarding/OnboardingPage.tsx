import { Check, Loader2 } from "lucide-react";
import { useAuthenticated, useTranslate } from "ra-core";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { DoctorsEditor } from "../settings/DoctorsEditor";
import type { OnboardingProgress, OnboardingStepStatus } from "../types";
import { ChannelsStep } from "./ChannelsStep";
import { ClinicStep } from "./ClinicStep";
import { PipelineStep } from "./PipelineStep";
import { ServicesStep } from "./ServicesStep";
import {
  firstOpenStep,
  isOnboardingStep,
  isSetupComplete,
  nextStep,
  ONBOARDING_STEPS,
  OPTIONAL_STEPS,
  previousStep,
  resolvedCount,
  stepState,
  TRACKED_STEPS,
  withStepStatus,
  type OnboardingStep,
  type StepState,
  type TrackedStep,
} from "./steps";
import type { NextHandler } from "./stepTypes";
import { DoneStep, ImportStep } from "./SummarySteps";
import { TeamStep } from "./TeamStep";
import {
  useOnboardingProgress,
  useOnboardingRights,
  useUpdateOnboarding,
} from "./useOnboarding";

const EMPTY_PROGRESS: OnboardingProgress = { organization_id: 0, steps: {} };

/**
 * «Мастер запуска» (stage 24): a full page with the steps on the left and
 * one card per step (Назад / Пропустить / Далее). Every step saves at once
 * through the usual settings; the progress is kept per clinic. ?step=<id>
 * opens a step. Owner and head only.
 */
export const OnboardingPage = () => {
  useAuthenticated();
  useConfigurationLoader();
  const translate = useTranslate();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { canEdit, isOwner, isPending: rightsPending } = useOnboardingRights();
  const { data, isPending } = useOnboardingProgress();
  const update = useUpdateOnboarding();
  const [busy, setBusy] = useState(false);
  const nextHandler = useRef<NextHandler | null>(null);
  const registerNext = useCallback((handler: NextHandler | null) => {
    nextHandler.current = handler;
  }, []);

  if (isPending || rightsPending) return <PageSkeleton />;
  if (!canEdit) return <Navigate to="/" replace />;

  const progress = data ?? EMPTY_PROGRESS;
  const requested = params.get("step");
  const current: OnboardingStep = isOnboardingStep(requested)
    ? requested
    : firstOpenStep(progress);
  const complete = isSetupComplete(data);

  const go = (step: OnboardingStep) => setParams({ step });
  const mark = async (step: OnboardingStep, status: OnboardingStepStatus) => {
    const steps = withStepStatus(progress.steps, step, status);
    if (data && JSON.stringify(steps) !== JSON.stringify(progress.steps)) {
      await update.mutateAsync({ steps });
    }
  };
  const act = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      // The mutation has notified the error
    } finally {
      setBusy(false);
    }
  };

  const onNext = () =>
    act(async () => {
      if (nextHandler.current && !(await nextHandler.current())) return;
      await mark(current, "done");
      go(nextStep(current));
    });
  const onSkip = () =>
    act(async () => {
      await mark(current, "skipped");
      go(nextStep(current));
    });
  const onLater = () =>
    act(async () => {
      if (data && !complete && !data.postponed_at) {
        await update.mutateAsync({ postponed_at: new Date().toISOString() });
      }
      navigate("/");
    });
  const onFinish = (to: string) =>
    act(async () => {
      if (data && !data.completed_at) {
        await update.mutateAsync({ completed_at: new Date().toISOString() });
      }
      navigate(to);
    });

  const steps: Record<OnboardingStep, ReactNode> = {
    clinic: <ClinicStep registerNext={registerNext} />,
    services: <ServicesStep />,
    doctors: (
      <div className="flex flex-col gap-3">
        <DoctorsEditor />
        <p className="text-xs text-muted-foreground">
          {translate("onboarding.doctors.later")}
        </p>
      </div>
    ),
    team: <TeamStep isOwner={isOwner} />,
    pipeline: <PipelineStep />,
    channels: <ChannelsStep />,
    import: <ImportStep onOpen={() => void mark("import", "done")} />,
    done: <DoneStep progress={progress} onFinish={onFinish} />,
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-card px-6">
        <span className="text-[1.2rem] tracking-[-0.02em]">
          <span className="font-bold tracking-[-0.03em]">dental</span>
          <span className="font-bold text-brand-pink">crm</span>
        </span>
        <span className="h-5 border-l" />
        <h1 className="text-base font-semibold">
          {translate("onboarding.title")}
        </h1>
        <span className="hidden text-sm text-muted-foreground md:inline">
          {translate("onboarding.subtitle")}
        </span>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={onLater}
          disabled={busy}
        >
          {translate(complete ? "onboarding.close" : "onboarding.later")}
        </Button>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[15rem_minmax(0,1fr)]">
        <StepList progress={progress} current={current} onSelect={go} />

        <section
          className="flex min-h-[28rem] flex-col rounded-md border bg-card shadow-sm"
          aria-labelledby="onboarding-step-title"
        >
          <div className="border-b px-6 py-4">
            <p className="text-xs font-medium text-muted-foreground">
              {current === "done"
                ? translate("onboarding.progress", {
                    done: resolvedCount(progress),
                    total: TRACKED_STEPS.length,
                  })
                : `${ONBOARDING_STEPS.indexOf(current) + 1} / ${TRACKED_STEPS.length}`}
            </p>
            <h2
              id="onboarding-step-title"
              className="text-lg font-semibold"
            >
              {translate(`onboarding.steps.${current}.title`)}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {translate(`onboarding.steps.${current}.hint`)}
            </p>
          </div>
          <div className="flex-1 px-6 py-5" key={current}>
            {steps[current]}
          </div>
          <div className="flex items-center gap-2 border-t px-6 py-3">
            <Button
              variant="ghost"
              onClick={() => go(previousStep(current))}
              disabled={current === ONBOARDING_STEPS[0] || busy}
            >
              {translate("onboarding.actions.back")}
            </Button>
            {current !== "done" ? (
              <>
                <Button
                  variant="outline"
                  className="ml-auto"
                  onClick={onSkip}
                  disabled={busy}
                >
                  {translate("onboarding.actions.skip")}
                </Button>
                <Button onClick={onNext} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  {translate("onboarding.actions.next")}
                </Button>
              </>
            ) : null}
          </div>
        </section>
      </div>
      <Notification />
    </div>
  );
};

OnboardingPage.path = "/onboarding";

const StepList = ({
  progress,
  current,
  onSelect,
}: {
  progress: OnboardingProgress;
  current: OnboardingStep;
  onSelect: (step: OnboardingStep) => void;
}) => {
  const translate = useTranslate();
  const resolved = resolvedCount(progress);
  const total = TRACKED_STEPS.length;
  return (
    <nav
      aria-label={translate("onboarding.title")}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{translate("onboarding.title")}</span>
          <span className="tabular-nums">
            {translate("onboarding.progress", { done: resolved, total })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-sm bg-muted">
          <div
            className="h-full rounded-sm bg-primary transition-all"
            style={{ width: `${Math.round((resolved / total) * 100)}%` }}
          />
        </div>
      </div>
      <ol className="flex flex-col gap-0.5">
        {ONBOARDING_STEPS.map((step, index) => {
          const state = stepState(progress, step, current);
          return (
            <li key={step}>
              <button
                type="button"
                onClick={() => onSelect(step)}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                  state === "current"
                    ? "bg-card font-semibold shadow-sm ring-1 ring-border"
                    : "hover:bg-[var(--surface-strong)]",
                )}
              >
                <StepBadge state={state} index={index} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    {translate(`onboarding.steps.${step}.title`)}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {state === "todo" &&
                    OPTIONAL_STEPS.includes(step as TrackedStep)
                      ? translate("onboarding.optional")
                      : step === "done" && state === "todo"
                        ? null
                        : translate(`onboarding.status.${state}`)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

const StepBadge = ({ state, index }: { state: StepState; index: number }) => (
  <span
    className={cn(
      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
      state === "done" && "bg-primary text-primary-foreground",
      state === "skipped" && "bg-muted text-muted-foreground line-through",
      state === "current" && "border-2 border-primary text-primary",
      state === "todo" && "border text-muted-foreground",
    )}
    aria-hidden
  >
    {state === "done" ? <Check className="size-3.5" /> : index + 1}
  </span>
);

const PageSkeleton = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="size-6 animate-spin text-muted-foreground" />
  </div>
);
