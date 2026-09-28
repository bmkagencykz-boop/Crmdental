import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import { useDictionaryMutations } from "../settings/useDictionaryMutations";
import {
  WEBHOOK_EVENTS,
  type ApiKey,
  type ApiKeyScope,
  type CreatedApiKey,
  type Webhook,
  type WebhookDelivery,
} from "./types";
import { eventLabelKey, isPublicWebhookUrl, webhookState } from "./webhooks";

const formatTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/**
 * Settings → «API и вебхуки» (owner and head): API keys of the public REST
 * API (shown once, stored as a hash), outgoing webhooks with their signing
 * secret, and the last deliveries.
 */
export const ApiSettings = () => {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-8" data-testid="api-settings">
      <Link
        to="/api-docs"
        className="inline-flex w-fit items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium no-underline hover:bg-accent"
      >
        {translate("api.docs_link")}
      </Link>
      <Section
        icon={<KeyRound className="size-4" />}
        title={translate("api.keys.title")}
        hint={translate("api.keys.hint")}
      >
        <ApiKeys />
      </Section>
      <Section
        icon={<WebhookIcon className="size-4" />}
        title={translate("api.webhooks.title")}
        hint={translate("api.webhooks.hint")}
      >
        <Webhooks />
      </Section>
      <Section
        icon={<Send className="size-4" />}
        title={translate("api.deliveries.title")}
        hint={translate("api.deliveries.hint")}
      >
        <Deliveries />
      </Section>
    </div>
  );
};

const Section = ({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <div>
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h3>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
    {children}
  </section>
);

const useCopy = () => {
  const translate = useTranslate();
  const notify = useNotify();
  return async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(translate("api.copied"), { type: "info" });
    } catch {
      notify(translate("api.copy_failed"), { type: "warning" });
    }
  };
};

