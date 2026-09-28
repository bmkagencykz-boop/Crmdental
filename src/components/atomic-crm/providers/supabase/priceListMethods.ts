import type { Identifier } from "ra-core";

import type {
  BulkServiceAction,
  BulkServiceResult,
  NewService,
} from "../../price-list/types";
import { getSupabaseClient } from "./supabase";

/**
 * The price list page (stage 35): categories (service_categories), the
 * services (services, read through the view price_list) and the price
 * history (service_price_history) are plain resources; these are the bulk
 * actions, the cost price (a table only the owner and the head read) and a
 * batch insert for the import and the starter price list.
 */
export const getPriceListMethods = () => ({
  /** public.bulk_services: move, price ± % or ₸, archive, restore, delete */
  async bulkServices(
    ids: Identifier[],
    action: BulkServiceAction,
    options: { amount?: number | null; categoryId?: Identifier | null } = {},
  ): Promise<BulkServiceResult> {
    const { data, error } = await getSupabaseClient().rpc("bulk_services", {
      service_ids: ids,
      bulk_action: action,
      amount: options.amount ?? null,
      target_category_id: options.categoryId ?? null,
    });
    if (error) throw error;
    return data as BulkServiceResult;
  },
  /** «Себестоимость» of a service; null removes it (owner and head) */
  async setServiceCost(
    serviceId: Identifier,
    cost: number | null,
  ): Promise<void> {
    const { error } = await getSupabaseClient().rpc("set_service_cost", {
      target_service_id: serviceId,
      cost,
    });
    if (error) throw error;
  },
  /**
   * Several services in one request, in order (their categories are found
   * or created from the path «Раздел / Подраздел» by the database)
   */
  async createServices(rows: NewService[]): Promise<Identifier[]> {
    if (!rows.length) return [];
    const { data, error } = await getSupabaseClient()
      .from("services")
      .insert(
        rows.map((row) => ({
          ...row,
          is_archived: row.is_archived ?? false,
        })),
      )
      .select("id");
    if (error) throw error;
    return (data ?? []).map((row) => row.id as Identifier);
  },
});
