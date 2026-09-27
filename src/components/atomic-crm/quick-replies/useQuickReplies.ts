import {
  useGetIdentity,
  useGetList,
  useGetOne,
  type Identifier,
} from "ra-core";
import { useMemo } from "react";

import { useServices } from "../dictionaries/useDictionaries";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal, QuickReply, Sale } from "../types";
import {
  compareQuickReplies,
  quickReplyContext,
  type QuickReplyContext,
} from "./renderQuickReply";

const EMPTY: QuickReply[] = [];

/**
 * Replies the current employee can use: the clinic-wide ones and their own
 * (the database only returns those, see 14_quick_replies.sql).
 */
export const useQuickReplies = () => {
  const { data, isPending } = useGetList<QuickReply>(
    "quick_replies",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "position", order: "ASC" },
    },
    { staleTime: 60 * 1000 },
  );
  const sorted = useMemo(
    () => (data ? [...data].sort(compareQuickReplies) : EMPTY),
    [data],
  );
  return { data: sorted, isPending };
};

/** The current employee (first name, role) */
export const useCurrentSale = () => {
  const { identity } = useGetIdentity();
  const { data } = useGetOne<Sale>(
    "sales",
    { id: identity?.id as Identifier },
    { enabled: identity?.id != null, staleTime: 5 * 60 * 1000 },
  );
  return data;
};

/** Values of the variables for a deal: patient, service, visit, clinic, me */
export const useQuickReplyContext = (
  dealId: Identifier | undefined,
): QuickReplyContext => {
  const { data: deal } = useGetOne<Deal>(
    "deals",
    { id: dealId as Identifier },
    { enabled: dealId != null },
  );
  const { data: services } = useServices();
  const config = useConfigurationContext();
  const sale = useCurrentSale();
  const serviceName = services.find(
    (service) => service.id === deal?.service_id,
  )?.name;
  return useMemo(
    () =>
      quickReplyContext({
        deal,
        serviceName,
        clinicName: config.title,
        salesFirstName: sale?.first_name,
      }),
    [deal, serviceName, config.title, sale?.first_name],
  );
};
