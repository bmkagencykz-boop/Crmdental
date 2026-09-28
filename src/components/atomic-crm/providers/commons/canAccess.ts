import type { Identifier } from "ra-core";

import {
  rightsAllow,
  type AccessMatrix,
} from "../../access-rights/accessRights";
import type { SaleRole } from "../../types";

// FIXME: This should be exported from the ra-core package
type CanAccessParams<
  RecordType extends Record<string, any> = Record<string, any>,
> = {
  action: string;
  resource: string;
  record?: RecordType;
};

/**
 * UI access rules per role. The database enforces the same rules through RLS
 * and the users edge function; this only hides what a role cannot use.
 *
 * - owner: everything, including staff management
 * - head: everything but staff management (can list the staff)
 * - manager: day-to-day work, no settings, no reports
 * - integrator (stage 25): the settings and the integrations; deals and
 *   patients read-only; no reports, staff, audit, mailings, import
 *
 * The action "menu" asks whether a section appears in the sidebar.
 *
 * Access rights (stage 30): for a head or a manager, the deals, patients,
 * tasks, their export and the reports follow the employee's matrix
 * (`rights`, from public.my_access_rights) when it is given; `me` is the
 * employee's id, to check the scope «own» against a record; `myBranches`
 * the branches they work in, for «Мой филиал» (stage 33).
 */
export const canAccess = <
  RecordType extends Record<string, any> = Record<string, any>,
>(
  role: SaleRole | undefined,
  params: CanAccessParams<RecordType>,
  rights?: AccessMatrix | null,
  me?: Identifier | null,
  myBranches?: Identifier[] | null,
) => {
  if (role === "owner") {
    return true;
  }

  if (role === "integrator") {
    return integratorCanAccess(params);
  }

  if (rights && (role === "head" || role === "manager")) {
    const allowed = rightsAllow(
      rights,
      params.resource,
      params.action,
      params.record,
      me,
      myBranches,
    );
    if (allowed !== undefined) return allowed;
  }

  // Marketplace of integrations (stage 25): owner, head (and integrator)
  if (params.resource === "integrations") {
    return role === "head";
  }

  // Clinic profile and data import write the clinic's data: owner and head
  if (params.resource === "organization" || params.resource === "import") {
    return role === "head";
  }

  // Only the owner manages the staff; heads can see it (e.g. to filter deals)
  if (params.resource === "sales") {
    return role === "head" && ["list", "show"].includes(params.action);
  }

  // Branches (stage 33): the owner and the head manage the dictionary
  if (params.resource === "branches") {
    return role === "head" || ["list", "show"].includes(params.action);
  }

  // Access rights (stage 30): the owner edits them, the head reads them
  if (params.resource === "access_rights") {
    return role === "head" && ["list", "show"].includes(params.action);
  }

  if (params.resource === "configuration") {
    return role === "head";
  }

  // Reports (spec §7) are for the owner and the head; the database refuses
  // the report functions to anybody else
  if (params.resource === "reports") {
    return role === "head";
  }

  // The audit log (stage 15) too; RLS gives nobody else a row
  if (params.resource === "audit_log") {
    return role === "head";
  }

  // Segment mailings (stage 17): owner and head, like the database
  if (params.resource === "mailings") {
    return role === "head";
  }

  // Deleting a visit of the schedule (stage 28): owner and head, like the
  // database; everybody else marks it cancelled
  if (params.resource === "visits" && params.action === "delete") {
    return role === "head";
  }

  // Merging duplicate patients (stage 18): owner and head, like the database
  if (params.resource === "duplicates") {
    return role === "head";
  }

  return role === "head" || role === "manager";
};

/**
 * Technical account of an agency: configures the clinic (the database
 * grants the same through RLS, see 25_marketplace.sql), only reads the
 * deals and the patients, and only sees Сделки, Интеграции and Настройки.
 */
const integratorCanAccess = ({ resource, action }: CanAccessParams) => {
  if (resource === "configuration" || resource === "integrations") {
    return true;
  }
  if (resource === "deals") {
    return ["list", "show", "menu"].includes(action);
  }
  if (resource === "patients") {
    return ["list", "show"].includes(action);
  }
  return false;
};
