import { X } from "lucide-react";
import { useTranslate, useUserMenu } from "ra-core";
import { useState } from "react";
import { Link, Navigate } from "react-router";
import { Confirm } from "@/components/admin/confirm";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

import {
  progressPercent,
  resolvedCount,
  shouldOpenWizard,
  shouldShowCard,
  TRACKED_STEPS,
} from "./steps";
import {
  useOnboardingProgress,
  useOnboardingRights,
  useUpdateOnboarding,
} from "./useOnboarding";

const WIZARD_PATH = "/onboarding";

/**
 * Dashboard: sends the owner of a clinic that is not set up to the wizard
 * (until it is finished or put off), and shows «Продолжить настройку» with
 * the progress to the owner and the head until it is done or hidden.
 */
export const OnboardingDashboardCard = () => {
  const { canEdit, isOwner, isPending } = useOnboardingRights();
  const { data: progress } = useOnboardingProgress(!isPending && canEdit);
  if (isPending || !canEdit) return null;
  if (shouldOpenWizard(progress, isOwner)) {
    return <Navigate to={WIZARD_PATH} replace />;
  }
  if (!shouldShowCard(progress, canEdit)) return null;
  return (
    <ContinueCard
      resolved={resolvedCount(progress)}
      percent={progressPercent(progress)}
    />
  );
};

const ContinueCard = ({
  resolved,
  percent,
}: {
  resolved: number;
  percent: number;
}) => {
  const translate = useTranslate();
  const update = useUpdateOnboarding();
  const [confirming, setConfirming] = useState(false);
  const title = translate("onboarding.card.title");
  return (
    <section
      aria-label={title}
      className="mb-4 flex flex-wrap items-center gap-4 rounded-md border bg-card px-4 py-3"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <span className="text-sm text-muted-foreground">
            {translate("onboarding.card.text", {
              done: resolved,
              total: TRACKED_STEPS.length,
            })}
          </span>
        </div>
        <div className="h-1.5 max-w-md overflow-hidden rounded-sm bg-muted">
          <div
            className="h-full rounded-sm bg-primary"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <Button asChild>
        <Link to={WIZARD_PATH}>{translate("onboarding.card.continue")}</Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirming(true)}
        aria-label={translate("onboarding.card.dismiss")}
        title={translate("onboarding.card.dismiss")}
      >
        <X className="size-4" />
      </Button>
      <Confirm
        isOpen={confirming}
        title="onboarding.card.dismiss_title"
        content="onboarding.card.dismiss_confirm"
        confirm="onboarding.card.dismiss"
        onConfirm={() =>
          update.mutate(
            { dismissed_at: new Date().toISOString() },
            { onSettled: () => setConfirming(false) },
          )
        }
        onClose={() => setConfirming(false)}
        loading={update.isPending}
      />
    </section>
  );
};

/** «Мастер запуска» in the user menu (owner and head) */
export const OnboardingMenuItem = () => {
  const translate = useTranslate();
  const userMenu = useUserMenu();
  const { canEdit, isPending } = useOnboardingRights();
  if (isPending || !canEdit) return null;
  return (
    <DropdownMenuItem asChild onClick={userMenu?.onClose}>
      <Link to={WIZARD_PATH} className="flex items-center gap-2">
        {translate("onboarding.menu")}
      </Link>
    </DropdownMenuItem>
  );
};
