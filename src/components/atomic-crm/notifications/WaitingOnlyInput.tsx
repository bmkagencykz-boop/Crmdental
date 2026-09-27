import { useListFilterContext, useTranslate } from "ra-core";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { WAITING_FILTER } from "../providers/commons/responseTime";

/**
 * Quick filter «Ждут ответа» of the deals: the data providers keep the deals
 * whose patient waits longer than the clinic's limit.
 */
export const WaitingOnlyInput = (_: { alwaysOn: boolean; source: string }) => {
  const translate = useTranslate();
  const { filterValues, displayedFilters, setFilters } = useListFilterContext();
  const checked = !!filterValues[WAITING_FILTER];

  const toggle = () => {
    const next = { ...filterValues };
    if (checked) delete next[WAITING_FILTER];
    else next[WAITING_FILTER] = true;
    setFilters(next, displayedFilters);
  };
  return (
    <div className="mt-auto pb-2.25">
      <div className="flex items-center space-x-2">
        <Switch
          id="waiting-response"
          checked={checked}
          onCheckedChange={toggle}
        />
        <Label htmlFor="waiting-response">
          {translate("notifications.waiting.filter")}
        </Label>
      </div>
    </div>
  );
};
