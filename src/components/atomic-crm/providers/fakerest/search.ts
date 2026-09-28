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
 * (search/globalSearch.ts) with the deal visibility of the RLS policy.
 */
export const createSearchDemo = ({
  all,
  currentSalesId,
}: {
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
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
      const salesId = await currentSalesId();
      const me = sales.find((sale) => String(sale.id) === String(salesId));
      const visibility = settings[0]?.manager_deal_visibility ?? "all";
      // Same as the RLS policy of deals
      const canSeeDeal = (deal: Deal) =>
        me?.role !== "manager" ||
        visibility === "all" ||
        (deal.sales_id != null && String(deal.sales_id) === String(me.id)) ||
        (visibility === "own_and_unassigned" && deal.sales_id == null);
      return globalSearchInMemory(
        {
          patients,
          deals,
          tasks,
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
