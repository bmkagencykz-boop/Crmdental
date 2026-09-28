import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useNotify, useTranslate } from "ra-core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DentistPlusSettings } from "../mis/DentistPlusSettings";
import { MacDentSettings } from "../mis/MacDentSettings";
import { MIS_KINDS } from "../mis/misConnectors";
import type { MisKind } from "../mis/types";
import { INTEGRATION_STATUS_KEY } from "../mis/useMisConnection";
import type { CrmDataProvider } from "../providers/types";
import type { IntegrationKind, IntegrationStatus } from "../types";

// Connectors still to come: the clinic leaves a request
const PLANNED: Array<Exclude<IntegrationKind, "other" | MisKind>> = [
  "ident",
  "dentalpro",
  "medelement",
  "1c_medicine",
];

const SETTINGS: Record<MisKind, () => React.ReactNode> = {
  dentist_plus: () => <DentistPlusSettings />,
  macdent: () => <MacDentSettings />,
};

/**
 * Settings → Интеграция с МИС: the working connectors (Dentist Plus,
 * MacDent) with their settings, and the systems a connector is planned for
 * («скоро», with a request button). The CRM keeps no doctors' schedule.
 */
export const MisSettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: statuses = [] } = useQuery({
    queryKey: INTEGRATION_STATUS_KEY,
    queryFn: () => dataProvider.getIntegrationStatus(),
  });
  const statusOf = (kind: IntegrationKind) =>
    statuses.find((status: IntegrationStatus) => status.kind === kind)?.status;
  // null: the connected connector is open; "none": all closed by hand
  const [open, setOpen] = useState<MisKind | "none" | null>(null);
  const shown =
    open === null
      ? (MIS_KINDS.find((kind) =>
          ["connected", "error"].includes(statusOf(kind) ?? ""),
        ) ?? null)
      : open === "none"
        ? null
        : open;
  const request = useMutation({
    mutationFn: (kind: IntegrationKind) =>
      dataProvider.requestIntegration(kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_STATUS_KEY });
      notify("mis.request_sent", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-2">
        {MIS_KINDS.map((kind) => {
          const status = statusOf(kind);
          const expanded = shown === kind;
          const connected = status === "connected" || status === "error";
          return (
            <li key={kind} className="rounded-lg bg-card">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {translate(`mis_connectors.name.${kind}`)}
                  </span>
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs",
                      connected
                        ? status === "error"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {translate(
                      `mis_connectors.status.${connected ? status : status === "disabled" ? "disabled" : "none"}`,
                    )}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant={expanded ? "ghost" : "outline"}
                  onClick={() => setOpen(expanded ? "none" : kind)}
                  aria-expanded={expanded}
                  aria-label={`${translate(expanded ? "mis_connectors.settings.hide" : "mis_connectors.settings.open")}: ${translate(`mis_connectors.name.${kind}`)}`}
                >
                  {translate(
                    expanded
                      ? "mis_connectors.settings.hide"
                      : connected
                        ? "mis_connectors.settings.open"
                        : "mis_connectors.settings.connect",
                  )}
                </Button>
              </div>
              {expanded ? (
                <div className="border-t border-border px-4 py-5">
                  {SETTINGS[kind]()}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">
          {translate("mis_connectors.settings.planned")}
        </h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {PLANNED.map((kind) => {
            const requested = statuses.some(
              (status: IntegrationStatus) => status.kind === kind,
            );
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
                  <span className="text-sm text-muted-foreground">
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
      </div>
    </div>
  );
};
