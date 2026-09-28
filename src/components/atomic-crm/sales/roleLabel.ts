import type { SaleRole } from "../types";

/** Translation key of a role (the integrator of stage 25 has its own namespace) */
export const roleLabelKey = (role: SaleRole) =>
  role === "integrator" ? "market.integrator.role" : `crm.roles.${role}`;

/** End of the chosen day (DateInput value) as the end of an integrator access */
export const toAccessExpiry = (value?: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T23:59:59`).toISOString() : null;
