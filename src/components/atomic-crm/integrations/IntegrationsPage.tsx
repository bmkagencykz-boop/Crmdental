import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCanAccess, useNotify, useTranslate } from "ra-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { CATALOG, type CatalogEntry } from "./catalog";
import {
  CATALOG_CATEGORIES,
  catalogBadge,
  countByFilter,
  filterCatalog,
  type CatalogBadge,
  type CatalogCategory,
  type CatalogFilter,
} from "./catalogModel";
import {
  AppFormDialog,
  appEntry,
  ImportManifestDialog,
  useDeveloperApps,
} from "./DeveloperApps";
import { Monogram } from "./Monogram";

/** Queries of the connected states, refreshed after «Отключить» */
const STATUS_QUERIES = [
  "messenger_status",
  "telegram_bot_status",
  "telephony_status",
  "integration_status",
  "developer_apps",
  "api_keys",
  "webhooks",
];

const FILTERS: CatalogFilter[] = ["all", "connected", ...CATALOG_CATEGORIES];
const isFilter = (value: string | null): value is CatalogFilter =>
  FILTERS.includes(value as CatalogFilter);

/**
 * «Интеграции» (stage 25): the catalog of what the clinic can connect, like
 * amoCRM's marketplace — chips per category, search, cards with their
 * status; a card opens the integration with its settings. ?category= picks a
 * chip, ?open=<id> opens an integration.
 */
export const IntegrationsPage = () => {
  const translate = useTranslate();
  const [params, setParams] = useSearchParams();
  const { canAccess, isPending } = useCanAccess({
    resource: "integrations",
    action: "list",
  });
  const { canAccess: canImport } = useCanAccess({
    resource: "import",
    action: "create",
  });
  const { data: apps = [] } = useDeveloperApps();
  const entries = useMemo(
    () => [
      ...CATALOG.filter((entry) => entry.resource !== "import" || canImport),
      ...apps.map(appEntry),
    ],
    [apps, canImport],
  );
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const report = useCallback((id: string, value: boolean | undefined) => {
    setConnected((current) =>
      current[id] === !!value ? current : { ...current, [id]: !!value },
    );
  }, []);
  const isConnected = useCallback(
    (entry: CatalogEntry) => connected[entry.id],
    [connected],
  );

  const category = params.get("category");
  const filter: CatalogFilter = isFilter(category) ? category : "all";
  const [query, setQuery] = useState("");
  const [registering, setRegistering] = useState(false);
  const [importing, setImporting] = useState(false);
  const openId = params.get("open");
  const opened = entries.find((entry) => entry.id === openId);
  const update = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value == null) next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  if (isPending) return null;
  if (!canAccess) return <Navigate to="/" replace />;

  const counts = countByFilter(entries, isConnected);
  const visible = filterCatalog(entries, { filter, query, isConnected });
  // «Все» without a search: grouped by category, like the amoCRM market
  const grouped = filter === "all" && !query.trim();

  return (
    <div className="flex flex-col gap-5" data-testid="integrations-page">
      {entries.map((entry) => (
        <ConnectedProbe key={entry.id} entry={entry} onChange={report} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={translate("market.search")}
          aria-label={translate("market.search")}
          className="h-9 w-80 max-w-full"
        />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setImporting(true)}
          >
            {translate("market.apps.import")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRegistering(true)}
          >
            {translate("market.apps.register")}
          </Button>
        </div>
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label={translate("market.filters.label")}
      >
        {FILTERS.filter(
          // A category the user cannot use (import for the integrator) is hidden
          (id) => counts[id] > 0 || ["all", "connected", "apps"].includes(id),
        ).map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => update({ category: id === "all" ? null : id })}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm transition-colors",
              filter === id
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-accent",
            )}
          >
            {filterLabel(translate, id)}
            <span
              className={cn(
                "text-xs tabular-nums",
                filter === id ? "opacity-80" : "text-muted-foreground",
              )}
            >
              {counts[id]}
            </span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          {filter === "apps" && !query.trim()
            ? translate("market.apps.empty")
            : translate("market.empty")}
        </p>
      ) : grouped ? (
        CATALOG_CATEGORIES.map((id) => {
          const items = visible.filter((entry) => entry.category === id);
          if (!items.length) return null;
          return (
            <section key={id} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {translate(`market.categories.${id}`)}
              </h2>
              <CardGrid
                items={items}
                isConnected={isConnected}
                onOpen={(entry) => update({ open: entry.id })}
              />
            </section>
          );
        })
      ) : (
        <CardGrid
          items={visible}
          isConnected={isConnected}
          onOpen={(entry) => update({ open: entry.id })}
        />
      )}
      {filter === "apps" && visible.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate("market.apps.hint")}
        </p>
      ) : null}
      <IntegrationDialog
        entry={opened}
        connected={opened ? connected[opened.id] : undefined}
        onClose={() => update({ open: null })}
      />
      <AppFormDialog open={registering} onClose={() => setRegistering(false)} />
      <ImportManifestDialog
        open={importing}
        onClose={() => setImporting(false)}
        onInstalled={(appId) =>
          update({ category: "apps", open: `app-${appId}` })
        }
      />
    </div>
  );
};

