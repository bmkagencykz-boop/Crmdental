import type { Identifier } from "ra-core";

import {
  globalSearchInMemory,
  type GlobalSearchResult,
} from "../../search/globalSearch";
import type {
  Deal,
  ExternalRef,
  Message,
  OrganizationSettings,
  Patient,
  Sale,
  Stage,
  Task,
} from "../../types";

/**
 * Global search of the demo (stage 31): the rules of public.global_search
 * (search/globalSearch.ts) with the deal visibility of the RLS policy and,
 * when given, the access rights of the employee (stage 30).
 */
export type SearchAccess = {
  filterDeals: <T extends Pick<Deal, "sales_id">>(list: T[]) => Promise<T[]>;
  filterPatients: <T extends Pick<Patient, "id" | "sales_id">>(
    list: T[],
  ) => Promise<T[]>;
  filterTasks: (list: Task[]) => Promise<Task[]>;
};

export const createSearchDemo = ({
  all,
  currentSalesId,
  getAccess,
}: {
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getAccess?: () => SearchAccess;
}) => ({
  methods: {
    async globalSearch(q: string, maxPerKind = 5): Promise<GlobalSearchResult> {
      const [patients, deals, tasks, messages, stages, sales, refs, settings] =
        await Promise.all([
          all<Patient>("patients"),
          all<Deal>("deals"),
          all<Task>("tasks"),
          all<Message>("messages"),
          all<Stage>("stages"),
          all<Sale>("sales"),
          all<ExternalRef>("external_refs").catch(() => []),
          all<OrganizationSettings>("organization_settings"),
        ]);
      const access = getAccess?.();
      const visibleDeals = access
        ? new Set(
            (await access.filterDeals(deals)).map((deal) => String(deal.id)),
          )
        : null;
      const salesId = await currentSalesId();
      const me = sales.find((sale) => String(sale.id) === String(salesId));
      const visibility = settings[0]?.manager_deal_visibility ?? "all";
      // Same as the RLS policy of deals
      const canSeeDeal = (deal: Deal) =>
        visibleDeals
          ? visibleDeals.has(String(deal.id))
          : me?.role !== "manager" ||
            visibility === "all" ||
            (deal.sales_id != null &&
              String(deal.sales_id) === String(me.id)) ||
            (visibility === "own_and_unassigned" && deal.sales_id == null);
      return globalSearchInMemory(
        {
          patients: access ? await access.filterPatients(patients) : patients,
          deals,
          tasks: access ? await access.filterTasks(tasks) : tasks,
          messages,
          stages,
          sales,
          external_refs: refs,
          canSeeDeal,
        },
        q,
        maxPerKind,
      );
    },
  },
});
