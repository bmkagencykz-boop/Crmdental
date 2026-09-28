import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useGetList } from "ra-core";

import type { ApiKey, Webhook } from "../pipeline-automation/types";
import type { CrmDataProvider } from "../providers/types";
import type { IntegrationKind } from "../types";

/**
 * Is an integration connected? One hook per kind of entry of the catalog.
 * They share the query keys of the settings screens, so opening a screen
 * and the catalog read the same cache.
 */

export const useMessengerConnected = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data } = useQuery({
    queryKey: ["messenger_status"],
    queryFn: () => dataProvider.getMessengerStatus(),
  });
  return data?.connected;
};

export const useTelegramBotConnected = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data } = useQuery({
    queryKey: ["telegram_bot_status"],
    queryFn: () => dataProvider.getTelegramBotStatus(),
  });
  return data?.connected;
};

/** The PBX of the clinic is this provider (binotel, zadarma, sipuni...) */
export const useTelephonyConnected = (provider: string) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data } = useQuery({
    queryKey: ["telephony_status"],
    queryFn: () => dataProvider.getTelephonyStatus(),
  });
  return data === undefined ? undefined : data?.provider === provider;
};

/** A MIS connector runs for the clinic */
export const useMisConnected = (kind: IntegrationKind) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data } = useQuery({
    queryKey: ["integration_status"],
    queryFn: () => dataProvider.getIntegrationStatus(),
  });
  return data?.some(
    (status) => status.kind === kind && status.status === "connected",
  );
};

/** Website forms: at least one lead came through the webhook */
export const useLeadsConnected = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data } = useQuery({
    queryKey: ["lead_submissions", "any"],
    queryFn: async () => {
      try {
        const { total } = await dataProvider.getList("lead_submissions", {
          pagination: { page: 1, perPage: 1 },
          sort: { field: "id", order: "DESC" },
          filter: {},
        });
        return (total ?? 0) > 0;
      } catch {
        return false;
      }
    },
  });
  return data;
};

/** The clinic's own API keys or webhooks (not those of the apps) */
export const useApiConnected = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: keys } = useQuery({
    queryKey: ["api_keys"],
    queryFn: () => dataProvider.listApiKeys(),
  });
  const { data: webhooks } = useGetList<Webhook>("webhooks", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  if (keys === undefined && webhooks === undefined) return undefined;
  return (
    (keys ?? []).some((key: ApiKey) => !key.revoked_at && key.app_id == null) ||
    (webhooks ?? []).some((webhook) => webhook.is_active && !webhook.app_id)
  );
};

export const useNeverConnected = () => false;
