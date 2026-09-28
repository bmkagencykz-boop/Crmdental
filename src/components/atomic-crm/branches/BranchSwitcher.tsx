import { useTranslate } from "ra-core";

import { activeBranches } from "./branches";
import { useCurrentBranch } from "./useBranches";

/**
 * «Все филиалы / Филиал …» in the top bar (stage 33): the deals, the tasks,
 * the schedule and the reports show the chosen branch. Remembered per
 * employee; hidden while the clinic has fewer than two active branches.
 */
export const BranchSwitcher = () => {
  const translate = useTranslate();
  const { branches, enabled, currentId, setCurrent } = useCurrentBranch();
  if (!enabled) return null;
  return (
    <select
      aria-label={translate("branches.switcher.label")}
      title={translate("branches.switcher.label")}
      value={currentId == null ? "" : String(currentId)}
      onChange={(event) => {
        const value = event.target.value;
        const branch = branches.find((b) => String(b.id) === value);
        setCurrent(branch ? branch.id : null);
      }}
      className="h-9 max-w-52 truncate rounded-md border border-input bg-card px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="">{translate("branches.switcher.all")}</option>
      {activeBranches(branches).map((branch) => (
        <option key={branch.id} value={String(branch.id)}>
          {branch.name}
        </option>
      ))}
    </select>
  );
};
