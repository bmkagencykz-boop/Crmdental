import { describe, expect, it } from "vitest";
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

  it("denies everything without a role", () => {
    expect(canAccess(undefined, { resource: "deals", action: "list" })).toBe(
      false,
    );
  });
});
