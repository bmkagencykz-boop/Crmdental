import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCanAccess, useDataProvider, useNotify } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { OnboardingProgress } from "../types";

export const ONBOARDING_QUERY_KEY = ["onboarding_progress"];

/** Progress of the setup wizard of the clinic (null: older clinic) */
export const useOnboardingProgress = (enabled = true) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: () => dataProvider.getOnboardingProgress(),
    enabled,
  });
};

export type OnboardingPatch = Partial<
  Pick<
    OnboardingProgress,
    "steps" | "postponed_at" | "dismissed_at" | "completed_at"
  >
>;

export const useUpdateOnboarding = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return useMutation({
    mutationFn: (patch: OnboardingPatch) =>
      dataProvider.updateOnboardingProgress(patch),
    onSuccess: (data) => queryClient.setQueryData(ONBOARDING_QUERY_KEY, data),
    onError: () => notify("onboarding.save_error", { type: "error" }),
  });
};

/**
 * The owner gets the wizard by himself; owner and head can run it (the
 * database lets both change the progress). Only the owner invites staff.
 */
export const useOnboardingRights = () => {
  const { canAccess: canEdit, isPending: editPending } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  const { canAccess: isOwner, isPending: ownerPending } = useCanAccess({
    resource: "sales",
    action: "create",
  });
  return {
    canEdit: !!canEdit,
    isOwner: !!isOwner,
    isPending: editPending || ownerPending,
  };
};
