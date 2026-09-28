import { useQuery } from "@tanstack/react-query";
import { useDataProvider } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import type { IntegrationStatus } from "../types";
import type { MisConnectionState, MisKind } from "./types";

export const INTEGRATION_STATUS_KEY = ["integration_status"];

/**
 * Is a MIS connected? For the integrations catalog and badges: every
 * employee may ask (public.integration_status, no secrets).
 * connected: a key is stored and the connection is not switched off (a
 * failing sync keeps it connected, with status "error").
 */
export const useMisConnection = (
  kind: MisKind,
): {
  connected: boolean;
  status: MisConnectionState | null;
  isPending: boolean;
} => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data, isPending } = useQuery({
    queryKey: INTEGRATION_STATUS_KEY,
    queryFn: () => dataProvider.getIntegrationStatus(),
  });
  const row = (data ?? []).find(
    (integration: IntegrationStatus) => integration.kind === kind,
  );
  const status = (row?.status as MisConnectionState | undefined) ?? null;
  return {
    connected: status === "connected" || status === "error",
    status,
    isPending,
  };
};
