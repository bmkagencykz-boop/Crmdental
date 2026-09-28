import type { Identifier } from "ra-core";

import { getSupabaseClient } from "./supabase";

/**
 * Branches (stage 33): the dictionary (branches) and who works where
 * (sales_branches) are plain resources; this attaches the deals and visits
 * without a branch to one (public.assign_branch_to_unassigned).
 */
export const getBranchMethods = () => ({
  async assignBranchToUnassigned(
    branchId: Identifier,
  ): Promise<{ deals: number; visits: number }> {
    const { data, error } = await getSupabaseClient().rpc(
      "assign_branch_to_unassigned",
      { target_branch_id: branchId },
    );
    if (error) throw error;
    return data as { deals: number; visits: number };
  },
});
