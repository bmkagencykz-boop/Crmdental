import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  accessDiff,
  accessMatrix,
  cleanOverrides,
  inScope,
  isConfigurable,
  type AccessEntity,
  type AccessMatrix,
  type AccessOverrides,
  type AccessRightsRow,
  type AccessScope,
  type MyAccessRights,
} from "../../access-rights/accessRights";
import type {
  AuditLogEntry,
  Deal,
  OrganizationSettings,
  Patient,
  Sale,
  Task,
} from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const forbidden = (message = "access_rights.errors.denied") =>
  Object.assign(new Error(message), { code: "42501" });

type StoredRow = AccessRightsRow & { id: Identifier };

/**
 * Access rights of the demo (stage 30): the same rules as
 * supabase/schemas/30_access_rights.sql and the policies of deals, patients
 * and tasks — reading is filtered, writes out of scope are refused, the
 * owner edits the matrix and every change is in the audit log.
 */
export const createAccessRightsDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  logAudit,
  myBranchIds = async () => [],
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  /** The branches of the signed-in employee (stage 33, «Мой филиал») */
  myBranchIds?: () => Promise<Identifier[]>;
}) => {
  const visibility = async () =>
    (await all<OrganizationSettings>("organization_settings"))[0]
      ?.manager_deal_visibility ?? "all";
  const rows = () => all<StoredRow>("access_rights");
  const me = async () => {
    const id = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, id));
  };
  const matrixOf = async (sale: Sale | undefined): Promise<AccessMatrix> => {
    const row = (await rows()).find((r) => same(r.sales_id, sale?.id));
    // The demo's default user (no staff row) is the owner
    return accessMatrix(sale?.role ?? "owner", row?.rights, await visibility());
  };
  const myRights = async () => {
    const sale = await me();
    return {
      sale,
      rights: await matrixOf(sale),
      branches: await myBranchIds(),
    };
  };

  /**
   * Same as the USING clauses: may the employee act on the row (its
   * responsible and, for «Мой филиал», its branch)
   */
  const allowed = (
    rights: AccessMatrix,
    entity: AccessEntity,
    action: "view" | "edit" | "delete",
    responsible: Identifier | null | undefined,
    salesId: Identifier | undefined,
    branch?: {
      id: Identifier | null | undefined;
      mine: Identifier[];
    },
  ) =>
    inScope(
      rights[entity][action] as AccessScope,
      responsible,
      salesId,
      branch ? { id: branch.id ?? null, mine: branch.mine } : undefined,
    );

  /** Same as the patients policy: own, of an own deal, of a visible deal */
  const patientAllowed = (
    rights: AccessMatrix,
    action: "view" | "edit" | "delete",
    patient: Pick<Patient, "id" | "sales_id">,
    deals: Deal[],
    salesId: Identifier | undefined,
  ) => {
    const scope = rights.patients[action];
    if (scope === "all") return true;
    const own =
      same(patient.sales_id, salesId) ||
      deals.some(
        (deal) =>
          same(deal.patient_id, patient.id) && same(deal.sales_id, salesId),
      );
    if (scope === "own" && own) return true;
    return (
      action === "view" &&
      deals.some(
        (deal) =>
          same(deal.patient_id, patient.id) &&
          allowed(rights, "deals", "view", deal.sales_id, salesId),
      )
    );
  };

  /** Filters of the views and lists (the select policies) */
  const filterDeals = async <T extends Pick<Deal, "sales_id" | "branch_id">>(
    list: T[],
  ) => {
    const { sale, rights, branches } = await myRights();
    return list.filter((deal) =>
      allowed(rights, "deals", "view", deal.sales_id, sale?.id, {
        id: deal.branch_id,
        mine: branches,
      }),
    );
  };
  const filterPatients = async <T extends Pick<Patient, "id" | "sales_id">>(
    list: T[],
  ) => {
    const { sale, rights } = await myRights();
    if (rights.patients.view === "all") return list;
    const deals = await all<Deal>("deals");
    return list.filter((patient) =>
      patientAllowed(rights, "view", patient, deals, sale?.id),
    );
  };
  const filterTasks = async (list: Task[]) => {
    const { sale, rights, branches } = await myRights();
    const visible = new Set(
      (await filterDeals(await all<Deal>("deals"))).map((deal) =>
        String((deal as Deal).id),
      ),
    );
    return list.filter(
      (task) =>
        visible.has(String(task.deal_id)) &&
        allowed(rights, "tasks", "view", task.sales_id, sale?.id, {
          id: task.branch_id,
          mine: branches,
        }),
    );
  };

  const findDeal = async (id: Identifier) =>
    (await all<Deal>("deals")).find((deal) => same(deal.id, id));

  const guard = (entity: AccessEntity): ResourceCallbacks => ({
    resource: entity,
    beforeCreate: async (params) => {
      const { rights } = await myRights();
      if (rights[entity].create !== "all") throw forbidden();
      if (entity === "tasks") {
        const deal = await findDeal(params.data.deal_id);
        if (!deal || (await filterDeals([deal])).length === 0) {
          throw forbidden();
        }
      }
      return params;
    },
    beforeUpdate: async (params) => {
      await check(entity, "edit", params.id);
      return params;
    },
    beforeDelete: async (params) => {
      await check(entity, "delete", params.id);
      return params;
    },
  });

  const check = async (
    entity: AccessEntity,
    action: "edit" | "delete",
    id: Identifier,
  ) => {
    const { sale, rights, branches } = await myRights();
    if (rights[entity][action] === "all") return;
    const [row] = (
      await all<{
        id: Identifier;
        sales_id?: Identifier | null;
        branch_id?: Identifier | null;
      }>(entity)
    ).filter((r) => same(r.id, id));
    if (!row) return;
    const ok =
      entity === "patients"
        ? patientAllowed(
            rights,
            action,
            row,
            await all<Deal>("deals"),
            sale?.id,
          )
        : allowed(rights, entity, action, row.sales_id, sale?.id, {
            id: row.branch_id,
            mine: branches,
          });
    if (!ok) throw forbidden();
  };

  const methods = {
    /** The matrix of the settings screen: owner and head */
    async getAccessRights(): Promise<AccessRightsRow[]> {
      const sale = await me();
      if (sale && sale.role !== "owner" && sale.role !== "head") {
        return (await rows()).filter((row) => same(row.sales_id, sale.id));
      }
      return rows();
    },
    async getMyAccessRights(): Promise<MyAccessRights | null> {
      const sale = await me();
      const row = (await rows()).find((r) => same(r.sales_id, sale?.id));
      const role = sale?.role ?? "owner";
      return {
        sales_id: sale?.id ?? 0,
        role,
        rights: accessMatrix(role, row?.rights, await visibility()),
        customized: !!row && isConfigurable(role),
        branch_ids: await myBranchIds(),
      };
    },
    /** Same as public.save_access_rights: the owner only */
    async saveAccessRights(
      salesId: Identifier,
      rights: AccessOverrides | null,
      settingsAccess?: boolean | null,
    ): Promise<AccessMatrix> {
      const caller = await me();
      if (caller && caller.role !== "owner") {
        throw forbidden("access_rights.errors.owner_only");
      }
      let target = (await all<Sale>("sales")).find((s) => same(s.id, salesId));
      if (!target) throw new Error("access_rights.errors.not_found");
      if (!isConfigurable(target.role)) {
        throw new Error("access_rights.errors.fixed");
      }
      const cleaned = rights == null ? null : cleanOverrides(rights);
      const vis = await visibility();
      const existing = (await rows()).find((r) => same(r.sales_id, salesId));
      if (
        settingsAccess != null &&
        (target.role === "head") !== settingsAccess
      ) {
        const role = settingsAccess ? "head" : "manager";
        await baseDataProvider.update("sales", {
          id: target.id,
          data: { role, administrator: settingsAccess },
          previousData: target,
        });
        await logAudit({
          entity: "employee",
          entity_id: target.id,
          action: "role_change",
          changes: { role: [target.role, role] },
        });
        target = { ...target, role };
      }
      const before = accessMatrix(target.role, existing?.rights, vis);
      const after = accessMatrix(target.role, cleaned, vis);
      if (cleaned == null) {
        if (existing) {
          await baseDataProvider.delete("access_rights", {
            id: existing.id,
            previousData: existing,
          });
        }
      } else if (existing) {
        await baseDataProvider.update("access_rights", {
          id: existing.id,
          data: {
            rights: cleaned,
            updated_at: new Date().toISOString(),
            updated_by: caller?.id ?? null,
          },
          previousData: existing,
        });
      } else {
        await baseDataProvider.create("access_rights", {
          data: {
            id: target.id,
            sales_id: target.id,
            rights: cleaned,
            updated_at: new Date().toISOString(),
            updated_by: caller?.id ?? null,
          },
        });
      }
      const changes = accessDiff(before, after);
      if (Object.keys(changes).length > 0) {
        await logAudit({
          entity: "access_rights",
          entity_id: target.id,
          action: cleaned == null ? "reset" : "update",
          changes,
        });
      }
      return after;
    },
  };

  const callbacks: ResourceCallbacks[] = [
    guard("deals"),
    guard("patients"),
    guard("tasks"),
  ];

  return {
    methods,
    callbacks,
    filterDeals,
    filterPatients,
    filterTasks,
  };
};
