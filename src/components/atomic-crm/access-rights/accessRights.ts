import type { Identifier } from "ra-core";

import type { OrganizationSettings, SaleRole } from "../types";

/**
 * Access rights (stage 30), twin of supabase/schemas/30_access_rights.sql.
 *
 * A matrix per employee: for deals, patients and tasks the actions view,
 * create, edit, delete and export, each with a scope; reports as a single
 * toggle. Every employee has the defaults of their role (the rules before
 * this stage); the owner changes cells per employee (overrides). The owner
 * always has everything, the integrator has the fixed rules of stage 25.
 */

export const ACCESS_ENTITIES = ["deals", "patients", "tasks"] as const;
export type AccessEntity = (typeof ACCESS_ENTITIES)[number];
export const ACCESS_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type AccessScope = "all" | "own_and_unassigned" | "own" | "none";
/** The cells of the matrix: the three entities, and the reports toggle */
export type AccessCell =
  | { entity: AccessEntity; action: AccessAction }
  | { entity: "reports"; action: "view" };

export type AccessMatrix = Record<
  AccessEntity,
  Record<AccessAction, AccessScope>
> & {
  reports: { view: AccessScope };
};
/** Cells the owner changed: { deals: { view: "own" }, reports: { view: "all" } } */
export type AccessOverrides = Partial<
  Record<AccessEntity | "reports", Partial<Record<AccessAction, AccessScope>>>
>;

/** A row of public.access_rights */
export type AccessRightsRow = {
  sales_id: Identifier;
  rights: AccessOverrides;
  updated_at?: string;
  updated_by?: Identifier | null;
};

/** The rights of the signed-in employee (public.my_access_rights) */
export type MyAccessRights = {
  sales_id: Identifier;
  role: SaleRole;
  rights: AccessMatrix;
  customized: boolean;
};

type Visibility = OrganizationSettings["manager_deal_visibility"];

/** Scopes a cell accepts, null for an unknown one (private.access_scopes) */
export const accessScopes = (
  entity: string,
  action: string,
): AccessScope[] | null => {
  if (entity === "reports") return action === "view" ? ["all", "none"] : null;
  if (
    !ACCESS_ENTITIES.includes(entity as AccessEntity) ||
    !ACCESS_ACTIONS.includes(action as AccessAction)
  ) {
    return null;
  }
  if (action === "create") return ["all", "none"];
  if (entity === "deals") return ["all", "own_and_unassigned", "own", "none"];
  return ["all", "own", "none"];
};

/** The rules of the roles: the default of a cell (private.access_default) */
export const accessDefault = (
  role: SaleRole | undefined | null,
  entity: string,
  action: string,
  visibility: Visibility = "all",
): AccessScope => {
  if (!role || accessScopes(entity, action) == null) return "none";
  if (role === "owner" || role === "head") return "all";
  if (role === "integrator") {
    return action === "view" && entity !== "reports" ? "all" : "none";
  }
  if (entity === "reports" || (entity === "deals" && action === "delete")) {
    return "none";
  }
  if (entity === "deals" && (action === "view" || action === "edit")) {
    return visibility;
  }
  return "all";
};

/** The scope of a cell: the owner's choice, else the role's default */
export const accessResolve = (
  role: SaleRole | undefined | null,
  overrides: AccessOverrides | null | undefined,
  entity: string,
  action: string,
  visibility: Visibility = "all",
): AccessScope => {
  if (role === "head" || role === "manager") {
    const chosen = (
      overrides?.[entity as AccessEntity] as
        | Partial<Record<string, AccessScope>>
        | undefined
    )?.[action];
    if (chosen && accessScopes(entity, action)?.includes(chosen)) {
      return chosen;
    }
  }
  return accessDefault(role, entity, action, visibility);
};

/** The whole matrix of an employee (private.access_matrix) */
export const accessMatrix = (
  role: SaleRole | undefined | null,
  overrides?: AccessOverrides | null,
  visibility: Visibility = "all",
): AccessMatrix => {
  const row = (entity: AccessEntity) =>
    Object.fromEntries(
      ACCESS_ACTIONS.map((action) => [
        action,
        accessResolve(role, overrides, entity, action, visibility),
      ]),
    ) as Record<AccessAction, AccessScope>;
  return {
    deals: row("deals"),
    patients: row("patients"),
    tasks: row("tasks"),
    reports: {
      view: accessResolve(role, overrides, "reports", "view", visibility),
    },
  };
};

/** Presets of the settings screen: the defaults of a role, as overrides */
export const accessPreset = (
  role: "head" | "manager",
  visibility: Visibility = "all",
): AccessOverrides => accessMatrix(role, null, visibility);

/**
 * What the settings screen saves: the cells of an edited matrix that differ
 * from the role's defaults (null: none, the employee keeps the role's
 * rights). Untouched cells keep following the role and the clinic setting.
 */
