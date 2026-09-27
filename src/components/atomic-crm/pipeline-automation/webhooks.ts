import type { Webhook } from "./types";

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[.*\])$/i;

/**
 * Same as isAllowedWebhookUrl of the dispatcher
 * (supabase/functions/_shared/webhooks.ts): a public http(s) address, not the
 * platform's own network. The settings refuse the others right away.
 */
export const isPublicWebhookUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password &&
    !PRIVATE_HOST.test(url.hostname)
  );
};

export type WebhookState = "active" | "failing" | "disabled" | "off";

/**
 * What the settings show: on and working, on with errors, switched off by
 * the dispatcher after too many failures, or switched off by hand.
 */
export const webhookState = (
  webhook: Pick<Webhook, "is_active" | "failure_count" | "disabled_at">,
): WebhookState => {
  if (!webhook.is_active) return webhook.disabled_at ? "disabled" : "off";
  return webhook.failure_count > 0 ? "failing" : "active";
};

/** i18n keys cannot hold dots: deal.created → deal_created */
export const eventLabelKey = (event: string) =>
  `api.events.${event.replace(/\./g, "_")}`;

/** curl examples of the API docs, with the address of the clinic */
export const curlExamples = (baseUrl: string, key = "<API-ключ>") => {
  const auth = `-H "Authorization: Bearer ${key}"`;
  const json = `-H "Content-Type: application/json"`;
  return {
    listDeals: `curl ${auth} "${baseUrl}/deals?stage_id=2&updated_since=2026-10-01T00:00:00Z&per_page=50"`,
    getDeal: `curl ${auth} "${baseUrl}/deals/123"`,
    createDeal: `curl -X POST ${auth} ${json} "${baseUrl}/deals" \\\n  -d '{"name": "Имплантация", "plan_amount": 450000, "patient": {"first_name": "Асель", "phone": "+77011234567"}}'`,
    updateDeal: `curl -X PATCH ${auth} ${json} "${baseUrl}/deals/123" \\\n  -d '{"stage_id": 3, "appointment_at": "2026-10-15T10:30:00+05:00"}'`,
    addNote: `curl -X POST ${auth} ${json} "${baseUrl}/deals/123/notes" \\\n  -d '{"text": "Пациент подтвердил визит"}'`,
    listPatients: `curl ${auth} "${baseUrl}/patients?phone=87011234567"`,
    createPatient: `curl -X POST ${auth} ${json} "${baseUrl}/patients" \\\n  -d '{"first_name": "Асель", "last_name": "Нурланова", "phone": "+77011234567"}'`,
    listPipelines: `curl ${auth} "${baseUrl}/pipelines"`,
  };
};
