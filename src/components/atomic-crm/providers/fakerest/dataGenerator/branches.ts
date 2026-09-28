import type { Identifier } from "ra-core";

import type { Branch, SalesBranch } from "../../../branches/branches";
import { visitBranch } from "../../../branches/branches";
import type { Db } from "./types";

/** Email of the demo employee of the second branch (log in with it) */
export const DEMO_BRANCH_EMAIL = "abaya@demo.kz";

const MAIN = 1;
const ABAYA = 2;

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/**
 * Branches of the demo clinic (stage 33): the main clinic on Dostyk and
 * «Филиал на Абая» with its doctors (the orthodontist and the children's
 * dentist), its chair (the children's one), about a quarter of the deals and
 * one employee (abaya@demo.kz) who sees «Мой филиал». The Instagram
 * account brings the leads of Abaya. Runs after the schedule: the visits
 * move to the chairs of their doctor's branch.
 */
export const generateBranches = (db: Db) => {
  db.branches = [
    {
      id: MAIN,
      name: "Клиника на Достык",
      address: "Алматы, пр. Достык, 97",
      phone: "+7 727 355 00 00",
      is_active: true,
      position: 0,
    },
    {
      id: ABAYA,
      name: "Филиал на Абая",
      address: "Алматы, пр. Абая, 150",
      phone: "+7 727 355 00 11",
      is_active: true,
      position: 1,
    },
  ] satisfies Branch[];

  // Doctors and chairs
  const abayaSpecialties = ["ортодонт", "детский стоматолог"];
  db.doctors = db.doctors.map((doctor) => ({
    ...doctor,
    branch_id: abayaSpecialties.includes(doctor.specialty ?? "") ? ABAYA : MAIN,
  }));
  const abayaChair = db.chairs.find((chair) => /детск/i.test(chair.name));
  db.chairs = db.chairs.map((chair) => ({
    ...chair,
    branch_id: chair.id === abayaChair?.id ? ABAYA : MAIN,
  }));

  // Employees: the last administrator works on Abaya, with «Мой филиал»
  const managers = db.sales.filter((sale) => sale.role === "manager");
  const abayaEmployee = managers.at(-1);
  db.sales_branches = [] as SalesBranch[];
  let linkId = 1;
  for (const manager of managers) {
    db.sales_branches.push({
      id: linkId++,
      sales_id: manager.id,
      branch_id: manager === abayaEmployee ? ABAYA : MAIN,
    });
  }
  if (abayaEmployee) {
    abayaEmployee.email = DEMO_BRANCH_EMAIL;
    const at = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    db.access_rights = [
      ...(db.access_rights ?? []).filter(
        (row) => !same(row.sales_id, abayaEmployee.id),
      ),
      {
        id: abayaEmployee.id,
        sales_id: abayaEmployee.id,
        rights: {
          deals: { view: "branch", edit: "branch", export: "branch" },
          tasks: { view: "branch", edit: "branch" },
        },
        updated_at: at,
        updated_by: 0,
      },
    ];
  }

  // Deals: the doctor's branch, else the responsible's, else about a
  // quarter on Abaya
  const doctorBranch = new Map(
    db.doctors.map((doctor) => [String(doctor.id), doctor.branch_id]),
  );
  db.deals.forEach((deal) => {
    deal.branch_id =
      (deal.doctor_id != null
        ? doctorBranch.get(String(deal.doctor_id))
        : null) ??
      (abayaEmployee && same(deal.sales_id, abayaEmployee.id)
        ? ABAYA
        : Number(deal.id) % 4 === 0
          ? ABAYA
          : MAIN);
  });
  const dealBranch = new Map(
    db.deals.map((deal) => [String(deal.id), deal.branch_id ?? null]),
  );
  db.tasks.forEach((task) => {
    task.branch_id = dealBranch.get(String(task.deal_id)) ?? null;
  });

  // Visits: a doctor of Abaya takes the chair of Abaya when it is free, a
  // doctor of the main clinic leaves it
  const chairBranch = new Map(
    db.chairs.map((chair) => [String(chair.id), chair.branch_id]),
  );
  const overlaps = (
    a: { starts_at: string; ends_at: string },
    b: { starts_at: string; ends_at: string },
  ) => a.starts_at < b.ends_at && b.starts_at < a.ends_at;
  db.visits.forEach((visit) => {
    const branch =
      visit.doctor_id != null
        ? doctorBranch.get(String(visit.doctor_id))
        : null;
    if (visit.source !== "mis" && branch != null && visit.chair_id != null) {
      if (chairBranch.get(String(visit.chair_id)) !== branch) {
        const free = db.chairs.find(
          (chair) =>
            chair.branch_id === branch &&
            !db.visits.some(
              (other) =>
                other !== visit &&
                same(other.chair_id, chair.id) &&
                !["cancelled", "no_show"].includes(other.status) &&
                overlaps(other, visit),
            ),
        );
        visit.chair_id = free?.id ?? null;
      }
    }
    visit.branch_id = visitBranch({
      chairBranchId:
        visit.chair_id != null ? chairBranch.get(String(visit.chair_id)) : null,
      doctorBranchId: branch,
      dealBranchId:
        visit.deal_id != null ? dealBranch.get(String(visit.deal_id)) : null,
    });
  });

  // Channels: WhatsApp for the main clinic, Instagram for Abaya
  db.messenger_channels = db.messenger_channels.map((channel) => ({
    ...channel,
    branch_id:
      channel.transport === "whatsapp"
        ? MAIN
        : channel.transport === "instagram"
          ? ABAYA
          : null,
  }));
};
