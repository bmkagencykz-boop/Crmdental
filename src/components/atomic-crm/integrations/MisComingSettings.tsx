import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import type { IntegrationKind } from "../types";

/**
 * «Скоро»: a MIS connector that is not built yet, with the request button
 * (public.request_integration). TODO(stage 27, MIS connectors): the Dentist
 * Plus and MacDent entries of catalog.ts use it until their settings
 * components replace it.
 */
export const MisComingSettings = ({
  kind,
  name,
}: {
  kind: IntegrationKind;
  name: string;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: statuses = [] } = useQuery({
    queryKey: ["integration_status"],
    queryFn: () => dataProvider.getIntegrationStatus(),
  });
  const requested = statuses.some((status) => status.kind === kind);
  const request = useMutation({
    mutationFn: () => dataProvider.requestIntegration(kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration_status"] });
      notify("market.coming.request_sent", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-4 py-3"
      data-testid="mis-coming"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">
          {translate("market.coming.title")}
        </span>
        <span className="text-sm text-muted-foreground">
          {translate("market.coming.text", { name })}
        </span>
      </div>
      {requested ? (
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          {translate("market.coming.requested")}
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={request.isPending}
          onClick={() => request.mutate()}
        >
          {translate("market.coming.request")}
        </Button>
      )}
    </div>
  );
};
