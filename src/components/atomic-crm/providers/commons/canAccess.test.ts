import { describe, expect, it } from "vitest";
import { accessMatrix } from "../../access-rights/accessRights";
import { canAccess } from "./canAccess";

describe("canAccess", () => {
  it("lets the owner do everything", () => {
    expect(canAccess("owner", { resource: "sales", action: "create" })).toBe(
      true,
    );
    expect(
      canAccess("owner", { resource: "configuration", action: "edit" }),
    ).toBe(true);
  });

  it("lets the head change settings and list the staff, not manage it", () => {
    expect(
      canAccess("head", { resource: "configuration", action: "edit" }),
    ).toBe(true);
    expect(canAccess("head", { resource: "sales", action: "list" })).toBe(true);
    expect(canAccess("head", { resource: "sales", action: "create" })).toBe(
      false,
    );
    expect(canAccess("head", { resource: "sales", action: "edit" })).toBe(
      false,
    );
  });

  it("keeps managers away from settings and staff", () => {
    expect(
      canAccess("manager", { resource: "configuration", action: "edit" }),
    ).toBe(false);
    expect(canAccess("manager", { resource: "sales", action: "list" })).toBe(
      false,
    );
    expect(canAccess("manager", { resource: "deals", action: "edit" })).toBe(
      true,
    );
  });

  it("shows the reports to the owner and the head only", () => {
    expect(canAccess("owner", { resource: "reports", action: "list" })).toBe(
      true,
    );
    expect(canAccess("head", { resource: "reports", action: "list" })).toBe(
      true,
    );
    expect(canAccess("manager", { resource: "reports", action: "list" })).toBe(
      false,
    );
  });

  it("shows the audit log to the owner and the head only", () => {
    expect(canAccess("owner", { resource: "audit_log", action: "list" })).toBe(
      true,
    );
    expect(canAccess("head", { resource: "audit_log", action: "list" })).toBe(
      true,
    );
    expect(
      canAccess("manager", { resource: "audit_log", action: "list" }),
    ).toBe(false);
  });

  it("lets the owner and the head merge duplicate patients", () => {
    expect(
      canAccess("owner", { resource: "duplicates", action: "merge" }),
    ).toBe(true);
    expect(canAccess("head", { resource: "duplicates", action: "merge" })).toBe(
      true,
    );
    expect(
      canAccess("manager", { resource: "duplicates", action: "merge" }),
    ).toBe(false);
  });

  it("shows the mailings to the owner and the head only", () => {
    expect(canAccess("owner", { resource: "mailings", action: "list" })).toBe(
      true,
    );
    expect(canAccess("head", { resource: "mailings", action: "list" })).toBe(
      true,
    );
    expect(canAccess("manager", { resource: "mailings", action: "list" })).toBe(
      false,
    );
  });

  it("lets the integrator configure the clinic and only read the deals", () => {
    const can = (resource: string, action: string) =>
      canAccess("integrator", { resource, action });
    expect(can("configuration", "edit")).toBe(true);
    expect(can("integrations", "list")).toBe(true);
    expect(can("deals", "list")).toBe(true);
    expect(can("deals", "show")).toBe(true);
    expect(can("deals", "menu")).toBe(true);
    expect(can("deals", "edit")).toBe(false);
    expect(can("deals", "create")).toBe(false);
    expect(can("deals", "delete")).toBe(false);
    expect(can("patients", "show")).toBe(true);
    expect(can("patients", "delete")).toBe(false);
    expect(can("patients", "menu")).toBe(false);
    for (const resource of [
      "sales",
      "reports",
      "audit_log",
      "mailings",
      "duplicates",
      "import",
      "organization",
      "tasks",
      "messages",
      "dashboard",
    ]) {
      expect(can(resource, "list")).toBe(false);
    }
  });

  it("shows the marketplace to the owner and the head only", () => {
    expect(
      canAccess("owner", { resource: "integrations", action: "list" }),
    ).toBe(true);
    expect(
      canAccess("head", { resource: "integrations", action: "list" }),
    ).toBe(true);
    expect(
      canAccess("manager", { resource: "integrations", action: "list" }),
    ).toBe(false);
    expect(canAccess("manager", { resource: "deals", action: "menu" })).toBe(
      true,
    );
  });

  it("denies everything without a role", () => {
    expect(canAccess(undefined, { resource: "deals", action: "list" })).toBe(
      false,
    );
  });
});

describe("canAccess with access rights (stage 30)", () => {
  const rights = accessMatrix("manager", {
    deals: { view: "own", edit: "own", export: "none" },
    tasks: { create: "none" },
    reports: { view: "all" },
  });

  it("follows the employee's matrix", () => {
    const can = (resource: string, action: string, record?: object) =>
      canAccess("manager", { resource, action, record }, rights, 1);
    expect(can("deals", "list")).toBe(true);
    expect(can("deals", "edit", { sales_id: 1 })).toBe(true);
    expect(can("deals", "edit", { sales_id: 2 })).toBe(false);
    expect(can("deals", "export")).toBe(false);
    expect(can("tasks", "create")).toBe(false);
    expect(can("reports", "list")).toBe(true);
    // Everything else keeps the rules of the role
    expect(can("configuration", "edit")).toBe(false);
  });

  it("never restricts the owner", () => {
    expect(
      canAccess(
        "owner",
        { resource: "deals", action: "delete" },
        accessMatrix("manager", { deals: { delete: "none" } }),
        0,
      ),
    ).toBe(true);
  });

  it("lets the owner edit rights and the head read them", () => {
    expect(
      canAccess("owner", { resource: "access_rights", action: "edit" }),
    ).toBe(true);
    expect(
      canAccess("head", { resource: "access_rights", action: "list" }),
    ).toBe(true);
    expect(
      canAccess("head", { resource: "access_rights", action: "edit" }),
    ).toBe(false);
    expect(
      canAccess("manager", { resource: "access_rights", action: "list" }),
    ).toBe(false);
  });
});
