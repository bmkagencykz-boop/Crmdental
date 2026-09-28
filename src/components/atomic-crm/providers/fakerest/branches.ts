import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import {
  branchesOf,
  guessDealBranch,
  visitBranch,
  type SalesBranch,
} from "../../branches/branches";
import type { Chair, Visit } from "../../schedule/types";
import type { Deal, Doctor, Sale, Task } from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const forbidden = () =>
  Object.assign(new Error("branches.errors.forbidden"), { code: "42501" });

/**
 * Branches of the demo (stage 33): the same rules as
 * supabase/schemas/33_branches.sql — the dictionary and the employees'
 * branches written by the owner and the head, the branch of a new deal (the
 * doctor's, else the responsible's single branch), tasks following the
 * branch of their deal, a visit taking the branch of its chair or doctor,
 * and «Привязать к филиалу».
 */
export const createBranchesDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
}) => {
  const myRole = async () => {
    const id = await currentSalesId();
    // The demo's default user (no staff row) is the owner
    return (
      (await all<Sale>("sales")).find((sale) => same(sale.id, id))?.role ??
      "owner"
    );
  };
  const checkManager = async () => {
    const role = await myRole();
    if (role !== "owner" && role !== "head") throw forbidden();
  };
  const salesBranches = () => all<SalesBranch>("sales_branches");

  /** The branches the signed-in employee works in */
  const myBranchIds = async () =>
    branchesOf(await salesBranches(), await currentSalesId());

  const doctorBranch = async (doctorId: Identifier | null | undefined) =>
    doctorId == null
      ? null
      : ((await all<Doctor>("doctors")).find((d) => same(d.id, doctorId))
          ?.branch_id ?? null);

  const dealBranch = async (dealId: Identifier | null | undefined) =>
    dealId == null
      ? null
      : ((await all<Deal>("deals")).find((d) => same(d.id, dealId))
          ?.branch_id ?? null);

  const previousDeals = new Map<string, Deal>();
  const previousVisits = new Map<string, Visit>();

  const writable = (resource: string): ResourceCallbacks => ({
    resource,
    beforeCreate: async (params) => {
      await checkManager();
      return params;
    },
    beforeUpdate: async (params) => {
      await checkManager();
      return params;
    },
    beforeDelete: async (params) => {
      await checkManager();
      return params;
    },
  });

  const callbacks: ResourceCallbacks[] = [
    writable("branches"),
    writable("sales_branches"),
    {
      // Same as the policy «Owner and head can update» of the channels
      resource: "messenger_channels",
      beforeUpdate: async (params) => {
        await checkManager();
        return { ...params, data: { branch_id: params.data.branch_id } };
      },
    },
    {
      // A branch with deals, visits or tasks cannot be deleted; its doctors
      // and chairs become shared
      resource: "branches",
      beforeDelete: async (params) => {
        const used = (await all<Deal>("deals")).some((deal) =>
          same(deal.branch_id, params.id),
        );
        if (used) {
          throw Object.assign(new Error("crm.settings.errors.in_use"), {
            code: "23503",
          });
        }
        for (const resource of ["doctors", "chairs", "messenger_channels"]) {
          const rows = (
            await all<{ id: Identifier; branch_id?: Identifier | null }>(
              resource,
            )
          ).filter((row) => same(row.branch_id, params.id));
          for (const row of rows) {
            await baseDataProvider.update(resource, {
              id: row.id,
              data: { branch_id: null },
              previousData: row,
            });
          }
        }
        const links = (await salesBranches()).filter((row) =>
          same(row.branch_id, params.id),
        );
        for (const link of links) {
          await baseDataProvider.delete("sales_branches", {
            id: link.id,
            previousData: link,
          });
        }
        return params;
      },
    },
    {
      // Same as private.handle_deal_branch
      resource: "deals",
      beforeCreate: async (params) => {
        if (params.data.branch_id != null) return params;
        const responsible = params.data.sales_id ?? (await currentSalesId());
        return {
          ...params,
          data: {
            ...params.data,
            branch_id: guessDealBranch({
              doctorBranchId: await doctorBranch(params.data.doctor_id),
              responsibleBranches: branchesOf(
                await salesBranches(),
                responsible,
              ),
            }),
          },
        };
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Deal>(
          "deals",
          { id: params.id },
        );
        previousDeals.set(String(params.id), previous);
        const data = { ...params.data };
        // Choosing a doctor for a deal without a branch gives it the
        // doctor's; a branch removed by hand stays removed
        if (
          !("branch_id" in data) &&
          previous.branch_id == null &&
          "doctor_id" in data &&
          !same(data.doctor_id, previous.doctor_id)
        ) {
          const branch = await doctorBranch(data.doctor_id);
          if (branch != null) data.branch_id = branch;
        }
        return { ...params, data };
      },
      // Same as private.handle_deal_branch_changed: the tasks follow
      afterUpdate: async (result) => {
        const deal = result.data as Deal;
        const previous = previousDeals.get(String(deal.id));
        previousDeals.delete(String(deal.id));
        const unchanged =
          previous?.branch_id == null
            ? deal.branch_id == null
            : same(previous.branch_id, deal.branch_id);
        if (!previous || unchanged) return result;
        const tasks = (await all<Task>("tasks")).filter(
          (task) =>
            same(task.deal_id, deal.id) &&
            (task.branch_id ?? null) !== (deal.branch_id ?? null),
        );
        for (const task of tasks) {
          await baseDataProvider.update("tasks", {
            id: task.id,
            data: { branch_id: deal.branch_id ?? null },
            previousData: task,
          });
        }
        return result;
      },
    },
    {
      // Same as private.handle_task_branch: the branch of the task's deal
      resource: "tasks",
      beforeCreate: async (params) => ({
        ...params,
        data: {
          ...params.data,
          branch_id: await dealBranch(params.data.deal_id),
        },
      }),
      beforeUpdate: async (params) => {
        if (!("deal_id" in params.data) && !("branch_id" in params.data)) {
          return params;
        }
        const { data: previous } = await baseDataProvider.getOne<Task>(
          "tasks",
          { id: params.id },
        );
        return {
          ...params,
          data: {
            ...params.data,
            branch_id: await dealBranch(
              params.data.deal_id ?? previous.deal_id,
            ),
          },
        };
      },
    },
    {
      // Same as private.handle_visit_branch
      resource: "visits",
      beforeCreate: async (params) => {
        const chairs = await all<Chair>("chairs");
        return {
          ...params,
          data: {
            ...params.data,
            branch_id: visitBranch({
              chosen: params.data.branch_id,
              chairBranchId: chairs.find((c) =>
                same(c.id, params.data.chair_id),
              )?.branch_id,
              doctorBranchId: await doctorBranch(params.data.doctor_id),
              dealBranchId: await dealBranch(params.data.deal_id),
            }),
          },
        };
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<Visit>(
          "visits",
          { id: params.id },
        );
        previousVisits.set(String(params.id), previous);
        const next = { ...previous, ...params.data } as Visit;
        const moved =
          !same(next.chair_id, previous.chair_id) ||
          !same(next.doctor_id, previous.doctor_id) ||
          (next.chair_id == null) !== (previous.chair_id == null) ||
          (next.doctor_id == null) !== (previous.doctor_id == null);
        if ("branch_id" in params.data || !moved) return params;
        const chairs = await all<Chair>("chairs");
        return {
          ...params,
          data: {
            ...params.data,
            branch_id: visitBranch({
              chairBranchId: chairs.find((c) => same(c.id, next.chair_id))
                ?.branch_id,
              doctorBranchId: await doctorBranch(next.doctor_id),
              dealBranchId: previous.branch_id,
            }),
          },
        };
      },
    },
  ];

  const methods = {
    /** Same as public.assign_branch_to_unassigned */
    async assignBranchToUnassigned(
      branchId: Identifier,
    ): Promise<{ deals: number; visits: number }> {
      await checkManager();
      let deals = 0;
      let visits = 0;
      for (const deal of (await all<Deal>("deals")).filter(
        (d) => d.branch_id == null,
      )) {
        await baseDataProvider.update("deals", {
          id: deal.id,
          data: { branch_id: branchId },
          previousData: deal,
        });
        deals += 1;
      }
      for (const task of (await all<Task>("tasks")).filter(
        (t) => t.branch_id == null,
      )) {
        await baseDataProvider.update("tasks", {
          id: task.id,
          data: { branch_id: await dealBranch(task.deal_id) },
          previousData: task,
        });
      }
      for (const visit of (await all<Visit>("visits")).filter(
        (v) => v.branch_id == null,
      )) {
        await baseDataProvider.update("visits", {
          id: visit.id,
          data: { branch_id: branchId },
          previousData: visit,
        });
        visits += 1;
      }
      return { deals, visits };
    },
  };

  return { callbacks, methods, myBranchIds, salesBranches };
};
