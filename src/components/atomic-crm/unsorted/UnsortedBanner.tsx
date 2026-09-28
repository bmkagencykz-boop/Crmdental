import { useTranslate } from "ra-core";
import { useNavigate } from "react-router";

import type { Deal } from "../types";
import { UnsortedActions } from "./UnsortedActions";

/** Deal page of an unsorted lead: what it is and the three actions */
export const UnsortedBanner = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const navigate = useNavigate();
  if (!deal.unsorted_at) return null;
  return (
    <div
      className="mx-4 mt-4 flex flex-col gap-2.5 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3"
      data-testid="unsorted-banner"
    >
      <div className="flex items-start gap-2">
        <div>
          <p className="text-sm font-semibold">
            {translate("unsorted.banner.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate("unsorted.banner.hint")}
          </p>
        </div>
      </div>
      <UnsortedActions
        lead={deal}
        onMerged={(dealId) => navigate(`/deals/${dealId}/show`)}
      />
    </div>
  );
};
