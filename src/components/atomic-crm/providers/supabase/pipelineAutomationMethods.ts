import type { Identifier } from "ra-core";

import { functionsBaseUrl } from "../../leads/leadWebhook";
import type {
  ApiKey,
  ApiKeyScope,
  CreatedApiKey,
} from "../../pipeline-automation/types";
import { getSupabaseClient } from "./supabase";

/**
 * Webhooks and API keys (stage 20): the custom methods of the data provider.
 * Triggers, runs, webhooks and deliveries are plain resources (RLS: owner and
 * head for the webhooks); the key hash is never read, keys are created and
 * revoked through the database functions.
 */
export const getPipelineAutomationMethods = () => ({
  /** Address of the public API of the clinic */
  async getApiBaseUrl(): Promise<string> {
    return `${functionsBaseUrl(
      import.meta.env.VITE_SUPABASE_URL ?? "",
      import.meta.env.VITE_WEBHOOK_BASE_URL,
    )}/api`;
  },
  async listApiKeys(): Promise<ApiKey[]> {
    const { data, error } = await getSupabaseClient()
      .from("api_keys")
      .select(
        "id, name, prefix, scope, created_by, created_at, last_used_at, revoked_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ApiKey[];
  },
  /** The key is returned once: only its hash is stored */
  async createApiKey(name: string, scope: ApiKeyScope): Promise<CreatedApiKey> {
    const { data, error } = await getSupabaseClient().rpc("create_api_key", {
      key_name: name,
      key_scope: scope,
    });
    if (error) throw error;
    return data as CreatedApiKey;
  },
  async revokeApiKey(id: Identifier): Promise<void> {
    const { error } = await getSupabaseClient().rpc("revoke_api_key", {
      key_id: id,
    });
    if (error) throw error;
  },
  async sendTestWebhook(id: Identifier): Promise<void> {
    const { error } = await getSupabaseClient().rpc("send_test_webhook", {
      target_webhook_id: id,
    });
    if (error) throw error;
  },
  async regenerateWebhookSecret(id: Identifier): Promise<string> {
    const { data, error } = await getSupabaseClient().rpc(
      "regenerate_webhook_secret",
      { target_webhook_id: id },
    );
    if (error) throw error;
    return data as string;
  },
});
