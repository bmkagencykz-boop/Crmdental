import { describe, expect, it } from "vitest";

import {
  accessDefault,
  accessDiff,
  accessMatrix,
  accessPreset,
  accessResolve,
  accessScopes,
  cleanOverrides,
  exportableRows,
  inScope,
  overridesFromMatrix,
  rightsAllow,
} from "./accessRights";
import { createRightsCache } from "./rightsCache";

describe("access rights: scopes and defaults", () => {
  it("knows the scopes of every cell", () => {
    expect(accessScopes("deals", "view")).toEqual([
      "all",
      "own_and_unassigned",
      "own",
      "none",
    ]);
    expect(accessScopes("patients", "delete")).toEqual(["all", "own", "none"]);
    expect(accessScopes("tasks", "create")).toEqual(["all", "none"]);
    expect(accessScopes("reports", "view")).toEqual(["all", "none"]);
    expect(accessScopes("reports", "edit")).toBeNull();
    expect(accessScopes("calls", "view")).toBeNull();
  });

  it("keeps the rules of the roles as defaults", () => {
    expect(accessMatrix("head")).toEqual({
      deals: {
        view: "all",
        create: "all",
        edit: "all",
        delete: "all",
        export: "all",
      },
      patients: {
        view: "all",
        create: "all",
        edit: "all",
        delete: "all",
        export: "all",
      },
      tasks: {
        view: "all",
        create: "all",
        edit: "all",
        delete: "all",
        export: "all",
      },
      reports: { view: "all" },
    });
    expect(accessMatrix("manager")).toEqual({
      deals: {
        view: "all",
        create: "all",
        edit: "all",
        delete: "none",
        export: "all",
      },
      patients: {
        view: "all",
        create: "all",
        edit: "all",
        delete: "all",
        export: "all",
      },
      tasks: {
        view: "all",
        create: "all",
        edit: "all",
        delete: "all",
        export: "all",
      },
      reports: { view: "none" },
    });
  });

  it("follows the clinic setting for a manager's deals", () => {
    expect(accessDefault("manager", "deals", "view", "own")).toBe("own");
    expect(
      accessDefault("manager", "deals", "edit", "own_and_unassigned"),
    ).toBe("own_and_unassigned");
    expect(accessDefault("manager", "deals", "export", "own")).toBe("all");
    expect(accessDefault("head", "deals", "view", "own")).toBe("all");
  });

  it("gives the integrator read-only access and nobody nothing", () => {
    expect(accessMatrix("integrator").deals).toEqual({
      view: "all",
      create: "none",
      edit: "none",
      delete: "none",
      export: "none",
    });
    expect(accessMatrix("integrator").reports.view).toBe("none");
    expect(accessMatrix(undefined).deals.view).toBe("none");
  });
});

describe("access rights: overrides", () => {
  it("applies the owner's choice to heads and managers", () => {
    expect(
      accessResolve("manager", { deals: { view: "own" } }, "deals", "view"),
    ).toBe("own");
    expect(
      accessResolve("head", { reports: { view: "none" } }, "reports", "view"),
    ).toBe("none");
  });

  it("never restricts the owner nor widens the integrator", () => {
    expect(
      accessResolve("owner", { deals: { view: "none" } }, "deals", "view"),
    ).toBe("all");
    expect(
      accessResolve("integrator", { deals: { edit: "all" } }, "deals", "edit"),
    ).toBe("none");
  });

  it("ignores a scope a cell does not accept", () => {
    expect(
      accessResolve(
        "manager",
        { patients: { view: "own_and_unassigned" } },
        "patients",
        "view",
      ),
    ).toBe("all");
    expect(
      accessResolve("manager", { tasks: { create: "own" } }, "tasks", "create"),
    ).toBe("all");
  });

  it("cleans what the settings screen saves", () => {
    expect(
      cleanOverrides({ deals: { view: "own" }, reports: { view: "all" } }),
    ).toEqual({
      deals: { view: "own" },
      reports: { view: "all" },
    });
    expect(() => cleanOverrides({ deals: { view: "some" } })).toThrow();
    expect(() => cleanOverrides({ calls: { view: "all" } })).toThrow();
    expect(() => cleanOverrides([])).toThrow();
  });

  it("saves only the cells that differ from the role", () => {
    const matrix = accessMatrix("manager");
    expect(overridesFromMatrix("manager", matrix)).toBeNull();
    matrix.deals.export = "none";
    matrix.reports.view = "all";
    expect(overridesFromMatrix("manager", matrix)).toEqual({
      deals: { export: "none" },
      reports: { view: "all" },
    });
    // With the clinic setting «own», an untouched view stays the role's
    expect(
      overridesFromMatrix(
        "manager",
        accessMatrix("manager", null, "own"),
        "own",
      ),
    ).toBeNull();
  });

  it("presets are the defaults of a role", () => {
    expect(accessMatrix("manager", accessPreset("head"))).toEqual(
      accessMatrix("head"),
    );
    expect(accessMatrix("head", accessPreset("manager"))).toEqual(
      accessMatrix("manager"),
    );
  });

  it("lists the changed cells like the audit log", () => {
    expect(
      accessDiff(
        accessMatrix("manager"),
        accessMatrix("manager", { deals: { view: "own" } }),
      ),
    ).toEqual({
      "deals.view": ["all", "own"],
    });
  });
});

