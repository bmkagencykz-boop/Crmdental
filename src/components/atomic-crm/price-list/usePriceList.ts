import { useQueryClient } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  type Identifier,
} from "ra-core";
import { useCallback } from "react";

import type { CrmDataProvider } from "../providers/types";
import { explainError } from "../settings/useDictionaryMutations";
import type { PriceListRow, ServiceCategory } from "./types";

const EMPTY: never[] = [];
const RESOURCES = [
  "price_list",
  "services",
  "service_categories",
  "service_price_history",
  "service_costs",
];

/**
 * The data of the page «Прайс»: the services (view price_list, the cost
 * price null for those who may not see it), the category tree and the
 * rights of the employee.
 */
export const usePriceList = () => {
  const { data: rows = EMPTY as PriceListRow[], isPending: rowsPending } =
    useGetList<PriceListRow>("price_list", {
      pagination: { page: 1, perPage: 5000 },
      sort: { field: "position", order: "ASC" },
    });
  const {
    data: categories = EMPTY as ServiceCategory[],
    isPending: categoriesPending,
  } = useGetList<ServiceCategory>("service_categories", {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: "position", order: "ASC" },
  });
  const { canAccess: canEdit = false } = useCanAccess({
    resource: "price_list",
    action: "edit",
  });
  const { canAccess: canSeeCost = false } = useCanAccess({
    resource: "service_costs",
    action: "list",
  });
  return {
    rows,
    categories,
    isPending: rowsPending || categoriesPending,
    canEdit,
    canSeeCost,
  };
};

/** Writes of the page: errors of the database shown as they are */
export const usePriceListWrites = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();

  const refresh = useCallback(() => {
    for (const resource of RESOURCES) {
      queryClient.invalidateQueries({ queryKey: [resource] });
    }
  }, [queryClient]);

  const run = useCallback(
    async <T>(write: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await write();
      } catch (error) {
        notify(explainError(error), { type: "error" });
        return undefined;
      } finally {
        refresh();
      }
    },
    [notify, refresh],
  );

  return {
    dataProvider,
    refresh,
    run,
    /** Changed fields of a service (never the columns of the view) */
    updateService: (row: PriceListRow, data: Record<string, unknown>) =>
      run(() =>
        dataProvider.update("services", {
          id: row.id,
          data,
          previousData: row,
        }),
      ),
    setCost: (id: Identifier, cost: number | null) =>
      run(() => dataProvider.setServiceCost(id, cost)),
    createCategory: (data: Partial<ServiceCategory>) =>
      run(() => dataProvider.create("service_categories", { data })),
    updateCategory: (
      category: ServiceCategory,
      data: Partial<ServiceCategory>,
    ) =>
      run(() =>
        dataProvider.update("service_categories", {
          id: category.id,
          data,
          previousData: category,
        }),
      ),
    deleteCategory: (category: ServiceCategory) =>
      run(() =>
        dataProvider.delete("service_categories", {
          id: category.id,
          previousData: category,
        }),
      ),
  };
};
