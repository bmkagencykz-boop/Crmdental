import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import { validateManifest } from "../../integrations/manifest";
import type {
  AppManifest,
  DeveloperApp,
  InstalledApp,
} from "../../integrations/types";
import type { ApiKey, Webhook } from "../../pipeline-automation/types";
import type { Sale } from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const randomHex = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length / 2)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const forbidden = (message = "market.errors.forbidden") =>
  Object.assign(new Error(message), { code: "42501" });

/** Resources an integrator only reads (restrictive policies of stage 25) */
const READ_ONLY_FOR_INTEGRATOR = [
  "deals",
  "patients",
  "patient_notes",
  "deal_notes",
  "deal_payments",
  "tasks",
  "calls",
  "messages",
  "deal_checklist_checks",
  "deal_files",
  "automessages",
];

/**
 * Marketplace of the demo (stage 25): the same rules as
 * supabase/schemas/25_marketplace.sql — apps installed with a key bound to
 * them and their webhook, uninstalled by revoking the key and removing the
 * webhooks; the integrator configures but only reads the deals, does not see
 * the payments, nor the messages without «доступ к переписке».
 */
export const createMarketplaceDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
}) => {
  const nowIso = () => new Date().toISOString();
  const me = async () => {
    const salesId = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, salesId));
  };
  const isIntegrator = async () => (await me())?.role === "integrator";
  const requireConfigurator = async () => {
    const sale = await me();
    if (sale && !["owner", "head", "integrator"].includes(sale.role)) {
      throw forbidden();
    }
    return sale;
  };
  const getApp = async (id: Identifier) =>
    (await all<DeveloperApp>("developer_apps")).find((app) => same(app.id, id));

  const revokeKeys = async (appId: Identifier) => {
    for (const key of (await all<ApiKey>("api_keys")).filter(
      (k) => same(k.app_id, appId) && !k.revoked_at,
    )) {
      await baseDataProvider.update("api_keys", {
        id: key.id,
        data: { revoked_at: nowIso() },
        previousData: key,
      });
    }
  };
  const removeWebhooks = async (appId: Identifier) => {
    for (const webhook of (await all<Webhook>("webhooks")).filter((w) =>
      same(w.app_id, appId),
    )) {
      await baseDataProvider.delete("webhooks", {
        id: webhook.id,
        previousData: webhook,
      });
    }
  };

  const methods = {
    async installDeveloperApp(id: Identifier): Promise<InstalledApp> {
      const sale = await requireConfigurator();
      const app = await getApp(id);
      if (!app) throw new Error("market.errors.not_found");
      if (app.installed_at) throw new Error("market.errors.installed");
      const key = `dcrm_${randomHex(64)}`;
      const writes = app.scopes.some(
        (scope) =>
          scope.endsWith(":write") || scope === "tasks" || scope === "webhooks",
      );
      const { data: keyRow } = await baseDataProvider.create<ApiKey>(
        "api_keys",
        {
          data: {
            name: `Приложение «${app.name}»`,
            prefix: key.slice(0, 12),
            scope: writes ? "write" : "read",
            scopes: [...app.scopes],
            app_id: app.id,
            created_by: sale?.id ?? null,
            created_at: nowIso(),
            last_used_at: null,
            revoked_at: null,
          },
        },
      );
      let webhook: Webhook | null = null;
      if (
        app.scopes.includes("webhooks") &&
        app.webhook_url &&
        app.webhook_events.length
      ) {
        ({ data: webhook } = await baseDataProvider.create<Webhook>(
          "webhooks",
          {
            data: {
              name: app.name,
              url: app.webhook_url,
              events: [...app.webhook_events],
              secret: randomHex(64),
              is_active: true,
              failure_count: 0,
              last_error: null,
              last_success_at: null,
              last_failure_at: null,
              disabled_at: null,
              app_id: app.id,
              created_at: nowIso(),
            },
          },
        ));
      }
      await baseDataProvider.update("developer_apps", {
        id: app.id,
        data: {
          installed_at: nowIso(),
          installed_by: sale?.id ?? null,
          api_key_id: keyRow.id,
          uninstalled_at: null,
        },
        previousData: app,
      });
      return {
        app_id: app.id,
        key,
        key_prefix: keyRow.prefix,
        scopes: [...app.scopes],
        webhook_id: webhook?.id ?? null,
        webhook_secret: webhook?.secret ?? null,
      };
    },
    async uninstallDeveloperApp(id: Identifier): Promise<void> {
      await requireConfigurator();
      const app = await getApp(id);
      if (!app?.installed_at) return;
      await baseDataProvider.update("developer_apps", {
        id: app.id,
        data: {
          installed_at: null,
          api_key_id: null,
          uninstalled_at: nowIso(),
        },
        previousData: app,
      });
      await revokeKeys(app.id);
      await removeWebhooks(app.id);
    },
    async importAppManifest(manifest: AppManifest): Promise<Identifier> {
      const sale = await requireConfigurator();
      const checked = validateManifest(manifest);
      if (!checked.ok) throw new Error(checked.errors[0].key);
      const { manifest: m } = checked;
      const data = {
        slug: m.id,
        name: m.name,
        description: m.description ?? null,
        developer_name: m.developer.name,
        developer_contact: m.developer.contact ?? null,
        website_url: m.developer.website ?? null,
        settings_url: m.settings_url ?? null,
        scopes: m.scopes,
        webhook_url: m.webhook?.url ?? null,
        webhook_events: m.webhook?.events ?? [],
      };
      const existing = (await all<DeveloperApp>("developer_apps")).find(
        (app) => app.slug === m.id,
      );
      if (existing?.installed_at) throw new Error("market.errors.installed");
      if (existing) {
        await baseDataProvider.update("developer_apps", {
          id: existing.id,
          data,
          previousData: existing,
        });
        return existing.id;
      }
      const { data: created } = await baseDataProvider.create<DeveloperApp>(
        "developer_apps",
        {
          data: {
            ...data,
            installed_at: null,
            installed_by: null,
            api_key_id: null,
            uninstalled_at: null,
            created_by: sale?.id ?? null,
            created_at: nowIso(),
          },
        },
      );
      return created.id;
    },
    async setIntegratorAccess(
      salesId: Identifier,
      expiresAt: string | null,
      readMessages: boolean,
    ): Promise<void> {
      const sale = await me();
      if (sale && sale.role !== "owner") throw forbidden();
      const target = (await all<Sale>("sales")).find((s) =>
        same(s.id, salesId),
      );
      if (!target || target.role !== "integrator") {
        throw new Error("market.errors.not_found");
      }
      await baseDataProvider.update("sales", {
        id: target.id,
        data: { access_expires_at: expiresAt, can_read_messages: readMessages },
        previousData: target,
      });
    },
  };

  const readOnly = (resource: string): ResourceCallbacks => ({
    resource,
    beforeCreate: async (params) => {
      if (await isIntegrator()) throw forbidden("market.errors.read_only");
      return params;
    },
    beforeUpdate: async (params) => {
      if (await isIntegrator()) throw forbidden("market.errors.read_only");
      return params;
    },
    beforeDelete: async (params) => {
      if (await isIntegrator()) throw forbidden("market.errors.read_only");
      return params;
    },
  });
  const hidden = (
    resource: string,
    visible: (sale: Sale) => boolean,
  ): ResourceCallbacks => ({
    resource,
    afterGetList: async (result: GetListResult) => {
      const sale = await me();
      return sale?.role === "integrator" && !visible(sale)
        ? { ...result, data: [], total: 0 }
        : result;
    },
  });

  const callbacks: ResourceCallbacks[] = [
    ...READ_ONLY_FOR_INTEGRATOR.map(readOnly),
    hidden("deal_payments", () => false),
    hidden("messages", (sale) => !!sale.can_read_messages),
    {
      resource: "developer_apps",
      beforeSave: async (params) => {
        await requireConfigurator();
        return params;
      },
      beforeUpdate: async (params) => {
        const previous = await getApp(params.id);
        const changes = params.data as Partial<DeveloperApp>;
        const touched = (
          ["scopes", "webhook_url", "webhook_events", "slug"] as const
        )
          .filter((field) => field in changes)
          .some(
            (field) =>
              JSON.stringify(changes[field]) !==
              JSON.stringify(previous?.[field]),
          );
        if (
          previous?.installed_at &&
          changes.installed_at !== null &&
          touched
        ) {
          throw new Error("market.errors.installed");
        }
        return params;
      },
      beforeDelete: async (params) => {
        await requireConfigurator();
        await revokeKeys(params.id);
        await removeWebhooks(params.id);
        return params;
      },
    },
  ];

  return { methods, callbacks };
};
