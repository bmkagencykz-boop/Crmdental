import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCanAccess,
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import {
  useDoctors,
  usePipelines,
  useStages,
} from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import type { Tag } from "../types";
import {
  DEFAULT_BASE_URLS,
  isMisConnected,
  logOperationKey,
  logResultKey,
  mappableStages,
  MIS_STATUSES,
  targetValue,
  withTarget,
} from "./misConnectors";
import { INTEGRATION_STATUS_KEY } from "./useMisConnection";
import type {
  MisActionResult,
  MisConnection,
  MisConnectionPatch,
  MisDoctor,
  MisKind,
  MisStatus,
  MisSyncLogEntry,
} from "./types";

const dateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const NONE = "none";

/**
 * Settings of one MIS connector (Dentist Plus or MacDent): key and address,
 * test and manual sync, sync directions, mapping of the MIS statuses to the
 * stages, doctors, the webhook address and the sync log. Owner and head
 * (canAccess configuration edit); the database checks the same.
 * Standalone: the integrations catalog renders it as is.
 */
export const MisConnectorSettings = ({ kind }: { kind: MisKind }) => {
  const translate = useTranslate();
  const { canAccess, isPending: accessPending } = useCanAccess({
    resource: "configuration",
    action: "edit",
  });
  if (accessPending) return null;
  if (!canAccess) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("mis_connectors.access_denied")}
      </p>
    );
  }
  return <ConnectorSettings kind={kind} />;
};

