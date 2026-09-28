import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCreate,
  useDataProvider,
  useDelete,
  useGetList,
  useNotify,
  useTranslate,
  useUpdate,
  type Identifier,
} from "ra-core";
import { useState, type ReactNode } from "react";
import { Confirm } from "@/components/admin/confirm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from "../pipeline-automation/types";
import { eventLabelKey } from "../pipeline-automation/webhooks";
import type { CrmDataProvider } from "../providers/types";
import type { CatalogEntry, CatalogSettingsProps } from "./catalog";
import { monogramText } from "./catalogModel";
import {
  appToManifest,
  isWriteScope,
  manifestToJson,
  parseManifest,
  scopeLabelKey,
  slugify,
  SLUG_PATTERN,
  type ManifestResult,
} from "./manifest";
import {
  APP_SCOPES,
  type AppManifest,
  type AppScope,
  type DeveloperApp,
  type InstalledApp,
} from "./types";

/**
 * Developer apps (stage 25): registered in the clinic by an integrator, the
 * owner or the head; installing one creates its API key (with its scopes)
 * and its webhook, uninstalling revokes them (public.install_developer_app,
 * public.uninstall_developer_app). A manifest moves an app to another clinic.
 */

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("ru-RU") : "—";

export const useDeveloperApps = () =>
  useGetList<DeveloperApp>("developer_apps", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });

const useRefreshApps = () => {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["developer_apps", "api_keys", "webhooks"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
};

const useErrorNotify = () => {
  const notify = useNotify();
  return (error: unknown) =>
    notify(
      error instanceof Error ? error.message : "ra.notification.http_error",
      { type: "error" },
    );
};

/** The catalog entry of an app of the clinic */
export const appEntry = (app: DeveloperApp): CatalogEntry => ({
  id: `app-${app.id}`,
  name: app.name,
  vendor: app.developer_name,
  category: "apps",
  summary:
    app.description?.split(/(?<=[.!?])\s/)[0] ??
    `Приложение ${app.developer_name}`,
  description: app.description ?? "",
  logo: { text: monogramText(app.name), tone: "rose" },
  status: "available",
  kind: "app",
  keywords: [app.slug, app.developer_contact ?? ""],
  appId: app.id,
  settings: DeveloperAppSettings,
  useConnected: () => !!app.installed_at,
  useDisconnect: () => {
    const dataProvider = useDataProvider<CrmDataProvider>();
    const refresh = useRefreshApps();
    return app.installed_at
      ? async () => {
          await dataProvider.uninstallDeveloperApp(app.id);
          refresh();
        }
      : undefined;
  },
});

/** Scopes as badges: those that change data are outlined in the brand colour */
export const ScopeList = ({ scopes }: { scopes: readonly AppScope[] }) => {
  const translate = useTranslate();
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid="app-scopes">
      {scopes.map((scope) => (
        <li
          key={scope}
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs",
            isWriteScope(scope)
              ? "border-primary/50 text-foreground"
              : "text-muted-foreground",
          )}
          title={scope}
        >
          {translate(scopeLabelKey(scope))}{" "}
          <span className="font-mono text-[11px] opacity-70">{scope}</span>
        </li>
      ))}
    </ul>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words">{children}</span>
  </div>
);