export const overridesFromMatrix = (
  role: "head" | "manager",
  matrix: AccessMatrix,
  visibility: Visibility = "all",
): AccessOverrides | null => {
  const defaults = accessMatrix(role, null, visibility);
  const overrides: AccessOverrides = {};
  for (const entity of [...ACCESS_ENTITIES, "reports"] as const) {
    const cells = matrix[entity] as Record<string, AccessScope>;
    for (const action of Object.keys(cells)) {
      if (
        (defaults[entity] as Record<string, AccessScope>)[action] !==
        cells[action]
      ) {
        overrides[entity] = { ...overrides[entity], [action]: cells[action] };
      }
    }
  }
  return Object.keys(overrides).length ? overrides : null;
};

/** Whether the rights of an employee can be edited (not the owner's) */
export const isConfigurable = (role: SaleRole | undefined | null) =>
  role === "head" || role === "manager";

/** The cells of `after` that differ from `before` (the audit log format) */
export const accessDiff = (
  before: AccessMatrix,
  after: AccessMatrix,
): Record<string, [AccessScope, AccessScope]> => {
  const diff: Record<string, [AccessScope, AccessScope]> = {};
  for (const entity of [...ACCESS_ENTITIES, "reports"] as const) {
    const cells = after[entity] as Record<string, AccessScope>;
    for (const action of Object.keys(cells)) {
      const was = (before[entity] as Record<string, AccessScope>)[action];
      if (was !== cells[action])
        diff[`${entity}.${action}`] = [was, cells[action]];
    }
  }
  return diff;
};

/**
 * Checks the cells of a save (public.save_access_rights): only known cells
 * with an accepted scope. Returns the cleaned overrides.
 */
export const cleanOverrides = (rights: unknown): AccessOverrides => {
  if (rights == null || typeof rights !== "object" || Array.isArray(rights)) {
    throw new Error("access_rights.errors.invalid");
  }
  const cleaned: AccessOverrides = {};
  for (const [entity, cells] of Object.entries(rights)) {
    if (cells == null || typeof cells !== "object" || Array.isArray(cells)) {
      throw new Error("access_rights.errors.invalid");
    }
    for (const [action, scope] of Object.entries(cells)) {
      if (!accessScopes(entity, action)?.includes(scope as AccessScope)) {
        throw new Error("access_rights.errors.invalid");
      }
      const key = entity as AccessEntity;
      cleaned[key] = { ...cleaned[key], [action]: scope };
    }
  }
  return cleaned;
};

/**
 * Whether a row with this responsible is in a scope for the employee `me`
 * (the USING clauses of the policies). Patients: the server also counts
 * the patients of the employee's deals, the interface cannot: «own» lets
 * the action through and the database decides.
 */
export const inScope = (
  scope: AccessScope,
  responsibleId: Identifier | null | undefined,
  me: Identifier | null | undefined,
) => {
  if (scope === "all") return true;
  if (scope === "none") return false;
  const mine =
    responsibleId != null && me != null && String(responsibleId) === String(me);
  return mine || (scope === "own_and_unassigned" && responsibleId == null);
};

const RESOURCE_ENTITY: Record<string, AccessEntity> = {
  deals: "deals",
  deals_summary: "deals",
  patients: "patients",
  patients_summary: "patients",
  tasks: "tasks",
};

/**
 * The UI side of a matrix: may the employee do a ra-core action on a
 * resource (list, show, menu → view; create; edit; delete; export). With a
 * record, the scope is checked against its responsible. Returns undefined
 * for a resource the matrix does not cover.
 */
export const rightsAllow = (
  rights: AccessMatrix,
  resource: string,
  action: string,
  record?: { sales_id?: Identifier | null } | null,
  me?: Identifier | null,
): boolean | undefined => {
  if (resource === "reports") {
    return rights.reports.view === "all";
  }
  const entity = RESOURCE_ENTITY[resource];
  if (!entity) return undefined;
  const cells = rights[entity];
  const checked = (scope: AccessScope) => {
    if (scope === "none") return false;
    if (!record || entity === "patients") return true;
    return inScope(scope, record.sales_id, me);
  };
  switch (action) {
    case "list":
    case "menu":
      return cells.view !== "none";
    case "show":
      // The patient of a visible deal is always visible: the server decides
      return entity === "patients" ? true : checked(cells.view);
    case "create":
    case "clone":
      return cells.create === "all";
    case "edit":
      return checked(cells.edit);
    case "delete":
      return checked(cells.delete);
    case "export":
      return cells.export !== "none";
    default:
      return undefined;
  }
};

/**
 * The rows an employee may export: all of them, or only their own
 * (client-side CSV of what they see; the export scope «own»).
 */
export const exportableRows = <T extends { sales_id?: Identifier | null }>(
  rows: T[],
  scope: AccessScope,
  me: Identifier | null | undefined,
): T[] => {
  if (scope === "all") return rows;
  // Patients «own»: the responsible only (their deals are not loaded here)
  return rows.filter((row) => inScope(scope, row.sales_id, me));
};
