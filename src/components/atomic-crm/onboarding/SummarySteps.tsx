import { Check, CircleDashed } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { OnboardingProgress } from "../types";
import { STEP_LINKS, TRACKED_STEPS } from "./steps";

/** Step «Импорт»: a link to the import wizard, or skip */
export const ImportStep = ({ onOpen }: { onOpen: () => void }) => {
  const translate = useTranslate();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-sm">{translate("onboarding.import.text")}</p>
      <div>
        <Button asChild variant="outline" onClick={onOpen}>
          <Link to="/import">{translate("onboarding.import.open")}</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate("onboarding.import.later")}
      </p>
    </div>
  );
};

/** Step «Готово»: every step with its status and its settings section */
export const DoneStep = ({
  progress,
  onFinish,
}: {
  progress: OnboardingProgress;
  onFinish: (to: string) => void;
}) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold">
          {translate("onboarding.done.title")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {translate("onboarding.done.text")}
        </p>
      </div>
      <ul
        className="flex max-w-2xl flex-col divide-y rounded-md border bg-card"
        aria-label={translate("onboarding.steps.done.title")}
      >
        {TRACKED_STEPS.map((step) => {
          const status = progress.steps?.[step];
          return (
            <li
              key={step}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  status === "done"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {status === "done" ? (
                  <Check className="size-3.5" />
                ) : (
                  <CircleDashed className="size-3.5" />
                )}
              </span>
              <span className="flex-1 font-medium">
                {translate(`onboarding.steps.${step}.title`)}
              </span>
              <span className="text-xs text-muted-foreground">
                {translate(`onboarding.status.${status ?? "todo"}`)}
              </span>
              <Link
                to={STEP_LINKS[step]}
                onClick={(event) => {
                  // Finishes the wizard first, then goes there
                  event.preventDefault();
                  onFinish(STEP_LINKS[step]);
                }}
                className="flex items-center gap-1 text-xs font-medium text-brand-link"
              >
                {translate("onboarding.done.open_section")}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => onFinish("/deals")}>
          {translate("onboarding.done.open_pipeline")}
        </Button>
        <Button variant="outline" onClick={() => onFinish("/")}>
          {translate("onboarding.done.to_dashboard")}
        </Button>
      </div>
    </div>
  );
};