const ExternalLink = ({ href }: { href: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    className="text-brand-link underline-offset-2 hover:underline"
  >
    {href}
  </a>
);

/** «Подключение» of an app: what it gets, install, export, edit, delete */
export const DeveloperAppSettings = ({ entry }: CatalogSettingsProps) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshApps();
  const onError = useErrorNotify();
  const { data: apps = [] } = useDeveloperApps();
  const app = apps.find((a) => String(a.id) === String(entry.appId));
  const [installed, setInstalled] = useState<InstalledApp | null>(null);
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [remove, { isPending: removing }] = useDelete();
  const install = useMutation({
    mutationFn: (id: Identifier) => dataProvider.installDeveloperApp(id),
    onSuccess: (result) => {
      setInstalled(result);
      refresh();
    },
    onError,
  });
  if (!app) return null;

  return (
    <div className="flex flex-col gap-4" data-testid="developer-app">
      <div className="divide-y rounded-md border bg-card px-4">
        <Row label={translate("market.apps.developer")}>
          {app.developer_name}
          {app.developer_contact ? ` · ${app.developer_contact}` : null}
        </Row>
        {app.website_url ? (
          <Row label={translate("market.apps.website")}>
            <ExternalLink href={app.website_url} />
          </Row>
        ) : null}
        {app.settings_url ? (
          <Row label={translate("market.apps.settings_url")}>
            <ExternalLink href={app.settings_url} />
          </Row>
        ) : null}
        <Row label={translate("market.apps.scopes")}>
          <ScopeList scopes={app.scopes} />
        </Row>
        <Row label={translate("market.apps.webhook")}>
          {app.webhook_url && app.webhook_events.length ? (
            <span className="flex flex-col gap-1">
              <span className="font-mono text-xs">{app.webhook_url}</span>
              <span className="text-xs text-muted-foreground">
                {app.webhook_events
                  .map((event) => translate(eventLabelKey(event)))
                  .join(", ")}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {translate("market.apps.no_webhook")}
            </span>
          )}
        </Row>
        <Row label={translate("market.apps.state")}>
          {app.installed_at
            ? translate("market.apps.installed_at", {
                date: formatDate(app.installed_at),
              })
            : translate("market.apps.not_installed")}
        </Row>
      </div>
      <div className="flex flex-wrap gap-2">
        {app.installed_at ? null : (
          <Button
            onClick={() => install.mutate(app.id)}
            disabled={install.isPending}
          >
            {translate("market.apps.install")}
          </Button>
        )}
        {app.installed_at && app.settings_url ? (
          <Button variant="outline" asChild>
            <a
              href={app.settings_url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {translate("market.apps.open_settings")}
            </a>
          </Button>
        ) : null}
        <Button variant="outline" onClick={() => setExporting(true)}>
          {translate("market.apps.export")}
        </Button>
        <Button variant="outline" onClick={() => setEditing(true)}>
          {translate("market.apps.edit")}
        </Button>
        {app.installed_at ? null : (
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => setDeleting(true)}
          >
            {translate("market.apps.delete")}
          </Button>
        )}
      </div>
      <InstalledAppDialog
        result={installed}
        onClose={() => setInstalled(null)}
      />
      <ManifestExportDialog
        manifest={exporting ? appToManifest(app) : null}
        onClose={() => setExporting(false)}
      />
      <AppFormDialog
        open={editing}
        app={app}
        onClose={() => setEditing(false)}
      />
      <Confirm
        isOpen={deleting}
        title={translate("market.apps.delete_title", { name: app.name })}
        content={translate("market.apps.delete_content")}
        confirm="ra.action.delete"
        confirmColor="warning"
        loading={removing}
        onConfirm={() =>
          remove(
            "developer_apps",
            { id: app.id, previousData: app },
            {
              onSuccess: () => {
                setDeleting(false);
                refresh();
              },
              onError,
            },
          )
        }
        onClose={() => setDeleting(false)}
      />
    </div>
  );
};

const useCopy = () => {
  const translate = useTranslate();
  const notify = useNotify();
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(translate("market.apps.copied"), { type: "info" });
    } catch {
      notify(translate("api.copy_failed"), { type: "warning" });
    }
  };
};