IntegrationsPage.path = "/integrations";

const filterLabel = (translate: (key: string) => string, id: CatalogFilter) =>
  id === "all" || id === "connected"
    ? translate(`market.filters.${id}`)
    : translate(`market.categories.${id as CatalogCategory}`);

/** Reports the connected state of an entry (its hook) to the page */
const ConnectedProbe = ({
  entry,
  onChange,
}: {
  entry: CatalogEntry;
  onChange: (id: string, value: boolean | undefined) => void;
}) => {
  const value = entry.useConnected();
  useEffect(() => {
    onChange(entry.id, value);
  }, [entry.id, value, onChange]);
  return null;
};

const BADGE_STYLES: Record<CatalogBadge, string> = {
  connected: "border-transparent bg-primary text-primary-foreground",
  available: "text-foreground",
  beta: "border-dashed text-foreground",
  coming: "border-transparent bg-muted text-muted-foreground",
};

export const StatusBadge = ({ badge }: { badge: CatalogBadge }) => {
  const translate = useTranslate();
  return (
    <span
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        BADGE_STYLES[badge],
      )}
      data-testid="integration-badge"
    >
      {translate(`market.badges.${badge}`)}
    </span>
  );
};

const CardGrid = ({
  items,
  isConnected,
  onOpen,
}: {
  items: CatalogEntry[];
  isConnected: (entry: CatalogEntry) => boolean | undefined;
  onOpen: (entry: CatalogEntry) => void;
}) => {
  const translate = useTranslate();
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {items.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onOpen(entry)}
            className="flex h-full w-full items-start gap-3 rounded-md border bg-card p-3.5 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="integration-card"
            aria-label={entry.name}
          >
            <Monogram logo={entry.logo} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-semibold">
                  {entry.name}
                </span>
                <StatusBadge
                  badge={catalogBadge(entry.status, isConnected(entry))}
                />
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {translate(`market.categories.${entry.category}`)} ·{" "}
                {entry.vendor}
              </span>
              <span className="line-clamp-1 text-sm text-foreground/85">
                {entry.summary}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

/** The integration: what it does, its settings, the «Отключить» action */
const IntegrationDialog = ({
  entry,
  connected,
  onClose,
}: {
  entry?: CatalogEntry;
  connected?: boolean;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  return (
    <Dialog open={!!entry} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"
        data-testid="integration-detail"
      >
        {entry ? (
          <IntegrationDetail
            key={entry.id}
            entry={entry}
            connected={connected}
          />
        ) : (
          <DialogTitle className="sr-only">
            {translate("market.title")}
          </DialogTitle>
        )}
      </DialogContent>
    </Dialog>
  );
};

const IntegrationDetail = ({
  entry,
  connected,
}: {
  entry: CatalogEntry;
  connected?: boolean;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const disconnect = entry.useDisconnect();
  const [confirming, setConfirming] = useState(false);
  const run = useMutation({
    mutationFn: async () => disconnect?.(),
    onSuccess: () => {
      setConfirming(false);
      for (const key of STATUS_QUERIES) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      notify("market.detail.disconnected", { type: "info" });
    },
    onError: (error: Error) => notify(error.message, { type: "error" }),
  });
  const Settings = entry.settings;
  return (
    <>
      <DialogHeader className="flex-row items-start gap-4 text-left">
        <Monogram logo={entry.logo} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg">{entry.name}</DialogTitle>
            <StatusBadge badge={catalogBadge(entry.status, connected)} />
          </div>
          <DialogDescription>
            {translate(`market.categories.${entry.category}`)} ·{" "}
            {translate("market.detail.vendor")}: {entry.vendor}
          </DialogDescription>
        </div>
      </DialogHeader>
      {entry.description ? (
        <p className="text-sm leading-relaxed">{entry.description}</p>
      ) : null}
      {entry.features?.length ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-sm font-semibold">
            {translate("market.detail.features")}
          </h3>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {entry.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span className="text-brand-link" aria-hidden>
                  —
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {translate("market.detail.connect")}
          </h3>
          {connected && disconnect ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setConfirming(true)}
            >
              {translate("market.detail.disconnect")}
            </Button>
          ) : null}
        </div>
        <Settings entry={entry} />
      </section>
      <Confirm
        isOpen={confirming}
        title={translate("market.detail.disconnect_title", {
          name: entry.name,
        })}
        content={translate(
          entry.kind === "app"
            ? "market.apps.uninstall_content"
            : "market.detail.disconnect_content",
        )}
        confirm="market.detail.disconnect"
        confirmColor="warning"
        loading={run.isPending}
        onConfirm={() => run.mutate()}
        onClose={() => setConfirming(false)}
      />
    </>
  );
};
