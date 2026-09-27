import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { Button } from "@/components/ui/button";

import type { CrmDataProvider } from "../providers/types";
import type { IntegrationKind } from "../types";

const PLANNED: Array<Exclude<IntegrationKind, "other">> = [
  "ident",
  "dentalpro",
  "medelement",
  "1c_medicine",
];

/**
 * MIS integration (stub): the systems a connector is planned for, what it
 * will do, and a request button. The CRM keeps no doctors' schedule; the
 * connectors will fill public.integrations and public.external_refs.
 */
export const MisSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: statuses = [] } = useQuery({
    queryKey: ["integration_status"],
    queryFn: () => dataProvider.getIntegrationStatus(),
  });
  const request = useMutation({
    mutationFn: (kind: IntegrationKind) =>
      dataProvider.requestIntegration(kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration_status"] });
      notify("mis.request_sent", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid gap-3 sm:grid-cols-2">
        {PLANNED.map((kind) => {
          const requested = statuses.some((status) => status.kind === kind);
          return (
            <li
              key={kind}
              className="flex items-center justify-between gap-3 rounded-lg bg-card px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold">
                  {translate(`mis.systems.${kind}`)}
                </span>
                <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {translate("mis.soon")}
                </span>
              </div>
              {requested ? (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                  {translate("mis.requested")}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={request.isPending}
                  onClick={() => request.mutate(kind)}
                  aria-label={`${translate("mis.request")}: ${translate(`mis.systems.${kind}`)}`}
                >
                  {translate("mis.request")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground">
        {translate("mis.request_note")}
      </p>
      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">{translate("mis.how_title")}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{translate("mis.how.patients")}</li>
          <li>{translate("mis.how.visits")}</li>
          <li>{translate("mis.how.payments")}</li>
        </ul>
      </div>
    </div>
  );
};
