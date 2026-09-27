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
 */
export const canAccess = <
  RecordType extends Record<string, any> = Record<string, any>,
>(
  role: SaleRole | undefined,
  params: CanAccessParams<RecordType>,
) => {
  if (role === "owner") {
    return true;
  }

  // Only the owner manages the staff; heads can see it (e.g. to filter deals)
  if (params.resource === "sales") {
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

  return role === "head" || role === "manager";
};
