import type { Identifier } from "ra-core";

import type { AppManifest, InstalledApp } from "../../integrations/types";
import { getSupabaseClient } from "./supabase";

/**
 * Marketplace (stage 25): the custom methods of the data provider. Developer
 * apps are a plain resource (developer_apps, RLS: owner, head, integrator);
 * installing, uninstalling and importing a manifest go through the database
 * functions, which create and revoke the API key and the webhooks.
 */
export const getMarketplaceMethods = () => ({
  /** The API key and the webhook secret of the app, returned once */
  async installDeveloperApp(id: Identifier): Promise<InstalledApp> {
    const { data, error } = await getSupabaseClient().rpc(
      "install_developer_app",
      { target_app_id: id },
    );
    if (error) throw error;
    return data as InstalledApp;
  },
  /** Revokes the key of the app and removes its webhooks */
  async uninstallDeveloperApp(id: Identifier): Promise<void> {
    const { error } = await getSupabaseClient().rpc("uninstall_developer_app", {
      target_app_id: id,
    });
    if (error) throw error;
  },
  /** Registers (or updates) the app of a manifest; returns its id */
  async importAppManifest(manifest: AppManifest): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc(
      "import_app_manifest",
      { manifest },
    );
    if (error) throw error;
    return data as Identifier;
  },
  /** The owner: end of the access of an integrator, «доступ к переписке» */
  async setIntegratorAccess(
    salesId: Identifier,
    expiresAt: string | null,
    readMessages: boolean,
  ): Promise<void> {
    const { error } = await getSupabaseClient().rpc("set_integrator_access", {
      target_sales_id: salesId,
      expires_at: expiresAt,
      read_messages: readMessages,
    });
    if (error) throw error;
  },
});
