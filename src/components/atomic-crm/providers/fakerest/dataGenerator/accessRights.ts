import type { Db } from "./types";

/** Emails of the demo employees with narrowed rights (log in with them) */
export const DEMO_RESTRICTED_EMAIL = "reception@demo.kz";
export const DEMO_REPORTS_EMAIL = "curator@demo.kz";

/**
 * Access rights of the demo clinic (stage 30): two administrators whose
 * rights the owner changed.
 * - «Ресепшн» (reception@demo.kz): only their own deals and patients, their
 *   own tasks, no deletion, no export;
 * - «Куратор» (curator@demo.kz): the deals of the clinic but deletes none and
 *   exports only their own, and sees the reports.
 * The other employees keep the defaults of their role.
 */
export const generateAccessRights = (db: Db) => {
  const managers = db.sales.filter((sale) => sale.role === "manager");
  const [reception, curator] = managers;
  db.access_rights = [];
  const at = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  if (reception) {
    reception.email = DEMO_RESTRICTED_EMAIL;
    db.access_rights.push({
      id: reception.id,
      sales_id: reception.id,
      rights: {
        deals: { view: "own", edit: "own", delete: "none", export: "none" },
        patients: { view: "own", edit: "own", delete: "none", export: "none" },
        tasks: { view: "own", edit: "own", delete: "own", export: "none" },
      },
      updated_at: at,
      updated_by: 0,
    });
  }
  if (curator) {
    curator.email = DEMO_REPORTS_EMAIL;
    db.access_rights.push({
      id: curator.id,
      sales_id: curator.id,
      rights: {
        deals: { delete: "none", export: "own" },
        reports: { view: "all" },
      },
      updated_at: at,
      updated_by: 0,
    });
  }
};