/** The key and the webhook secret of a new installation, once */
export const InstalledAppDialog = ({
  result,
  onClose,
}: {
  result: InstalledApp | null;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const copy = useCopy();
  return (
    <Dialog open={!!result} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent data-testid="installed-app">
        <DialogHeader>
          <DialogTitle>{translate("market.apps.installed_title")}</DialogTitle>
          <DialogDescription>
            {translate("market.apps.installed_hint")}
          </DialogDescription>
        </DialogHeader>
        <Secret
          label={translate("market.apps.key")}
          value={result?.key ?? ""}
          onCopy={copy}
          testId="installed-app-key"
        />
        {result?.webhook_secret ? (
          <Secret
            label={translate("market.apps.webhook_secret")}
            value={result.webhook_secret}
            onCopy={copy}
            testId="installed-app-secret"
          />
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>{translate("market.apps.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Secret = ({
  label,
  value,
  onCopy,
  testId,
}: {
  label: string;
  value: string;
  onCopy: (value: string) => void;
  testId: string;
}) => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs"
          data-testid={testId}
        >
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={() => onCopy(value)}>
          {translate("market.apps.copy")}
        </Button>
      </div>
    </div>
  );
};

const ManifestExportDialog = ({
  manifest,
  onClose,
}: {
  manifest: AppManifest | null;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const copy = useCopy();
  const json = manifest ? manifestToJson(manifest) : "";
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${manifest?.id ?? "app"}.dentalcrm.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog
      open={!!manifest}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{translate("market.apps.export")}</DialogTitle>
          <DialogDescription>
            {translate("market.apps.export_hint")}
          </DialogDescription>
        </DialogHeader>
        <pre
          className="max-h-80 overflow-auto rounded-md border bg-muted px-3 py-2 text-xs"
          data-testid="app-manifest"
        >
          {json}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={download}>
            {translate("market.apps.download")}
          </Button>
          <Button onClick={() => copy(json)}>
            {translate("market.apps.copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type AppForm = {
  name: string;
  slug: string;
  description: string;
  developer_name: string;
  developer_contact: string;
  website_url: string;
  settings_url: string;
  scopes: AppScope[];
  webhook_url: string;
  webhook_events: WebhookEvent[];
};

const toForm = (app?: DeveloperApp): AppForm => ({
  name: app?.name ?? "",
  slug: app?.slug ?? "",
  description: app?.description ?? "",
  developer_name: app?.developer_name ?? "",
  developer_contact: app?.developer_contact ?? "",
  website_url: app?.website_url ?? "",
  settings_url: app?.settings_url ?? "",
  scopes: app?.scopes ?? ["deals:read"],
  webhook_url: app?.webhook_url ?? "",
  webhook_events: app?.webhook_events ?? [],
});

const URL_PATTERN = /^https?:\/\/[^/\s]+/;

/** Problems of the form, as translation keys (same rules as the table) */
export const appFormErrors = (form: AppForm) => {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push("market.apps.form.errors.name");
  if (!form.developer_name.trim()) {
    errors.push("market.apps.form.errors.developer");
  }
  if (!SLUG_PATTERN.test(form.slug || slugify(form.name))) {
    errors.push("market.apps.form.errors.slug");
  }
  for (const url of [form.website_url, form.settings_url, form.webhook_url]) {
    if (url.trim() && !URL_PATTERN.test(url.trim())) {
      errors.push("market.apps.form.errors.url");
      break;
    }
  }
  if (!form.scopes.length) errors.push("market.apps.form.errors.scopes");
  if (
    form.webhook_events.length &&
    (!form.webhook_url.trim() || !form.scopes.includes("webhooks"))
  ) {
    errors.push("market.apps.form.errors.webhook");
  }
  return errors;
};

/** Register an app, or edit it (its scopes and webhook only when not installed) */
export const AppFormDialog = ({
  open,
  app,
  onClose,
}: {
  open: boolean;
  app?: DeveloperApp;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  return (
    <Dialog open={open} onOpenChange={(value) => (value ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              app ? "market.apps.edit_title" : "market.apps.form.title",
            )}
          </DialogTitle>
          <DialogDescription>
            {translate("market.apps.form.hint")}
          </DialogDescription>
        </DialogHeader>
        {open ? <AppFormBody app={app} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
};

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="font-medium">{label}</span>
    {children}
    {hint ? (
      <span className="text-xs text-muted-foreground">{hint}</span>
    ) : null}
  </label>
);

const AppFormBody = ({
  app,
  onClose,
}: {
  app?: DeveloperApp;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const refresh = useRefreshApps();
  const onError = useErrorNotify();
  const [create, { isPending: creating }] = useCreate();
  const [update, { isPending: updating }] = useUpdate();
  const [form, setForm] = useState<AppForm>(() => toForm(app));
  const [shown, setShown] = useState(false);
  const locked = !!app?.installed_at;
  const errors = appFormErrors(form);
  const set = <K extends keyof AppForm>(key: K, value: AppForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const toggle = <T extends string>(list: T[], value: T) =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];

  const submit = () => {
    setShown(true);
    if (errors.length) return;
    const data = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      developer_name: form.developer_name.trim(),
      developer_contact: form.developer_contact.trim() || null,
      website_url: form.website_url.trim() || null,
      settings_url: form.settings_url.trim() || null,
      ...(locked
        ? {}
        : {
            slug: form.slug.trim() || slugify(form.name),
            scopes: form.scopes,
            webhook_url: form.webhook_url.trim() || null,
            webhook_events: form.webhook_events,
          }),
    };
    const options = {
      onSuccess: () => {
        refresh();
        onClose();
      },
      onError,
    };
    if (app) {
      update(
        "developer_apps",
        { id: app.id, data, previousData: app },
        { ...options, mutationMode: "pessimistic" },
      );
    } else {
      create("developer_apps", { data }, options);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="app-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={translate("market.apps.form.name")}>
          <Input
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            aria-label={translate("market.apps.form.name")}
          />
        </Field>
        <Field
          label={translate("market.apps.form.slug")}
          hint={translate("market.apps.form.slug_hint")}
        >
          <Input
            value={form.slug}
            placeholder={slugify(form.name || "app")}
            disabled={locked}
            onChange={(event) => set("slug", event.target.value.toLowerCase())}
            aria-label={translate("market.apps.form.slug")}
          />
        </Field>
        <Field label={translate("market.apps.form.developer_name")}>
          <Input
            value={form.developer_name}
            onChange={(event) => set("developer_name", event.target.value)}
            aria-label={translate("market.apps.form.developer_name")}
          />
        </Field>
        <Field label={translate("market.apps.form.developer_contact")}>
          <Input
            value={form.developer_contact}
            onChange={(event) => set("developer_contact", event.target.value)}
            aria-label={translate("market.apps.form.developer_contact")}
          />
        </Field>
        <Field label={translate("market.apps.form.website_url")}>
          <Input
            value={form.website_url}
            placeholder="https://"
            onChange={(event) => set("website_url", event.target.value)}
            aria-label={translate("market.apps.form.website_url")}
          />
        </Field>
        <Field
          label={translate("market.apps.form.settings_url")}
          hint={translate("market.apps.form.settings_url_hint")}
        >
          <Input
            value={form.settings_url}
            placeholder="https://"
            onChange={(event) => set("settings_url", event.target.value)}
            aria-label={translate("market.apps.form.settings_url")}
          />
        </Field>
      </div>
      <Field label={translate("market.apps.form.description")}>
        <Textarea
          value={form.description}
          rows={3}
          onChange={(event) => set("description", event.target.value)}
          aria-label={translate("market.apps.form.description")}
        />
      </Field>
      <fieldset className="flex flex-col gap-2" disabled={locked}>
        <legend className="mb-1 text-sm font-medium">
          {translate("market.apps.form.scopes")}
        </legend>
        {locked ? (
          <p className="text-xs text-muted-foreground">
            {translate("market.apps.locked")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {APP_SCOPES.map((scope) => (
            <Chip
              key={scope}
              active={form.scopes.includes(scope)}
              onClick={() => set("scopes", toggle(form.scopes, scope))}
              label={translate(scopeLabelKey(scope))}
              hint={scope}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2" disabled={locked}>
        <legend className="mb-1 text-sm font-medium">
          {translate("market.apps.form.webhook")}
        </legend>
        <Input
          value={form.webhook_url}
          placeholder="https://"
          onChange={(event) => set("webhook_url", event.target.value)}
          aria-label={translate("market.apps.form.webhook_url")}
        />
        <div className="flex flex-wrap gap-1.5">
          {WEBHOOK_EVENTS.map((event) => (
            <Chip
              key={event}
              active={form.webhook_events.includes(event)}
              onClick={() =>
                set("webhook_events", toggle(form.webhook_events, event))
              }
              label={translate(eventLabelKey(event))}
              hint={event}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {translate("market.apps.form.webhook_hint")}
        </p>
      </fieldset>
      {shown && errors.length ? (
        <ul
          className="flex flex-col gap-0.5 text-sm text-destructive"
          role="alert"
        >
          {errors.map((error) => (
            <li key={error}>{translate(error)}</li>
          ))}
        </ul>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {translate("ra.action.cancel")}
        </Button>
        <Button type="submit" disabled={creating || updating}>
          {translate(app ? "ra.action.save" : "market.apps.form.save")}
        </Button>
      </DialogFooter>
    </form>
  );
};

const Chip = ({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) => (
  <button
    type="button"
    aria-pressed={active}
    title={hint}
    onClick={onClick}
    className={cn(
      "rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-60",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-background text-foreground hover:bg-accent",
    )}
  >
    {label}
  </button>
);

/** Paste a manifest, review the scopes, install */
export const ImportManifestDialog = ({
  open,
  onClose,
  onInstalled,
}: {
  open: boolean;
  onClose: () => void;
  onInstalled: (appId: Identifier) => void;
}) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshApps();
  const onError = useErrorNotify();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ManifestResult | null>(null);
  const [installed, setInstalled] = useState<InstalledApp | null>(null);
  const install = useMutation({
    mutationFn: async (manifest: AppManifest) => {
      const appId = await dataProvider.importAppManifest(manifest);
      return dataProvider.installDeveloperApp(appId);
    },
    onSuccess: (value) => {
      refresh();
      setInstalled(value);
    },
    onError,
  });
  const close = () => {
    setText("");
    setResult(null);
    onClose();
  };

  return (
    <>
      <Dialog
        open={open && !installed}
        onOpenChange={(value) => (value ? null : close())}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{translate("market.manifest.title")}</DialogTitle>
            <DialogDescription>
              {translate("market.manifest.hint")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={text}
            rows={10}
            className="font-mono text-xs"
            placeholder={
              '{ "manifest_version": 1, "id": "...", "scopes": [...] }'
            }
            aria-label={translate("market.manifest.title")}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
          />
          {result && !result.ok ? (
            <ul
              className="flex flex-col gap-0.5 text-sm text-destructive"
              role="alert"
            >
              {result.errors.map((error) => (
                <li key={error.key}>{translate(error.key, error.args)}</li>
              ))}
            </ul>
          ) : null}
          {result?.ok ? <ManifestReview manifest={result.manifest} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {translate("ra.action.cancel")}
            </Button>
            {result?.ok ? (
              <Button
                onClick={() => install.mutate(result.manifest)}
                disabled={install.isPending}
              >
                {translate("market.manifest.install")}
              </Button>
            ) : (
              <Button onClick={() => setResult(parseManifest(text))}>
                {translate("market.manifest.check")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <InstalledAppDialog
        result={installed}
        onClose={() => {
          const appId = installed?.app_id;
          setInstalled(null);
          close();
          if (appId != null) onInstalled(appId);
        }}
      />
    </>
  );
};

const ManifestReview = ({ manifest }: { manifest: AppManifest }) => {
  const translate = useTranslate();
  return (
    <div
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-testid="manifest-review"
    >
      <div>
        <p className="font-semibold">{manifest.name}</p>
        <p className="text-sm text-muted-foreground">
          {manifest.developer.name}
          {manifest.developer.contact ? ` · ${manifest.developer.contact}` : ""}
        </p>
        {manifest.description ? (
          <p className="mt-1 text-sm">{manifest.description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          {translate("market.manifest.review")}
        </span>
        <ScopeList scopes={manifest.scopes} />
      </div>
      {manifest.webhook?.events.length ? (
        <p className="text-sm text-muted-foreground">
          {translate("market.manifest.webhook", {
            url: manifest.webhook.url,
            events: manifest.webhook.events
              .map((event) => translate(eventLabelKey(event)))
              .join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
};