const ConnectorSettings = ({ kind }: { kind: MisKind }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const queryKey = ["mis_connection", kind];
  const { data: connection, isPending } = useQuery({
    queryKey,
    queryFn: () => dataProvider.getMisConnection(kind),
  });
  const logQuery = useGetList<MisSyncLogEntry>("mis_sync_log", {
    filter: { kind },
    sort: { field: "created_at", order: "DESC" },
    pagination: { page: 1, perPage: 50 },
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [lastResult, setLastResult] = useState<MisActionResult | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => {
    setBaseUrl(connection?.base_url ?? "");
  }, [connection?.base_url]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: INTEGRATION_STATUS_KEY });
    logQuery.refetch();
  };
  const onError = (error: Error) =>
    notify(error.message || "mis_connectors.connection.save_error", {
      type: "error",
    });

  const save = useMutation({
    mutationFn: (patch: MisConnectionPatch) =>
      dataProvider.saveMisConnection(kind, patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      refresh();
    },
    onError,
  });
  const saveConnection = () =>
    save.mutate(
      {
        base_url: baseUrl.trim() || null,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      },
      {
        onSuccess: () => {
          setApiKey("");
          notify("mis_connectors.connection.saved", { type: "info" });
        },
      },
    );
  const action = (run: () => Promise<MisActionResult>) => ({
    mutationFn: run,
    onSuccess: (result: MisActionResult) => {
      setLastResult(result);
      refresh();
      for (const key of ["deals", "patients", "mis_appointments"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError,
  });
  const test = useMutation(action(() => dataProvider.testMisConnection(kind)));
  const sync = useMutation(action(() => dataProvider.syncMisNow(kind)));
  const disconnect = useMutation({
    mutationFn: () => dataProvider.disconnectMis(kind),
    onSuccess: () => {
      setConfirmDisconnect(false);
      setLastResult(null);
      refresh();
      notify("mis_connectors.connection.disconnected", { type: "info" });
    },
    onError,
  });

  if (isPending) return null;
  const connected = isMisConnected(connection);
  const name = translate(`mis_connectors.name.${kind}`);

  return (
    <div className="flex flex-col gap-7" data-testid={`mis-settings-${kind}`}>
      <StatusLine connection={connection ?? null} />

      <VendorNotice kind={kind} />

      <Section title={translate("mis_connectors.connection.title")}>
        <div className="flex max-w-xl flex-col gap-4">
          <Field
            id={`mis-${kind}-url`}
            label={translate("mis_connectors.connection.base_url")}
            help={translate("mis_connectors.connection.base_url_help", {
              url: DEFAULT_BASE_URLS[kind],
            })}
          >
            <Input
              id={`mis-${kind}-url`}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={DEFAULT_BASE_URLS[kind]}
              className="font-mono text-xs"
            />
          </Field>
          <Field
            id={`mis-${kind}-key`}
            label={translate("mis_connectors.connection.api_key")}
            help={translate(`mis_connectors.connection.api_key_help.${kind}`)}
          >
            <Input
              id={`mis-${kind}-key`}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={translate(
                connection?.has_api_key
                  ? "mis_connectors.connection.api_key_stored"
                  : "mis_connectors.connection.api_key_placeholder",
              )}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConnection} disabled={save.isPending}>
              {translate(
                connected
                  ? "mis_connectors.connection.save"
                  : "mis_connectors.connection.connect",
              )}
            </Button>
            {connection?.has_api_key ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => test.mutate()}
                  disabled={test.isPending}
                >
                  {translate("mis_connectors.connection.test")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sync.mutate()}
                  disabled={sync.isPending || !connected}
                >
                  {translate("mis_connectors.connection.sync")}
                </Button>
              </>
            ) : null}
          </div>
          {lastResult ? (
            <p
              role="status"
              className={cn(
                "rounded-md px-3 py-2 text-sm",
                lastResult.ok
                  ? "bg-muted text-foreground"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {lastResult.message}
            </p>
          ) : null}
        </div>
      </Section>

      {connection ? (
        <>
          <Directions
            connection={connection}
            onChange={(patch) => save.mutate(patch)}
            disabled={save.isPending}
          />
          <StatusMapping
            connection={connection}
            onChange={(status_map) => save.mutate({ status_map })}
            disabled={save.isPending}
          />
          <DoctorMapping kind={kind} />
          {connection.webhook_url ? (
            <WebhookAddress kind={kind} url={connection.webhook_url} />
          ) : null}
        </>
      ) : null}

      <SyncLog entries={logQuery.data ?? []} isPending={logQuery.isPending} />

      {connected ? (
        <div>
          <Button
            variant="outline"
            onClick={() => setConfirmDisconnect(true)}
            disabled={disconnect.isPending}
          >
            {translate("mis_connectors.connection.disconnect")}
          </Button>
          <Confirm
            isOpen={confirmDisconnect}
            title={translate("mis_connectors.connection.disconnect_title", {
              name,
            })}
            content={translate("mis_connectors.connection.disconnect_content")}
            confirm="mis_connectors.connection.disconnect"
            confirmColor="warning"
            loading={disconnect.isPending}
            onConfirm={() => disconnect.mutate()}
            onClose={() => setConfirmDisconnect(false)}
          />
        </div>
      ) : null}
    </div>
  );
};

const Section = ({
  title,
  help,
  children,
}: {
  title: string;
  help?: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {help ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
      ) : null}
    </div>
    {children}
  </section>
);

const Field = ({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-medium">
      {label}
    </label>
    {children}
    <p className="text-xs text-muted-foreground">{help}</p>
  </div>
);

/** «Подключено · синхронизация 12.10 09:30» or the last error */
const StatusLine = ({ connection }: { connection: MisConnection | null }) => {
  const translate = useTranslate();
  const status = connection?.status ?? "requested";
  const shown =
    status === "requested" && !connection?.has_api_key ? "none" : status;
  return (
    <div className="flex flex-col gap-1" data-testid="mis-status">
      <p className="text-sm">
        <span
          className={cn(
            "mr-2 rounded-md px-2 py-0.5 text-xs font-semibold",
            status === "connected"
              ? "bg-primary text-primary-foreground"
              : status === "error"
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground",
          )}
        >
          {translate(`mis_connectors.status.${shown}`)}
        </span>
        <span className="text-muted-foreground">
          {connection?.last_sync_at
            ? translate("mis_connectors.last_sync", {
                date: dateTime(connection.last_sync_at),
              })
            : isMisConnected(connection)
              ? translate("mis_connectors.never_synced")
              : ""}
        </span>
      </p>
      {status === "error" && connection?.last_error ? (
        <p className="text-sm text-destructive">{connection.last_error}</p>
      ) : null}
    </div>
  );
};

/** What still needs the vendor's API documentation */
const VendorNotice = ({ kind }: { kind: MisKind }) => {
  const translate = useTranslate();
  return (
    <section className="flex max-w-3xl flex-col gap-2 rounded-md border border-border px-4 py-3">
      <h3 className="text-sm font-semibold">
        {translate("mis_connectors.notice.title")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {translate(`mis_connectors.notice.intro.${kind}`)}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {translate("mis_connectors.notice.items")
          .split("\n")
          .map((item) => (
            <li key={item}>{item}</li>
          ))}
      </ul>
    </section>
  );
};

const DIRECTIONS = [
  "sync_patients",
  "sync_appointments",
  "sync_payments",
  "push_appointments",
] as const;

const Directions = ({
  connection,
  onChange,
  disabled,
}: {
  connection: MisConnection;
  onChange: (patch: MisConnectionPatch) => void;
  disabled: boolean;
}) => {
  const translate = useTranslate();
  return (
    <Section title={translate("mis_connectors.directions.title")}>
      <ul className="flex max-w-3xl flex-col divide-y divide-border rounded-md bg-card">
        {DIRECTIONS.map((field) => (
          <li key={field} className="flex items-start gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`mis-${connection.kind}-${field}`}
                className="text-sm font-medium"
              >
                {translate(`mis_connectors.directions.${field}`)}
              </label>
              <p className="text-xs text-muted-foreground">
                {translate(`mis_connectors.directions.${field}_help`)}
              </p>
            </div>
            <Switch
              id={`mis-${connection.kind}-${field}`}
              checked={connection[field]}
              disabled={disabled}
              onCheckedChange={(checked) => onChange({ [field]: checked })}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
};

/** MIS status → stage (or tag) of the deal */
const StatusMapping = ({
  connection,
  onChange,
  disabled,
}: {
  connection: MisConnection;
  onChange: (map: MisConnection["status_map"]) => void;
  disabled: boolean;
}) => {
  const translate = useTranslate();
  const { data: stages } = useStages();
  const { data: pipelines } = usePipelines();
  const { data: tags = [] } = useGetList<Tag>("tags", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "name", order: "ASC" },
  });
  const choices = mappableStages(stages);
  const pipelineName = (id: Identifier) =>
    pipelines.find((pipeline) => String(pipeline.id) === String(id))?.name ??
    "";
  const pipelineIds = [...new Set(choices.map((stage) => stage.pipeline_id))];

  return (
    <Section
      title={translate("mis_connectors.mapping.title")}
      help={translate("mis_connectors.mapping.help")}
    >
      <table className="w-full max-w-3xl text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-4 font-medium">
              {translate("mis_connectors.mapping.mis_status")}
            </th>
            <th className="py-1.5 font-medium">
              {translate("mis_connectors.mapping.action")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {MIS_STATUSES.map((status: MisStatus) => {
            const label = translate(`mis_connectors.statuses.${status}`);
            const value = targetValue(connection.status_map[status]);
            return (
              <tr key={status}>
                <td className="py-2 pr-4 align-middle">
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {translate(`mis_connectors.mapping.hints.${status}`)}
                  </span>
                </td>
                <td className="py-2 align-middle">
                  <Select
                    value={value || NONE}
                    disabled={disabled}
                    onValueChange={(next) =>
                      onChange(
                        withTarget(
                          connection.status_map,
                          status,
                          next === NONE ? "" : next,
                        ),
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-72"
                      aria-label={`${translate("mis_connectors.mapping.action")}: ${label}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        {translate("mis_connectors.mapping.none")}
                      </SelectItem>
                      {pipelineIds.map((pipelineId) => (
                        <SelectGroup key={String(pipelineId)}>
                          <SelectLabel>
                            {translate("mis_connectors.mapping.stages", {
                              pipeline: pipelineName(pipelineId),
                            })}
                          </SelectLabel>
                          {choices
                            .filter(
                              (stage) =>
                                String(stage.pipeline_id) ===
                                String(pipelineId),
                            )
                            .map((stage) => (
                              <SelectItem
                                key={stage.id}
                                value={`stage:${stage.id}`}
                              >
                                {stage.name}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ))}
                      {tags.length ? (
                        <SelectGroup>
                          <SelectLabel>
                            {translate("mis_connectors.mapping.tags")}
                          </SelectLabel>
                          {tags.map((tag) => (
                            <SelectItem key={tag.id} value={`tag:${tag.id}`}>
                              {translate("mis_connectors.mapping.tag", {
                                name: tag.name,
                              })}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
};

/** MIS doctors → doctors of the clinic */
const DoctorMapping = ({ kind }: { kind: MisKind }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: doctors } = useDoctors();
  const { data: misDoctors = [], refetch } = useGetList<MisDoctor>(
    "mis_doctors",
    {
      filter: { kind },
      sort: { field: "name", order: "ASC" },
      pagination: { page: 1, perPage: 200 },
    },
  );
  const link = useMutation({
    mutationFn: ({
      id,
      doctorId,
    }: {
      id: Identifier;
      doctorId: Identifier | null;
    }) => dataProvider.linkMisDoctor(id, doctorId),
    onSuccess: () => {
      refetch();
      notify("mis_connectors.doctors.saved", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });

  return (
    <Section
      title={translate("mis_connectors.doctors.title")}
      help={translate("mis_connectors.doctors.help")}
    >
      {misDoctors.length ? (
        <ul className="flex max-w-3xl flex-col divide-y divide-border rounded-md bg-card">
          {misDoctors.map((misDoctor) => (
            <li
              key={misDoctor.id}
              className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{misDoctor.name}</span>
                {misDoctor.doctor_id == null ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {translate("mis_connectors.doctors.unlinked")}
                  </span>
                ) : null}
              </span>
              <Select
                value={
                  misDoctor.doctor_id != null
                    ? String(misDoctor.doctor_id)
                    : NONE
                }
                onValueChange={(value) =>
                  link.mutate({
                    id: misDoctor.id,
                    doctorId: value === NONE ? null : Number(value),
                  })
                }
              >
                <SelectTrigger
                  className="w-72"
                  aria-label={`${translate("mis_connectors.doctors.crm_doctor")}: ${misDoctor.name}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    {translate("mis_connectors.doctors.none")}
                  </SelectItem>
                  {doctors.map((doctor) => (
                    <SelectItem key={doctor.id} value={String(doctor.id)}>
                      {doctor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("mis_connectors.doctors.empty")}
        </p>
      )}
    </Section>
  );
};

const WebhookAddress = ({ kind, url }: { kind: MisKind; url: string }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const regenerate = useMutation({
    mutationFn: () => dataProvider.regenerateMisToken(kind),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mis_connection", kind] });
      notify("mis_connectors.webhook.regenerated", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify("mis_connectors.webhook.copied", { type: "info" });
    } catch {
      // Clipboard refused (insecure context): the field stays selectable
    }
  };
  return (
    <Section
      title={translate("mis_connectors.webhook.title")}
      help={translate("mis_connectors.webhook.help")}
    >
      <div className="flex max-w-3xl flex-wrap gap-2">
        <Input
          readOnly
          value={url}
          aria-label={translate("mis_connectors.webhook.title")}
          onFocus={(event) => event.target.select()}
          className="min-w-64 flex-1 font-mono text-xs"
        />
        <Button variant="outline" onClick={copy}>
          {translate("mis_connectors.webhook.copy")}
        </Button>
        <Button
          variant="outline"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          {translate("mis_connectors.webhook.regenerate")}
        </Button>
      </div>
    </Section>
  );
};

/** The last 50 events of the connector */
const SyncLog = ({
  entries,
  isPending,
}: {
  entries: MisSyncLogEntry[];
  isPending: boolean;
}) => {
  const translate = useTranslate();
  return (
    <Section title={translate("mis_connectors.log.title")}>
      {entries.length ? (
        <div className="max-w-4xl overflow-x-auto rounded-md bg-card">
          <table className="w-full text-sm" data-testid="mis-sync-log">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">
                  {translate("mis_connectors.log.time")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {translate("mis_connectors.log.event")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {translate("mis_connectors.log.result")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {translate("mis_connectors.log.details")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const operation = logOperationKey(entry.operation);
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {dateTime(entry.created_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {operation ? translate(operation) : entry.operation}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {translate(
                          `mis_connectors.log.direction.${entry.direction}`,
                        )}
                        {entry.external_id ? ` · ${entry.external_id}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-xs font-semibold",
                          entry.result === "ok"
                            ? "bg-muted text-foreground"
                            : entry.result === "skipped"
                              ? "bg-accent text-accent-foreground"
                              : "bg-destructive/15 text-destructive",
                        )}
                      >
                        {translate(logResultKey(entry.result))}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {entry.message}
                      {entry.deal_id != null ? (
                        <Link
                          to={`/deals/${entry.deal_id}/show`}
                          className="ml-2 text-brand-link hover:underline"
                        >
                          {translate("mis_connectors.log.open_deal")}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {isPending ? "" : translate("mis_connectors.log.empty")}
        </p>
      )}
    </Section>
  );
};
