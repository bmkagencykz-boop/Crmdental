import { useQueryClient } from "@tanstack/react-query";
import { useNotify, useUpdate } from "ra-core";

import type { Deal } from "../../types";

/**
 * Saves fields of the deal page one by one. The database checks the rules
 * (lost reason, checklist, lost deals locked): its message is shown as is.
 */
export const useDealUpdate = (deal: Deal) => {
  const [update, { isPending }] = useUpdate<Deal>();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const save = (data: Partial<Deal>, onSuccess?: () => void) =>
    update(
      "deals",
      { id: deal.id, data, previousData: deal },
      {
        mutationMode: "pessimistic",
        onSuccess: () => {
          // The page reads the deals_summary view (patient, stage kind...)
          queryClient.invalidateQueries({ queryKey: ["deals"] });
          queryClient.invalidateQueries({ queryKey: ["deal_events"] });
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          onSuccess?.();
        },
        onError: (error: any) =>
          notify(error?.message || "ra.notification.http_error", {
            type: "error",
          }),
      },
    );
  return { save, isPending };
};
