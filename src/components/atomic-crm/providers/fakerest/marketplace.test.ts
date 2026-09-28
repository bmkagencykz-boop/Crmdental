import { beforeAll, describe, expect, it } from "vitest";

import type { DeveloperApp } from "../../integrations/types";
import type { ApiKey, Webhook } from "../../pipeline-automation/types";
import type { Message, Sale } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
});

const setup = (as: "owner" | "integrator" = "owner") => {
  const db = generateData();
  const me =
    as === "owner"
      ? db.sales.find((sale) => sale.role === "owner")!
      : db.sales.find((sale) => sale.role === "integrator")!;
  return {
    db,
    me,
    dataProvider: createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: {
        getIdentity: async () => ({ id: me.id, fullName: me.first_name }),
      },
    }),
  };
};

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

describe("demo marketplace", () => {
  it("has an integrator and an installed developer app with its key and webhook", () => {
    const { db } = setup();
    const integrator = db.sales.find((sale) => sale.role === "integrator");
    expect(integrator?.access_expires_at).toBeTruthy();
    expect(integrator?.can_read_messages).toBe(false);
    const [app] = db.developer_apps;
    expect(app.name).toBe("Сквозная аналитика Roistat-like");
    expect(app.developer_name).toBe("Digital Agency");
    expect(app.installed_at).toBeTruthy();
    expect(db.api_keys.some((key) => key.app_id === app.id)).toBe(true);
    expect(db.webhooks.some((webhook) => webhook.app_id === app.id)).toBe(true);
  });

  it("uninstalls and reinstalls an app: key revoked, webhook removed, new key", async () => {
    const { dataProvider } = setup("integrator");
    await dataProvider.uninstallDeveloperApp(1);
    const keys = await list<ApiKey>(dataProvider, "api_keys");
    expect(keys.filter((key) => key.app_id === 1 && !key.revoked_at)).toEqual(
      [],
    );
    expect(
      (await list<Webhook>(dataProvider, "webhooks")).some(
        (webhook) => webhook.app_id === 1,
      ),
    ).toBe(false);
    const installed = await dataProvider.installDeveloperApp(1);
    expect(installed.key).toMatch(/^dcrm_/);
    expect(installed.webhook_secret).toBeTruthy();
    const [app] = await list<DeveloperApp>(dataProvider, "developer_apps");
    expect(app.installed_at).toBeTruthy();
    await expect(dataProvider.installDeveloperApp(1)).rejects.toThrow(
      "market.errors.installed",
    );
  });

  it("imports a manifest as a new app", async () => {
    const { dataProvider } = setup();
    const id = await dataProvider.importAppManifest({
      manifest_version: 1,
      id: "clinic-setup",
      name: "Настройка клиники",
      developer: { name: "Digital Agency" },
      scopes: ["pipelines:write", "settings:read"],
      webhook: null,
    });
    const apps = await list<DeveloperApp>(dataProvider, "developer_apps");
    expect(apps.find((app) => app.id === id)?.slug).toBe("clinic-setup");
  });

  it("lets the integrator configure but only read the deals, without messages and payments", async () => {
    const { dataProvider } = setup("integrator");
    await expect(
      dataProvider.update("deals", {
        id: 1,
        data: { name: "x" },
        previousData: { id: 1 },
      }),
    ).rejects.toThrow("market.errors.read_only");
    await expect(
      dataProvider.delete("patients", { id: 1, previousData: { id: 1 } }),
    ).rejects.toThrow("market.errors.read_only");
    expect(await list<Message>(dataProvider, "messages")).toEqual([]);
    expect(await list(dataProvider, "deal_payments")).toEqual([]);
    expect((await list(dataProvider, "deals")).length).toBeGreaterThan(0);
    await dataProvider.create("webhooks", {
      data: { url: "https://agency.kz/hook", events: ["deal.created"] },
    });
  });

  it("lets only the owner open the conversations to the integrator", async () => {
    const owner = setup();
    const integrator = owner.db.sales.find(
      (sale) => sale.role === "integrator",
    )!;
    await owner.dataProvider.setIntegratorAccess(integrator.id, null, true);
    const sales = await list<Sale>(owner.dataProvider, "sales");
    expect(sales.find((sale) => sale.id === integrator.id)).toMatchObject({
      access_expires_at: null,
      can_read_messages: true,
    });
    const other = setup("integrator");
    await expect(
      other.dataProvider.setIntegratorAccess(other.me.id, null, true),
    ).rejects.toThrow();
  });
});