const ApiKeys = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ApiKeyScope>("read");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const { data: keys = [] } = useQuery({
    queryKey: ["api_keys"],
    queryFn: () => dataProvider.listApiKeys(),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["api_keys"] });
  const onError = (error: unknown) =>
    notify(
      error instanceof Error ? error.message : "ra.notification.http_error",
      {
        type: "error",
      },
    );
  const createKey = useMutation({
    mutationFn: () => dataProvider.createApiKey(name.trim(), scope),
    onSuccess: (key) => {
      setCreated(key);
      setName("");
      refresh();
    },
    onError,
  });
  const revokeKey = useMutation({
    mutationFn: (id: Identifier) => dataProvider.revokeApiKey(id),
    onSuccess: () => {
      setRevoking(null);
      refresh();
    },
    onError,
  });

  return (
    <div className="flex flex-col gap-3">
      {keys.length ? (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
              data-testid="api-key"
            >
              <span className="font-medium">{key.name}</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {key.prefix}…
              </code>
              <span className="rounded-md border px-1.5 py-0.5 text-xs">
                {translate(`api.keys.scopes.${key.scope}`)}
              </span>
              {key.app_id != null ? (
                // Key of a developer app (stage 25): its fine scopes
                <span
                  className="rounded-md bg-muted px-1.5 py-0.5 text-xs"
                  title={(key.scopes ?? []).join(", ")}
                >
                  {translate("market.apps.key_badge")}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {translate("api.keys.created_at", {
                  date: formatTime(key.created_at),
                })}
                {" · "}
                {key.last_used_at
                  ? translate("api.keys.last_used", {
                      date: formatTime(key.last_used_at),
                    })
                  : translate("api.keys.never_used")}
              </span>
              <span className="ml-auto">
                {key.revoked_at ? (
                  <span className="text-xs text-muted-foreground">
                    {translate("api.keys.revoked", {
                      date: formatTime(key.revoked_at),
                    })}
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setRevoking(key)}
                  >
                    {translate("api.keys.revoke")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("api.keys.empty")}
        </p>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) createKey.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={translate("api.keys.name_placeholder")}
          aria-label={translate("api.keys.name")}
          className="w-64"
        />
        <Select
          value={scope}
          onValueChange={(value) => setScope(value as ApiKeyScope)}
        >
          <SelectTrigger
            className="w-48"
            aria-label={translate("api.keys.scope")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["read", "write"] as const).map((item) => (
              <SelectItem key={item} value={item}>
                {translate(`api.keys.scopes.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          variant="outline"
          disabled={!name.trim() || createKey.isPending}
        >
          {translate("api.keys.create")}
        </Button>
      </form>
      <CreatedKeyDialog apiKey={created} onClose={() => setCreated(null)} />
      <Confirm
        isOpen={!!revoking}
        title={translate("api.keys.revoke_title", { name: revoking?.name })}
        content={translate("api.keys.revoke_content")}
        confirm="api.keys.revoke"
        confirmColor="warning"
        loading={revokeKey.isPending}
        onConfirm={() => revoking && revokeKey.mutate(revoking.id)}
        onClose={() => setRevoking(null)}
      />
    </div>
  );
};

/** The key, once: only its hash is kept */
const CreatedKeyDialog = ({
  apiKey,
  onClose,
}: {
  apiKey: CreatedApiKey | null;
  onClose: () => void;
}) => {
  const translate = useTranslate();
  const copy = useCopy();
  return (
    <Dialog open={!!apiKey} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent data-testid="created-api-key">
        <DialogHeader>
          <DialogTitle>{translate("api.keys.created_title")}</DialogTitle>
          <DialogDescription>
            {translate("api.keys.created_hint")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs"
            data-testid="created-api-key-value"
          >
            {apiKey?.key}
          </code>
          <Button
            variant="outline"
            size="icon"
            onClick={() => apiKey && copy(apiKey.key)}
            aria-label={translate("api.copy")}
          >
            <Copy className="size-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{translate("api.keys.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DEFAULT_EVENTS = ["deal.created", "deal.stage_changed"];

const Webhooks = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const [url, setUrl] = useState("");
  const { data: webhooks = [] } = useGetList<Webhook>("webhooks", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  const { create } = useDictionaryMutations("webhooks");
  const add = () => {
    const value = url.trim();
    if (!/^https?:\/\/[^/\s]+/.test(value)) {
      notify("api.errors.webhook_url", { type: "error" });
      return;
    }
    if (!isPublicWebhookUrl(value)) {
      notify("api.errors.webhook_private", { type: "error" });
      return;
    }
    create({ url: value, events: DEFAULT_EVENTS, is_active: true });
    setUrl("");
  };

  return (
    <div className="flex flex-col gap-3">
      {webhooks.length ? (
        webhooks.map((webhook) => (
          <WebhookCard key={webhook.id} webhook={webhook} />
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate("api.webhooks.empty")}
        </p>
      )}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
          aria-label={translate("api.webhooks.url")}
          className="w-96 max-w-full"
        />
        <Button type="submit" variant="outline" disabled={!url.trim()}>
          {translate("api.webhooks.add")}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        {translate("api.webhooks.signature_hint")}
      </p>
    </div>
  );
};

const STATE_STYLES = {
  active: "border-transparent bg-brand-green/20",
  failing: "border-transparent bg-warn/20",
  disabled: "border-transparent bg-destructive/15 text-destructive",
  off: "",
} as const;

const WebhookCard = ({ webhook }: { webhook: Webhook }) => {
  const translate = useTranslate();
  const notify = useNotify();
  const copy = useCopy();
  const queryClient = useQueryClient();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { update, remove } = useDictionaryMutations("webhooks");
  const [showSecret, setShowSecret] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const state = webhookState(webhook);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    queryClient.invalidateQueries({ queryKey: ["webhook_deliveries"] });
  };
  const onError = (error: unknown) =>
    notify(
      error instanceof Error ? error.message : "ra.notification.http_error",
      {
        type: "error",
      },
    );
  const test = useMutation({
    mutationFn: () => dataProvider.sendTestWebhook(webhook.id),
    onSuccess: () => {
      notify("api.webhooks.test_sent", { type: "info" });
      refresh();
    },
    onError,
  });
  const regenerate = useMutation({
    mutationFn: () => dataProvider.regenerateWebhookSecret(webhook.id),
    onSuccess: () => {
      setShowSecret(true);
      refresh();
    },
    onError,
  });
  const toggleEvent = (event: string) => {
    const events = (webhook.events as string[]).includes(event)
      ? webhook.events.filter((e) => e !== event)
      : [...webhook.events, event];
    update(webhook, { events });
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-md border bg-card p-4"
      data-testid="webhook"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          key={`${webhook.id}-${webhook.name}`}
          defaultValue={webhook.name ?? ""}
          placeholder={translate("api.webhooks.name_placeholder")}
          aria-label={translate("api.webhooks.name")}
          className="w-56 font-medium"
          onBlur={(event) => {
            const name = event.target.value.trim() || null;
            if (name !== (webhook.name ?? null)) update(webhook, { name });
          }}
        />
        <Input
          key={`${webhook.id}-${webhook.url}`}
          defaultValue={webhook.url}
          aria-label={translate("api.webhooks.url")}
          className="min-w-64 flex-1"
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (value === webhook.url) return;
            if (!isPublicWebhookUrl(value)) {
              notify("api.errors.webhook_private", { type: "error" });
              event.target.value = webhook.url;
              return;
            }
            update(webhook, { url: value });
          }}
        />
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-xs font-medium",
            STATE_STYLES[state],
          )}
          data-testid="webhook-state"
        >
          {translate(`api.webhooks.state.${state}`)}
        </span>
        <Switch
          checked={webhook.is_active}
          onCheckedChange={(is_active) => update(webhook, { is_active })}
          aria-label={translate("api.webhooks.active")}
        />
      </div>
      {webhook.last_error && state !== "active" ? (
        <p className="text-sm text-destructive" role="status">
          {translate("api.webhooks.last_error", { error: webhook.last_error })}
          {webhook.failure_count
            ? ` · ${translate("api.webhooks.failures", { count: webhook.failure_count })}`
            : null}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {translate("api.webhooks.events")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {WEBHOOK_EVENTS.map((event) => {
            const active = (webhook.events as string[]).includes(event);
            return (
              <button
                key={event}
                type="button"
                aria-pressed={active}
                onClick={() => toggleEvent(event)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-accent",
                )}
              >
                {translate(eventLabelKey(event))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {translate("api.webhooks.secret")}
        </span>
        <code
          className="rounded bg-muted px-2 py-1 text-xs"
          data-testid="webhook-secret"
        >
          {showSecret ? webhook.secret : "••••••••••••••••"}
        </code>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowSecret((value) => !value)}
          aria-label={translate(
            showSecret
              ? "api.webhooks.hide_secret"
              : "api.webhooks.show_secret",
          )}
        >
          {showSecret ? (
            <EyeOff className="size-4" />
          ) : (
            <Eye className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => copy(webhook.secret)}
          aria-label={translate("api.copy")}
        >
          <Copy className="size-4" />
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!webhook.is_active || test.isPending}
            onClick={() => test.mutate()}
          >
            {translate("api.webhooks.test")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={regenerate.isPending}
            onClick={() => regenerate.mutate()}
          >
            {translate("api.webhooks.regenerate")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleting(true)}
            aria-label={translate("ra.action.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <Confirm
        isOpen={deleting}
        title={translate("api.webhooks.delete_title")}
        content={translate("api.webhooks.delete_content")}
        confirm="ra.action.delete"
        confirmColor="warning"
        onConfirm={() => {
          remove(webhook);
          setDeleting(false);
        }}
        onClose={() => setDeleting(false)}
      />
    </div>
  );
};

const DELIVERY_STYLES: Record<WebhookDelivery["status"], string> = {
  pending: "text-muted-foreground",
  sending: "text-muted-foreground",
  delivered: "text-foreground",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

const Deliveries = () => {
  const translate = useTranslate();
  const { data: deliveries = [] } = useGetList<WebhookDelivery>(
    "webhook_deliveries",
    {
      pagination: { page: 1, perPage: 20 },
      sort: { field: "created_at", order: "DESC" },
    },
    { refetchInterval: 15_000 },
  );
  const { data: webhooks = [] } = useGetList<Webhook>("webhooks", {
    pagination: { page: 1, perPage: 100 },
    sort: { field: "id", order: "ASC" },
  });
  if (!deliveries.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate("api.deliveries.empty")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border bg-card">
      <table className="w-full text-sm" data-testid="webhook-deliveries">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">
              {translate("api.deliveries.columns.at")}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate("api.deliveries.columns.webhook")}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate("api.deliveries.columns.event")}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate("api.deliveries.columns.status")}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate("api.deliveries.columns.attempts")}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate("api.deliveries.columns.result")}
            </th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((delivery) => {
            const webhook = webhooks.find(
              (w) => String(w.id) === String(delivery.webhook_id),
            );
            return (
              <tr key={delivery.id} className="border-b last:border-0">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {formatTime(delivery.created_at)}
                </td>
                <td className="max-w-48 truncate px-3 py-1.5">
                  {webhook?.name || webhook?.url || `#${delivery.webhook_id}`}
                </td>
                <td className="px-3 py-1.5">
                  {translate(eventLabelKey(delivery.event), {
                    _: delivery.event,
                  })}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 font-medium",
                    DELIVERY_STYLES[delivery.status],
                  )}
                >
                  {translate(`api.deliveries.statuses.${delivery.status}`)}
                  {delivery.status === "pending" && delivery.attempts > 0
                    ? ` · ${translate("api.deliveries.next_attempt", {
                        time: formatTime(delivery.next_attempt_at),
                      })}`
                    : null}
                </td>
                <td className="px-3 py-1.5">{delivery.attempts}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">
                  {delivery.error ??
                    (delivery.response_status
                      ? `HTTP ${delivery.response_status}`
                      : "—")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
