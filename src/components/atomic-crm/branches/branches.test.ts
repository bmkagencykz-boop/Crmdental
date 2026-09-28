import { describe, expect, it } from "vitest";

import {
  exportableRows,
  inScope,
  rightsAllow,
  accessMatrix,
} from "../access-rights/accessRights";
import {
  activeBranches,
  branchChoices,
  branchFilter,
  branchesEnabled,
  branchesOf,
  branchName,
  branchPool,
  currentBranchStoreKey,
  guessDealBranch,
  inBranch,
  inMyBranches,
  resolveCurrentBranch,
  visitBranch,
  type Branch,
} from "./branches";

const branch = (id: number, name: string, extra: Partial<Branch> = {}) =>
  ({ id, name, is_active: true, position: id, ...extra }) as Branch;

const MAIN = branch(1, "Достык");
const ABAYA = branch(2, "Абая");
const OLD = branch(3, "Старый", { is_active: false });

describe("branches: when the interface shows them", () => {
  it("needs two active branches", () => {
    expect(branchesEnabled([])).toBe(false);
    expect(branchesEnabled([MAIN])).toBe(false);
    expect(branchesEnabled([MAIN, OLD])).toBe(false);
    expect(branchesEnabled([MAIN, ABAYA])).toBe(true);
    expect(activeBranches([ABAYA, OLD, MAIN]).map((b) => b.id)).toEqual([1, 2]);
  });

  it("resolves the branch of the top bar", () => {
    expect(resolveCurrentBranch([MAIN, ABAYA], 2)?.name).toBe("Абая");
    expect(resolveCurrentBranch([MAIN, ABAYA], "2")?.name).toBe("Абая");
    // «Все филиалы», a switched-off or unknown branch, a single branch
    expect(resolveCurrentBranch([MAIN, ABAYA], null)).toBeNull();
    expect(resolveCurrentBranch([MAIN, ABAYA, OLD], 3)).toBeNull();
    expect(resolveCurrentBranch([MAIN, ABAYA], 9)).toBeNull();
    expect(resolveCurrentBranch([MAIN], 1)).toBeNull();
    expect(currentBranchStoreKey(5)).toBe("branches.current.5");
  });

  it("filters the lists by the chosen branch", () => {
    expect(branchFilter(null)).toEqual({});
    expect(branchFilter(2)).toEqual({ branch_id: 2 });
    const doctors = [
      { id: 1, branch_id: 1 },
      { id: 2, branch_id: 2 },
      { id: 3, branch_id: null },
    ];
    // A doctor or a chair without a branch works in every branch
    expect(inBranch(doctors, 2).map((d) => d.id)).toEqual([2, 3]);
    expect(inBranch(doctors, null)).toHaveLength(3);
  });

  it("names and offers the branches", () => {
    expect(branchName([MAIN, ABAYA], 2)).toBe("Абая");
    expect(branchName([MAIN], 9)).toBeNull();
    expect(branchChoices([ABAYA, OLD, MAIN]).map((c) => c.id)).toEqual([1, 2]);
    expect(branchChoices([ABAYA, OLD, MAIN], 3).map((c) => c.id)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("branches: the database rules (twin)", () => {
  const links = [
    { sales_id: 10, branch_id: 1 },
    { sales_id: 11, branch_id: 2 },
    { sales_id: 12, branch_id: 1 },
    { sales_id: 12, branch_id: 2 },
  ];

  it("guesses the branch of a new deal", () => {
    expect(
      guessDealBranch({ doctorBranchId: 2, responsibleBranches: [1] }),
    ).toBe(2);
    expect(
      guessDealBranch({ responsibleBranches: branchesOf(links, 10) }),
    ).toBe(1);
    // An employee of several branches, or of none: no guess
    expect(
      guessDealBranch({ responsibleBranches: branchesOf(links, 12) }),
    ).toBeNull();
    expect(guessDealBranch({ responsibleBranches: [] })).toBeNull();
  });

  it("gives a visit the branch of its chair, doctor or deal", () => {
    expect(visitBranch({ chosen: 1, chairBranchId: 2 })).toBe(1);
    expect(visitBranch({ chairBranchId: 2, doctorBranchId: 1 })).toBe(2);
    expect(visitBranch({ doctorBranchId: 1, dealBranchId: 2 })).toBe(1);
    expect(visitBranch({ dealBranchId: 2 })).toBe(2);
    expect(visitBranch({})).toBeNull();
  });

  it("distributes a lead of a branch among its employees", () => {
    expect(branchPool([10, 11], 2, links)).toEqual([11]);
    expect(branchPool([10, 11, 12], 1, links)).toEqual([10, 12]);
    // Nobody of the chosen ones works there: all of them (no lost lead)
    expect(branchPool([10], 2, links)).toEqual([10]);
    expect(branchPool([10, 11], null, links)).toEqual([10, 11]);
  });

  it("knows «Мой филиал»", () => {
    expect(inMyBranches({ sales_id: 5, branch_id: 2 }, 5, [1])).toBe(true);
    expect(inMyBranches({ sales_id: 6, branch_id: 1 }, 5, [1])).toBe(true);
    expect(inMyBranches({ sales_id: 6, branch_id: null }, 5, [1])).toBe(true);
    expect(inMyBranches({ sales_id: 6, branch_id: 2 }, 5, [1])).toBe(false);
  });
});

describe("access rights: the scope «Мой филиал»", () => {
  const mine = { id: 2, mine: [2] };

  it("lets an employee act on their branch, their own rows and shared ones", () => {
    expect(inScope("branch", 6, 5, mine)).toBe(true);
    expect(inScope("branch", 5, 5, { id: 1, mine: [2] })).toBe(true);
    expect(inScope("branch", 6, 5, { id: null, mine: [2] })).toBe(true);
    expect(inScope("branch", 6, 5, { id: 1, mine: [2] })).toBe(false);
    // A record that does not carry its branch: the database decides
    expect(inScope("branch", 6, 5)).toBe(true);
  });

  it("guards the ra-core actions of deals and tasks", () => {
    const rights = accessMatrix("manager", {
      deals: { view: "branch", edit: "branch" },
      tasks: { edit: "branch" },
    });
    expect(rightsAllow(rights, "deals", "list")).toBe(true);
    expect(
      rightsAllow(rights, "deals", "edit", { sales_id: 6, branch_id: 1 }, 5, [
        2,
      ]),
    ).toBe(false);
    expect(
      rightsAllow(rights, "deals", "edit", { sales_id: 6, branch_id: 2 }, 5, [
        2,
      ]),
    ).toBe(true);
    expect(
      rightsAllow(rights, "tasks", "edit", { sales_id: 6, branch_id: 1 }, 5, [
        2,
      ]),
    ).toBe(false);
  });

  it("exports the rows of the employee's branches", () => {
    const rows = [
      { id: 1, sales_id: 6, branch_id: 1 },
      { id: 2, sales_id: 6, branch_id: 2 },
      { id: 3, sales_id: 5, branch_id: 1 },
      { id: 4, sales_id: 6, branch_id: null },
    ];
    expect(exportableRows(rows, "branch", 5, [2]).map((r) => r.id)).toEqual([
      2, 3, 4,
    ]);
  });
});
