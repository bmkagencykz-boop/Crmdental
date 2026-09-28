import type { ApiKey, Webhook } from "../../../pipeline-automation/types";
import type { DeveloperApp } from "../../../integrations/types";
import type { Sale } from "../../../types";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Email of the demo integrator (log in with it to see its access) */
export const DEMO_INTEGRATOR_EMAIL = "integrator@digital-agency.kz";

/**
 * Marketplace of the demo clinic (stage 25): an agency's technical account
 * (integrator, access for 30 more days, no access to the conversations) and
 * the app it installed — «Сквозная аналитика Roistat-like» — with its API key
 * and its webhook. Wazzup24 is connected (see the messenger demo), Sipuni
 * available, Dentist Plus «скоро».
 */
export const generateMarketplace = (db: Db) => {
  const now = Date.now();
  const iso = (time: number) => new Date(time).toISOString();
  const integratorId = Math.max(...db.sales.map((sale) => Number(sale.id))) + 1;
  const integrator: Sale = {
    id: integratorId,
    user_id: String(integratorId),
    first_name: "Тимур",
    last_name: "Digital Agency",
    email: DEMO_INTEGRATOR_EMAIL,
    secondary_emails: [],
    password: "demo",
    organization_id: 1,
    role: "integrator",
    administrator: false,
    disabled: false,
    access_expires_at: iso(now + 30 * DAY),
    can_read_messages: false,
  };
  db.sales.push(integrator);

  const installedAt = iso(now - 12 * DAY);
  const keyId = Math.max(0, ...db.api_keys.map((key) => Number(key.id))) + 1;
  const webhookId =
    Math.max(0, ...db.webhooks.map((webhook) => Number(webhook.id))) + 1;
  const app: DeveloperApp = {
    id: 1,
    slug: "roistat-like-analytics",
    name: "Сквозная аналитика Roistat-like",
    description:
      "Связывает рекламу и выручку клиники: забирает сделки и оплаты, считает стоимость пациента по каждому каналу и показывает окупаемость Instagram, 2GIS и сайта.",
    developer_name: "Digital Agency",
    developer_contact: "hello@digital-agency.kz",
    website_url: "https://digital-agency.kz",
    settings_url: "https://digital-agency.kz/analytics/dentalcrm",
    scopes: ["deals:read", "patients:read", "settings:read", "webhooks"],
    webhook_url: "https://digital-agency.kz/analytics/hooks/dentalcrm",
    webhook_events: ["deal.created", "deal.stage_changed", "payment.added"],
    installed_at: installedAt,
    installed_by: integratorId,
    api_key_id: keyId,
    uninstalled_at: null,
    created_by: integratorId,
    created_at: installedAt,
  };
  db.developer_apps = [app];
  db.api_keys.push({
    id: keyId,
    name: `Приложение «${app.name}»`,
    prefix: "dcrm_8be41d0",
    scope: "write",
    scopes: [...app.scopes],
    app_id: app.id,
    created_by: integratorId,
    created_at: installedAt,
    last_used_at: iso(now - 20 * 60 * 1000),
    revoked_at: null,
  } satisfies ApiKey);
  db.webhooks.push({
    id: webhookId,
    name: app.name,
    url: app.webhook_url!,
    events: [...app.webhook_events],
    secret: "5d0c3b8e2a7f4e1d9c6b3a0f8e5d2c9b6a3f0e7d4c1b8a5f2e9d6c3b0a7f4e1d",
    is_active: true,
    failure_count: 0,
    last_error: null,
    last_success_at: iso(now - 40 * 60 * 1000),
    last_failure_at: null,
    disabled_at: null,
    app_id: app.id,
    created_at: installedAt,
  } satisfies Webhook);
};
