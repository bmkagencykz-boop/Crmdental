import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  type Identifier,
} from "ra-core";
import { useEffect } from "react";

import type { CrmDataProvider } from "../providers/types";
import type { Deal, Message } from "../types";

/** New messages arrive through the webhook: lists poll the database */
export const MESSAGES_REFRESH_MS = 15_000;

/** Messages of a deal, oldest first */
export const useDealMessages = (dealId: Identifier | undefined) =>
  useGetList<Message>(
    "messages",
    {
      filter: { deal_id: dealId },
      sort: { field: "sent_at", order: "ASC" },
      pagination: { page: 1, perPage: 500 },
    },
    { enabled: dealId != null, refetchInterval: MESSAGES_REFRESH_MS },
  );

/** Opening a deal with unread messages marks them read */
export const useMarkDealRead = (deal: Deal | undefined) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const unread = deal?.nb_unread_messages ?? 0;
  useEffect(() => {
    if (!deal || unread === 0) return;
    dataProvider
      .markDealMessagesRead(deal.id)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["deals"] });
        queryClient.invalidateQueries({ queryKey: ["messages"] });
      })
      .catch(() => undefined);
  }, [deal?.id, unread]); // eslint-disable-line react-hooks/exhaustive-deps
};

export const useSendMessage = (
  dealId: Identifier,
  automessageId?: Identifier | null,
) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const notify = useNotify();
  return useMutation({
    /** A text, or a file with an optional caption */
    mutationFn: (message: string | { text: string; file?: File | null }) =>
      typeof message === "string"
        ? dataProvider.sendMessage(dealId, message, automessageId)
        : dataProvider.sendMessage(
            dealId,
            message.text,
            automessageId,
            message.file ?? null,
          ),
    onSuccess: (_data, message) => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      if (typeof message !== "string" && message.file) {
        queryClient.invalidateQueries({ queryKey: ["deal_files"] });
      }
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      if (automessageId != null) {
        queryClient.invalidateQueries({ queryKey: ["automessages"] });
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
    onError: (error: Error) =>
      notify(error.message || "crm.messages.send_error", { type: "error" }),
  });
};