describe("access rights: scopes of rows and the interface", () => {
  it("checks the scope against the responsible", () => {
    expect(inScope("all", 2, 1)).toBe(true);
    expect(inScope("own", 1, 1)).toBe(true);
    expect(inScope("own", 2, 1)).toBe(false);
    expect(inScope("own", null, 1)).toBe(false);
    expect(inScope("own_and_unassigned", null, 1)).toBe(true);
    expect(inScope("none", 1, 1)).toBe(false);
  });

  it("maps the ra-core actions to the matrix", () => {
    const rights = accessMatrix("manager", {
      deals: { view: "own", edit: "own", delete: "none", export: "none" },
      patients: { view: "none", create: "none" },
      reports: { view: "all" },
    });
    expect(rightsAllow(rights, "deals", "list")).toBe(true);
    expect(rightsAllow(rights, "deals", "edit", { sales_id: 1 }, 1)).toBe(true);
    expect(rightsAllow(rights, "deals", "edit", { sales_id: 2 }, 1)).toBe(
      false,
    );
    expect(rightsAllow(rights, "deals", "delete", { sales_id: 1 }, 1)).toBe(
      false,
    );
    expect(rightsAllow(rights, "deals", "export")).toBe(false);
    expect(rightsAllow(rights, "patients", "menu")).toBe(false);
    // The patient of a visible deal stays readable
    expect(rightsAllow(rights, "patients", "show")).toBe(true);
    expect(rightsAllow(rights, "patients", "create")).toBe(false);
    expect(rightsAllow(rights, "reports", "list")).toBe(true);
    expect(rightsAllow(rights, "sales", "list")).toBeUndefined();
  });

  it("exports only the rows of the export scope", () => {
    const rows = [{ sales_id: 1 }, { sales_id: 2 }, { sales_id: null }];
    expect(exportableRows(rows, "all", 1)).toHaveLength(3);
    expect(exportableRows(rows, "own", 1)).toEqual([{ sales_id: 1 }]);
    expect(exportableRows(rows, "own_and_unassigned", 1)).toHaveLength(2);
    expect(exportableRows(rows, "none", 1)).toEqual([]);
  });
});

describe("rights cache", () => {
  it("asks once while fresh, again when stale or cleared", async () => {
    let calls = 0;
    let time = 0;
    const cache = createRightsCache(
      async () => {
        calls += 1;
        return null;
      },
      1000,
      () => time,
    );
    await Promise.all([cache.get(), cache.get()]);
    expect(calls).toBe(1);
    time = 2000;
    await cache.get();
    expect(calls).toBe(2);
    cache.clear();
    await cache.get();
    expect(calls).toBe(3);
  });

  it("falls back to no rights when the request fails", async () => {
    const cache = createRightsCache(async () => {
      throw new Error("offline");
    });
    await expect(cache.get()).resolves.toBeNull();
  });
});
