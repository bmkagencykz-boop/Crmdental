import {
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from "../pipeline-automation/types";
import {
  APP_SCOPES,
  type AppManifest,
  type AppScope,
  type DeveloperApp,
} from "./types";

/**
 * App manifests and API scopes (stage 25). The database checks the same
 * (public.import_app_manifest, private.api_authorize); this gives the user
 * a clear message before anything is sent.
 */

/** Methods of the public API and the scope each one needs */
export const ROUTE_SCOPES = {
  list_deals: "deals:read",
  get_deal: "deals:read",
  create_deal: "deals:write",
  update_deal: "deals:write",
  add_deal_note: "deals:write",
  list_patients: "patients:read",
  create_patient: "patients:write",
  list_pipelines: "settings:read",
  get_account: "settings:read",
  create_pipeline: "pipelines:write",
  update_pipeline: "pipelines:write",
  list_stages: "settings:read",
  create_stage: "pipelines:write",
  update_stage: "pipelines:write",
  list_stage_triggers: "settings:read",
  create_stage_trigger: "pipelines:write",
  update_stage_trigger: "pipelines:write",
  delete_stage_trigger: "pipelines:write",
  list_custom_fields: "settings:read",
  create_custom_field: "settings:write",
  list_tasks: "tasks",
  create_task: "tasks",
  list_messages: "messages:read",
  send_message: "messages:write",
} as const satisfies Record<string, AppScope>;
export type ApiRouteName = keyof typeof ROUTE_SCOPES;

/** Scopes of a key: its own, or those of a read / write key of stage 20 */
export const keyScopes = (key: {
  scope: "read" | "write";
  scopes?: readonly string[] | null;
}): AppScope[] => {
  if (key.scopes?.length) return key.scopes as AppScope[];
  return key.scope === "write"
    ? [
        "deals:read",
        "deals:write",
        "patients:read",
        "patients:write",
        "settings:read",
      ]
    : ["deals:read", "patients:read", "settings:read"];
};

/** May this key call this method of the API? (same as private.api_authorize) */
export const canCallRoute = (
  key: { scope: "read" | "write"; scopes?: readonly string[] | null },
  route: ApiRouteName,
) => keyScopes(key).includes(ROUTE_SCOPES[route]);

/** Translation key of the name of a scope («deals:read» → market.scopes.deals_read) */
export const scopeLabelKey = (scope: string) =>
  `market.scopes.${scope.replace(":", "_")}`;

/** Scopes that change data (shown in a warning colour before installing) */
export const isWriteScope = (scope: AppScope) =>
  scope.endsWith(":write") || scope === "tasks" || scope === "webhooks";

const isAppScope = (value: unknown): value is AppScope =>
  APP_SCOPES.includes(value as AppScope);
const isWebhookEvent = (value: unknown): value is WebhookEvent =>
  WEBHOOK_EVENTS.includes(value as WebhookEvent);

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const URL_PATTERN = /^https?:\/\/[^/\s]+/;

const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  ә: "a",
  ғ: "g",
  қ: "k",
  ң: "n",
  ө: "o",
  ұ: "u",
  ү: "u",
  һ: "h",
  і: "i",
};

/** «Сквозная аналитика» → «skvoznaya-analitika» (id of a new app) */
export const slugify = (name: string) =>
  [...name.toLowerCase()]
    .map((char) => TRANSLIT[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "app";

export type ManifestError = { key: string; args?: Record<string, unknown> };
export type ManifestResult =
  | { ok: true; manifest: AppManifest }
  | { ok: false; errors: ManifestError[] };

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Checks a manifest object; every problem is listed, not only the first */
export const validateManifest = (value: unknown): ManifestResult => {
  const errors: ManifestError[] = [];
  const e = (key: string, args?: Record<string, unknown>) =>
    errors.push({ key: `market.manifest.errors.${key}`, args });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    e("not_object");
    return { ok: false, errors };
  }
  const raw = value as Record<string, unknown>;
  if (raw.manifest_version != null && raw.manifest_version !== 1) {
    e("version", { version: String(raw.manifest_version) });
  }
  const id = text(raw.id);
  if (!id || !SLUG_PATTERN.test(id)) e("id");
  const name = text(raw.name);
  if (!name) e("name");
  const developer =
    raw.developer && typeof raw.developer === "object"
      ? (raw.developer as Record<string, unknown>)
      : null;
  const developerName = text(developer?.name);
  if (!developerName) e("developer");
  const website = text(developer?.website);
  if (website && !URL_PATTERN.test(website)) e("url", { field: "website" });
  const settingsUrl = text(raw.settings_url);
  if (settingsUrl && !URL_PATTERN.test(settingsUrl)) {
    e("url", { field: "settings_url" });
  }
  let scopes: AppScope[] = [];
  if (!Array.isArray(raw.scopes) || raw.scopes.length === 0) {
    e("scopes");
  } else {
    const unknown = raw.scopes.filter((scope) => !isAppScope(scope));
    if (unknown.length) e("unknown_scopes", { scopes: unknown.join(", ") });
    scopes = [...new Set(raw.scopes.filter(isAppScope))].sort();
  }
  let webhook: AppManifest["webhook"] = null;
  if (raw.webhook != null) {
    const hook =
      typeof raw.webhook === "object" && !Array.isArray(raw.webhook)
        ? (raw.webhook as Record<string, unknown>)
        : null;
    const url = text(hook?.url);
    const events = Array.isArray(hook?.events) ? hook.events : null;
    if (!hook || !url || !URL_PATTERN.test(url) || !events) {
      e("webhook");
    } else {
      const unknown = events.filter((event) => !isWebhookEvent(event));
      if (unknown.length) e("unknown_events", { events: unknown.join(", ") });
      if (events.length && !scopes.includes("webhooks")) {
        e("webhook_scope");
      }
      webhook = { url, events: [...new Set(events.filter(isWebhookEvent))] };
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: {
      manifest_version: 1,
      id: id!,
      name: name!,
      ...(text(raw.description) ? { description: text(raw.description) } : {}),
      developer: {
        name: developerName!,
        ...(text(developer?.contact)
          ? { contact: text(developer?.contact) }
          : {}),
        ...(website ? { website } : {}),
      },
      ...(settingsUrl ? { settings_url: settingsUrl } : {}),
      scopes,
      webhook,
    },
  };
};

/** The text pasted by the user */
export const parseManifest = (value: string): ManifestResult => {
  if (!value.trim()) {
    return { ok: false, errors: [{ key: "market.manifest.errors.empty" }] };
  }
  try {
    return validateManifest(JSON.parse(value));
  } catch {
    return { ok: false, errors: [{ key: "market.manifest.errors.json" }] };
  }
};

/** The manifest of an app of the clinic (export) */
export const appToManifest = (app: DeveloperApp): AppManifest => ({
  manifest_version: 1,
  id: app.slug,
  name: app.name,
  ...(app.description ? { description: app.description } : {}),
  developer: {
    name: app.developer_name,
    ...(app.developer_contact ? { contact: app.developer_contact } : {}),
    ...(app.website_url ? { website: app.website_url } : {}),
  },
  ...(app.settings_url ? { settings_url: app.settings_url } : {}),
  scopes: [...app.scopes].sort(),
  webhook:
    app.webhook_url && app.webhook_events.length
      ? { url: app.webhook_url, events: [...app.webhook_events] }
      : null,
});

export const manifestToJson = (manifest: AppManifest) =>
  JSON.stringify(manifest, null, 2);
