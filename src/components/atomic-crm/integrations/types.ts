import type { Identifier } from "ra-core";

import type { WebhookEvent } from "../pipeline-automation/types";

/** Fine scopes of an API key or an app (public.api_keys.scopes, stage 25) */
export const APP_SCOPES = [
  "deals:read",
  "deals:write",
  "patients:read",
  "patients:write",
  "messages:read",
  "messages:write",
  "tasks",
  "settings:read",
  "settings:write",
  "pipelines:write",
  "salesbot:write",
  "webhooks",
] as const;
export type AppScope = (typeof APP_SCOPES)[number];

/** An app of a developer registered in the clinic (public.developer_apps) */
export type DeveloperApp = {
  id: Identifier;
  /** Id of its manifest, the same in every clinic */
  slug: string;
  name: string;
  description?: string | null;
  developer_name: string;
  developer_contact?: string | null;
  website_url?: string | null;
  /** Page of the app where the clinic sets it up */
  settings_url?: string | null;
  scopes: AppScope[];
  webhook_url?: string | null;
  webhook_events: WebhookEvent[];
  installed_at?: string | null;
  installed_by?: Identifier | null;
  api_key_id?: Identifier | null;
  uninstalled_at?: string | null;
  created_by?: Identifier | null;
  created_at: string;
};

/** public.install_developer_app: the key and the webhook secret, once */
export type InstalledApp = {
  app_id: Identifier;
  key: string;
  key_prefix: string;
  scopes: AppScope[];
  webhook_id: Identifier | null;
  webhook_secret: string | null;
};

/** The JSON an integrator carries from one clinic to another */
export type AppManifest = {
  manifest_version: 1;
  id: string;
  name: string;
  description?: string;
  developer: { name: string; contact?: string; website?: string };
  settings_url?: string;
  scopes: AppScope[];
  webhook?: { url: string; events: WebhookEvent[] } | null;
};
