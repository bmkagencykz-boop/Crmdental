import { useGetList, type Identifier } from "ra-core";

import type { SalesbotSession } from "./types";

/** The running session of a deal (null: no bot talks) */
export const useDealBotSession = (dealId: Identifier) => {
  const { data } = useGetList<SalesbotSession>(
    "salesbot_sessions",
    {
      filter: { deal_id: dealId, "status@in": "(running,waiting)" },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "DESC" },
    },
    { refetchInterval: 30_000 },
  );
  return data?.[0] ?? null;
};
