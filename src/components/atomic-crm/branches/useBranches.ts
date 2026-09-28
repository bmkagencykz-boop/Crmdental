import { useGetIdentity, useGetList, useStore, type Identifier } from "ra-core";
import { useMemo } from "react";

import {
  branchesEnabled,
  currentBranchStoreKey,
  resolveCurrentBranch,
  type Branch,
  type SalesBranch,
} from "./branches";

// A stable empty list while loading: callers memoize on it
const EMPTY: never[] = [];
const options = { staleTime: 5 * 60 * 1000 };

/** The branches of the clinic, in their order (a dictionary) */
export const useBranches = () => {
  const { data, isPending } = useGetList<Branch>(
    "branches",
    {
      pagination: { page: 1, perPage: 200 },
      sort: { field: "position", order: "ASC" },
    },
    options,
  );
  const branches = data ?? (EMPTY as Branch[]);
  return { branches, enabled: branchesEnabled(branches), isPending };
};

/** Who works where (public.sales_branches) */
export const useSalesBranches = () => {
  const { data, isPending } = useGetList<SalesBranch>(
    "sales_branches",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "sales_id", order: "ASC" },
    },
    options,
  );
  return { rows: data ?? (EMPTY as SalesBranch[]), isPending };
};

/**
 * The branch chosen in the top bar («Все филиалы»: null), remembered per
 * employee. Null too while the clinic has fewer than two active branches.
 */
export const useCurrentBranch = () => {
  const { branches, enabled } = useBranches();
  const { identity } = useGetIdentity();
  const [storedId, setStoredId] = useStore<Identifier | null>(
    currentBranchStoreKey(identity?.id),
    null,
  );
  const current = useMemo(
    () => resolveCurrentBranch(branches, storedId),
    [branches, storedId],
  );
  return {
    branches,
    enabled,
    current,
    currentId: current?.id ?? null,
    setCurrent: (id: Identifier | null) => setStoredId(id),
  };
};
