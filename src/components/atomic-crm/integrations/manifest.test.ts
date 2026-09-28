import { describe, expect, it } from "vitest";

import {
  appToManifest,
  canCallRoute,
  isWriteScope,
  keyScopes,
  parseManifest,
  slugify,
  validateManifest,
} from "./manifest";
import type { DeveloperApp } from "./types";

const VALID = {
  manifest_version: 1,
  id: "roistat-like",
  name: "Сквозная аналитика",
  description: "Источники заявок и выручка",
  developer: {
    name: "Digital Agency",
    contact: "hello@agency.kz",
    website: "https://agency.kz",
  },
  settings_url: "https://agency.kz/app",
  scopes: ["webhooks", "deals:read", "deals:read"],
  webhook: { url: "https://agency.kz/hooks", events: ["deal.created"] },
};

const errorKeys = (value: unknown) => {
  const result = validateManifest(value);
  return result.ok ? [] : result.errors.map((error) => error.key);
};

describe("parseManifest", () => {
  it("reads a valid manifest and normalizes its scopes", () => {
    const result = parseManifest(JSON.stringify(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.scopes).toEqual(["deals:read", "webhooks"]);
    expect(result.manifest.developer).toEqual(VALID.developer);
    expect(result.manifest.webhook).toEqual(VALID.webhook);
  });

  it("refuses empty text and broken JSON", () => {
    expect(parseManifest("  ")).toEqual({
      ok: false,
      errors: [{ key: "market.manifest.errors.empty" }],
    });
    expect(parseManifest("{ id: 1")).toEqual({
      ok: false,
      errors: [{ key: "market.manifest.errors.json" }],
    });
    expect(errorKeys([1, 2])).toEqual(["market.manifest.errors.not_object"]);
  });

  it("lists every problem", () => {
    expect(
      errorKeys({
        manifest_version: 2,
        id: "Bad Id",
        developer: {},
        settings_url: "ftp://x",
        scopes: ["deals:read", "root"],
        webhook: { url: "https://x.kz", events: ["deal.deleted"] },
      }),
    ).toEqual([
      "market.manifest.errors.version",
      "market.manifest.errors.id",
      "market.manifest.errors.name",
      "market.manifest.errors.developer",
      "market.manifest.errors.url",
      "market.manifest.errors.unknown_scopes",
      "market.manifest.errors.unknown_events",
      "market.manifest.errors.webhook_scope",
    ]);
  });

  it("needs scopes and a complete webhook", () => {
    expect(errorKeys({ ...VALID, scopes: [] })).toContain(
      "market.manifest.errors.scopes",
    );
    expect(errorKeys({ ...VALID, webhook: { url: "https://x.kz" } })).toEqual([
      "market.manifest.errors.webhook",
    ]);
    expect(errorKeys({ ...VALID, webhook: null })).toEqual([]);
  });
});

describe("appToManifest", () => {
  it("exports what an import reads back", () => {
    const app: DeveloperApp = {
      id: 3,
      slug: "roistat-like",
      name: "Сквозная аналитика",
      description: null,
      developer_name: "Digital Agency",
      developer_contact: "hello@agency.kz",
      website_url: null,
      settings_url: "https://agency.kz/app",
      scopes: ["webhooks", "deals:read"],
      webhook_url: "https://agency.kz/hooks",
      webhook_events: ["deal.won"],
      installed_at: "2026-10-01T10:00:00Z",
      created_at: "2026-10-01T10:00:00Z",
    };
    const manifest = appToManifest(app);
    expect(manifest).toEqual({
      manifest_version: 1,
      id: "roistat-like",
      name: "Сквозная аналитика",
      developer: { name: "Digital Agency", contact: "hello@agency.kz" },
      settings_url: "https://agency.kz/app",
      scopes: ["deals:read", "webhooks"],
      webhook: { url: "https://agency.kz/hooks", events: ["deal.won"] },
    });
    expect(validateManifest(manifest)).toEqual({ ok: true, manifest });
  });
});

describe("scopes", () => {
  it("keeps the rights of the keys of stage 20", () => {
    expect(keyScopes({ scope: "read" })).toEqual([
      "deals:read",
      "patients:read",
      "settings:read",
    ]);
    expect(canCallRoute({ scope: "read" }, "list_pipelines")).toBe(true);
    expect(canCallRoute({ scope: "read" }, "create_deal")).toBe(false);
    expect(canCallRoute({ scope: "write", scopes: [] }, "create_deal")).toBe(
      true,
    );
    expect(canCallRoute({ scope: "write" }, "create_pipeline")).toBe(false);
  });

  it("checks the fine scopes of an app key per method", () => {
    const key = {
      scope: "write" as const,
      scopes: ["settings:read", "pipelines:write", "tasks"],
    };
    expect(canCallRoute(key, "get_account")).toBe(true);
    expect(canCallRoute(key, "create_stage_trigger")).toBe(true);
    expect(canCallRoute(key, "create_task")).toBe(true);
    expect(canCallRoute(key, "list_deals")).toBe(false);
    expect(canCallRoute(key, "send_message")).toBe(false);
    expect(canCallRoute(key, "create_custom_field")).toBe(false);
  });

  it("marks the scopes that change data", () => {
    expect(isWriteScope("deals:read")).toBe(false);
    expect(isWriteScope("pipelines:write")).toBe(true);
    expect(isWriteScope("webhooks")).toBe(true);
  });
});

describe("slugify", () => {
  it("makes an id of a Russian or Kazakh name", () => {
    expect(slugify("Сквозная аналитика")).toBe("skvoznaya-analitika");
    expect(slugify("Roistat-like: v2!")).toBe("roistat-like-v2");
    expect(slugify("Қазақ Telecom")).toBe("kazak-telecom");
    expect(slugify("!!!")).toBe("app");
  });
});
