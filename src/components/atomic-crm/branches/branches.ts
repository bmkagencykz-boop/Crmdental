import type { Identifier } from "ra-core";

/**
 * Branches «Филиалы» (stage 33), twin of supabase/schemas/33_branches.sql.
 *
 * A clinic network with several addresses. branch_id is nullable
 * everywhere: a row without a branch is «общий» (a doctor or a chair of
 * every branch, a deal of the whole network). The interface shows the
 * branches from the second active one on: a clinic with one address looks
 * exactly as before.
 */

export type Branch = {
  id: Identifier;
  name: string;
  address?: string | null;
  phone?: string | null;
  is_active: boolean;
  position: number;
  created_at?: string;
};

/** A row of public.sales_branches: the employee works in the branch */
export type SalesBranch = {
  id: Identifier;
  sales_id: Identifier;
  branch_id: Identifier;
};
/** Who works where, whatever the row */
type BranchLink = Pick<SalesBranch, "sales_id" | "branch_id">;

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/** Active branches in their order */
export const activeBranches = (branches: Branch[]) =>
  branches
    .filter((branch) => branch.is_active)
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));

/** The branch UI appears from the second active branch on */
export const branchesEnabled = (branches: Branch[]) =>
  activeBranches(branches).length >= 2;

/**
 * The branch chosen in the top bar («Все филиалы» → null). A remembered
 * branch that was switched off or deleted falls back to «Все».
 */
export const resolveCurrentBranch = (
  branches: Branch[],
  storedId: Identifier | null | undefined,
): Branch | null => {
  if (!branchesEnabled(branches)) return null;
  return activeBranches(branches).find((b) => same(b.id, storedId)) ?? null;
};

/** The permanent list filter of the chosen branch (deals, tasks, visits) */
export const branchFilter = (
  branchId: Identifier | null | undefined,
): Record<string, Identifier> =>
  branchId == null ? {} : { branch_id: branchId };

/**
 * Doctors and chairs of a branch: those of the branch and the shared ones
 * (no branch). No branch chosen: all of them.
 */
export const inBranch = <T extends { branch_id?: Identifier | null }>(
  items: T[],
  branchId: Identifier | null | undefined,
) =>
  branchId == null
    ? items
    : items.filter(
        (item) => item.branch_id == null || same(item.branch_id, branchId),
      );

/** The name of a branch, null when unknown */
export const branchName = (
  branches: Branch[],
  branchId: Identifier | null | undefined,
) => branches.find((b) => same(b.id, branchId))?.name ?? null;

/** Choices of a branch picker: active ones, the current one kept */
export const branchChoices = (
  branches: Branch[],
  selected?: Identifier | null,
) =>
  [...branches]
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id))
    .filter((branch) => branch.is_active || same(branch.id, selected))
    .map((branch) => ({ id: branch.id, name: branch.name }));

/** The branches an employee works in */
export const branchesOf = (
  rows: BranchLink[],
  salesId: Identifier | null | undefined,
): Identifier[] =>
  rows.filter((row) => same(row.sales_id, salesId)).map((row) => row.branch_id);

/**
 * The branch a new deal gets when none is given (trigger
 * deal_assign_branch): the doctor's, else the responsible's (or the
 * creator's) when they work in one branch only.
 */
export const guessDealBranch = ({
  doctorBranchId,
  responsibleBranches,
}: {
  doctorBranchId?: Identifier | null;
  responsibleBranches: Identifier[];
}): Identifier | null =>
  doctorBranchId ??
  (responsibleBranches.length === 1 ? responsibleBranches[0] : null);

/**
 * The branch of a visit (trigger visit_branch): the one chosen, else its
 * chair's, else its doctor's, else its deal's.
 */
export const visitBranch = ({
  chosen,
  chairBranchId,
  doctorBranchId,
  dealBranchId,
}: {
  chosen?: Identifier | null;
  chairBranchId?: Identifier | null;
  doctorBranchId?: Identifier | null;
  dealBranchId?: Identifier | null;
}): Identifier | null =>
  chosen ?? chairBranchId ?? doctorBranchId ?? dealBranchId ?? null;

/**
 * The employees a lead of a branch goes to (private.branch_pool): the
 * candidates working in the branch, in their order; all of them when the
 * lead has no branch or none of them works there.
 */
export const branchPool = (
  candidates: Identifier[],
  branchId: Identifier | null | undefined,
  rows: BranchLink[],
): Identifier[] => {
  if (branchId == null) return candidates;
  const inside = candidates.filter((id) =>
    rows.some((row) => same(row.sales_id, id) && same(row.branch_id, branchId)),
  );
  return inside.length ? inside : candidates;
};

/**
 * «Мой филиал» (the access scope 'branch'): an own row, a row of one of the
 * employee's branches or a row without a branch.
 */
export const inMyBranches = (
  row: {
    sales_id?: Identifier | null;
    branch_id?: Identifier | null;
  },
  me: Identifier | null | undefined,
  myBranches: Identifier[],
) =>
  same(row.sales_id, me) ||
  row.branch_id == null ||
  myBranches.some((id) => same(id, row.branch_id));

/** The store key of the top bar's branch, per employee */
export const currentBranchStoreKey = (salesId: Identifier | null | undefined) =>
  `branches.current.${salesId ?? "me"}`;
