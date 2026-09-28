import type { Identifier } from "ra-core";

import type {
  AccessMatrix,
  AccessOverrides,
  AccessRightsRow,
  MyAccessRights,
} from "../../access-rights/accessRights";
import { getSupabaseClient } from "./supabase";

/**
 * Access rights (stage 30): the owner's matrix per employee
 * (public.access_rights, read by the owner and the head), the rights of the
 * signed-in employee and the owner's save (public.save_access_rights).
 */
export const getAccessRightsMethods = () => ({
  async getAccessRights(): Promise<AccessRightsRow[]> {
    const { data, error } = await getSupabaseClient()
      .from("access_rights")
      .select("sales_id, rights, updated_at, updated_by");
    if (error) throw error;
    return (data ?? []) as AccessRightsRow[];
  },
  async getMyAccessRights(): Promise<MyAccessRights | null> {
    const { data, error } = await getSupabaseClient().rpc("my_access_rights");
    if (error) throw error;
    return (data ?? null) as MyAccessRights | null;
  },
  /** rights null: back to the defaults of the role; settingsAccess: head or manager */
  async saveAccessRights(
    salesId: Identifier,
    rights: AccessOverrides | null,
    settingsAccess?: boolean | null,
  ): Promise<AccessMatrix> {
    const { data, error } = await getSupabaseClient().rpc(
      "save_access_rights",
      {
        target_sales_id: salesId,
        target_rights: rights,
        settings_access: settingsAccess ?? null,
      },
    );
    if (error) throw error;
    return data as AccessMatrix;
  },
});
