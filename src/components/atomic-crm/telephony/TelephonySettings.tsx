import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react";
import {
  useDataProvider,
  useGetList,
  useNotify,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import type { Sale, TelephonyProvider } from "../types";
import {
  providerTextKey,
  providerUsesKeys,
  TELEPHONY_PROVIDERS,
} from "./telephony";

const dateTime = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Settings → Телефония (owner and head): the clinic's PBX, the address to
 * paste in it, its secret and API key, a test call, and the internal numbers
 * that map calls to the employees.
 */
export const TelephonySettings = () => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  const { data: status, isPending } = useQuery({
    queryKey: ["telephony_status"],
    queryFn: () => dataProvider.getTelephonyStatus(),
  });
  const [provider, setProvider] = useState<TelephonyProvider>("binotel");
  const [secret, setSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [testDealId, setTestDealId] = useState<Identifier | null>(null);
  useEffect(() => {
    if (status?.provider) setProvider(status.provider);
  }, [status?.provider]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["telephony_status"] });
  const onError = (error: Error) =>
    notify(error.message || "telephony.save_error", { type: "error" });

  const save = useMutation({
    mutationFn: () =>
      dataProvider.saveTelephony({
        provider,
        secret: secret.trim() ? secret.trim() : null,
        apiKey: apiKey.trim() ? apiKey.trim() : null,
      }),
    onSuccess: () => {
      setSecret("");
      setApiKey("");
      refresh();
      notify("telephony.saved", { type: "info" });
    },
    onError: () => notify("telephony.save_error", { type: "error" }),
  });
  const regenerate = useMutation({
    mutationFn: () => dataProvider.regenerateTelephonyToken(),
    onSuccess: () => {
      refresh();
      notify("telephony.regenerated", { type: "info" });
    },
    onError,
  });
  const disconnect = useMutation({
    mutationFn: () => dataProvider.disconnectTelephony(),
    onSuccess: refresh,
    onError,
  });
  const testCall = useMutation({
    mutationFn: () => dataProvider.simulateTelephonyCall(),
    onSuccess: ({ deal_id }) => {
      setTestDealId(deal_id);
      refresh();
      for (const key of ["deals", "calls", "tasks", "patients"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      notify("telephony.test_call_done", { type: "info" });
    },
    onError,
  });

  if (isPending) return null;
  const connected = !!status;
  const secretStored = connected && status.provider === provider;

  const copy = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.webhook_url);
      notify("telephony.copied", { type: "info" });
    } catch {
      // Clipboard refused (insecure context): the field stays selectable
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {connected ? (
            <CircleCheck className="size-5 text-brand-lime" />
          ) : (
            <CircleAlert className="size-5 text-muted-foreground" />
          )}
          {connected
            ? translate("telephony.status_connected", {
                provider: translate(
                  providerTextKey(status.provider, "providers"),
                ),
              })
            : translate("telephony.status_disconnected")}
        </div>
        {connected ? (
          <p className="text-xs text-muted-foreground">
            {status.last_event_at
              ? translate("telephony.last_event", {
                  date: dateTime(status.last_event_at),
                })
              : translate("telephony.no_events")}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id="telephony-provider">
          {translate("telephony.provider")}
        </span>
        <div
          className="flex flex-wrap gap-1"
          role="radiogroup"
          aria-labelledby="telephony-provider"
        >
          {TELEPHONY_PROVIDERS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={provider === value}
              onClick={() => setProvider(value)}
              className={cn(
                "h-10 rounded-md px-3.5 text-sm font-medium transition-colors",
                provider === value
                  ? "bg-primary text-primary-foreground"
                  : "soft hover:bg-card",
              )}
            >
              {translate(providerTextKey(value, "providers"))}
            </button>
          ))}
        </div>
      </div>

      <div className="flex max-w-xl flex-col gap-4">
        {providerUsesKeys(provider) ? (
          <SecretField
            id="telephony-secret"
            label={translate("telephony.secret")}
            help={translate(providerTextKey(provider, "secret_help"))}
            value={secret}
            onChange={setSecret}
            placeholder={translate(
              secretStored && status.has_secret
                ? "telephony.stored"
                : "telephony.optional",
            )}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {translate("sipuni.no_keys")}
          </p>
        )}
        {provider !== "generic" && providerUsesKeys(provider) ? (
          <SecretField
            id="telephony-api-key"
            label={translate("telephony.api_key")}
            help={translate(providerTextKey(provider, "api_key_help"))}
            value={apiKey}
            onChange={setApiKey}
            placeholder={translate(
              secretStored && status.has_api_key
                ? "telephony.stored"
                : "telephony.optional",
            )}
          />
        ) : null}
        <div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {translate(connected ? "telephony.save" : "telephony.connect")}
          </Button>
        </div>
      </div>

      {connected ? (
        <div className="flex max-w-3xl flex-col gap-2">
          <label htmlFor="telephony-url" className="text-sm font-medium">
            {translate("telephony.webhook_url")}
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="telephony-url"
              readOnly
              value={status.webhook_url}
              onFocus={(event) => event.target.select()}
              className="min-w-64 flex-1 font-mono text-xs"
            />
            <Button variant="outline" onClick={copy}>
              {translate("telephony.copy")}
            </Button>
            <Button
              variant="outline"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
            >
              {translate("telephony.regenerate")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => testCall.mutate()}
              disabled={testCall.isPending}
            >
              {translate("telephony.test_call")}
            </Button>
            {testDealId != null ? (
              <Link
                to={`/deals/${testDealId}/show`}
                className="text-sm font-medium text-primary hover:underline"
              >
                {translate("telephony.open_deal")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="flex max-w-3xl flex-col gap-2 rounded-md bg-card px-5 py-4">
        <h3 className="text-sm font-semibold">
          {translate("telephony.setup_title")} ·{" "}
          {translate(providerTextKey(provider, "providers"))}
        </h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          {translate(providerTextKey(provider, "instructions"))
            .split("\n")
            .map((step) => (
              <li key={step}>{step}</li>
            ))}
        </ol>
      </section>

      <ExtensionsEditor />

      {connected ? (
        <div>
          <Button
            variant="outline"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
          >
            {translate("telephony.disconnect")}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const SecretField = ({
  id,
  label,
  help,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={id} className="text-sm font-medium">
      {label}
    </label>
    <Input
      id={id}
      type="password"
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
    <p className="text-xs text-muted-foreground">{help}</p>
  </div>
);

/** Internal number of each active employee, saved when the field is left */
const ExtensionsEditor = () => {
  const translate = useTranslate();
  const { data: sales = [], refetch } = useGetList<Sale>("sales", {
    filter: { "disabled@neq": true },
    pagination: { page: 1, perPage: 200 },
    sort: { field: "first_name", order: "ASC" },
  });
  if (!sales.length) return null;
  return (
    <section className="flex max-w-xl flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {translate("telephony.extensions.title")}
      </h3>
      <p className="text-xs text-muted-foreground">
        {translate("telephony.extensions.help")}
      </p>
      <ul className="flex flex-col gap-1.5">
        {sales.map((sale) => (
          <ExtensionRow key={sale.id} sale={sale} onSaved={refetch} />
        ))}
      </ul>
    </section>
  );
};

const ExtensionRow = ({
  sale,
  onSaved,
}: {
  sale: Sale;
  onSaved: () => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [value, setValue] = useState(sale.phone_extension ?? "");
  useEffect(() => setValue(sale.phone_extension ?? ""), [sale.phone_extension]);
  const name = `${sale.first_name} ${sale.last_name}`;

  const save = async () => {
    const next = value.trim();
    if (next === (sale.phone_extension ?? "")) return;
    try {
      await dataProvider.setSalesPhoneExtension(sale.id, next || null);
      notify("telephony.extensions.saved", { type: "info" });
      onSaved();
    } catch (error) {
      setValue(sale.phone_extension ?? "");
      notify(
        (error as { code?: string }).code === "23505"
          ? "telephony.extensions.taken"
          : "telephony.save_error",
        { type: "error" },
      );
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-md bg-card px-4 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <Input
        aria-label={`${translate("telephony.extension")}: ${name}`}
        placeholder={translate("telephony.extensions.placeholder")}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-9 w-32 tabular-nums"
      />
    </li>
  );
};
