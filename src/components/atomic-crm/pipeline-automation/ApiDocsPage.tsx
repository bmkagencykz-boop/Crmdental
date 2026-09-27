import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useDataProvider, useTranslate } from "ra-core";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { CrmDataProvider } from "../providers/types";
import { WEBHOOK_EVENTS } from "./types";
import { curlExamples, eventLabelKey } from "./webhooks";

const ENDPOINTS = [
  { method: "GET", path: "/deals", key: "list_deals", scope: "read" },
  { method: "GET", path: "/deals/:id", key: "get_deal", scope: "read" },
  { method: "POST", path: "/deals", key: "create_deal", scope: "write" },
  { method: "PATCH", path: "/deals/:id", key: "update_deal", scope: "write" },
  {
    method: "POST",
    path: "/deals/:id/notes",
    key: "add_deal_note",
    scope: "write",
  },
  { method: "GET", path: "/patients", key: "list_patients", scope: "read" },
  { method: "POST", path: "/patients", key: "create_patient", scope: "write" },
  { method: "GET", path: "/pipelines", key: "list_pipelines", scope: "read" },
] as const;

const ERRORS = [
  { status: 400, code: "invalid_input" },
  { status: 401, code: "invalid_key" },
  { status: 403, code: "read_only_key" },
  { status: 404, code: "not_found" },
  { status: 422, code: "invalid_reference" },
  { status: 422, code: "rule_violation" },
  { status: 429, code: "rate_limited" },
] as const;

const VERIFY_EXAMPLE = `// Node.js: проверка подписи вебхука
import { createHmac, timingSafeEqual } from "node:crypto";

app.post("/webhooks/dentalcrm", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + createHmac("sha256", process.env.DENTALCRM_SECRET)
    .update(req.body) // сырое тело запроса, без повторной сериализации
    .digest("hex");
  const received = req.get("X-DentalCRM-Signature") ?? "";
  if (received.length !== expected.length ||
      !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return res.sendStatus(401);
  }
  const event = JSON.parse(req.body);
  // event.delivery_id — повторная доставка приходит с тем же id
  res.sendStatus(200);
});`;

const PAYLOAD_EXAMPLE = `{
  "delivery_id": 1842,
  "event": "deal.stage_changed",
  "occurred_at": "2026-10-14T09:30:12.52+05:00",
  "organization_id": 7,
  "data": {
    "deal_id": 123,
    "patient_id": 88,
    "previous_stage_id": 2,
    "deal": { "id": 123, "name": "Имплантация", "stage_id": 3, "stage_name": "Записан", ... }
  }
}`;

/**
 * «Документация API» (link of Settings → API и вебхуки): the public REST
 * API and the webhooks, with curl examples on the clinic's own address.
 * The same text as docs/stages/20-digital-pipeline.md.
 */
export const ApiDocsPage = () => {
  const translate = useTranslate();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data: baseUrl = "" } = useQuery({
    queryKey: ["api_base_url"],
    queryFn: () => dataProvider.getApiBaseUrl(),
  });
  const examples = curlExamples(
    baseUrl || "https://<project>.supabase.co/functions/v1/api",
  );

  return (
    <article
      className="mx-auto flex max-w-4xl flex-col gap-6 pb-12"
      data-testid="api-docs"
    >
      <Link
        to="/settings?section=api"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {translate("api.settings.section")}
      </Link>
      <header>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">
          {translate("api.docs.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate("api.docs.intro")}
        </p>
      </header>

      <DocSection title={translate("api.docs.base_url")}>
        <Code>{baseUrl}</Code>
      </DocSection>

      <DocSection title={translate("api.docs.auth_title")}>
        <p>{translate("api.docs.auth_text")}</p>
        <Code>{"Authorization: Bearer dcrm_…"}</Code>
        <p>{translate("api.docs.scopes_text")}</p>
        <p>{translate("api.docs.limit_text")}</p>
      </DocSection>

      <DocSection title={translate("api.docs.endpoints_title")}>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <tbody>
              {ENDPOINTS.map((endpoint) => (
                <tr
                  key={`${endpoint.method} ${endpoint.path}`}
                  className="border-b last:border-0"
                >
                  <td className="px-3 py-2 font-mono text-xs font-semibold whitespace-nowrap">
                    {endpoint.method}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                    /api{endpoint.path}
                  </td>
                  <td className="px-3 py-2">
                    {translate(`api.docs.endpoints.${endpoint.key}`)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {translate(`api.keys.scopes.${endpoint.scope}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>{translate("api.docs.lists_text")}</p>
      </DocSection>

      <DocSection title={translate("api.docs.examples_title")}>
        {(
          [
            ["list_deals", examples.listDeals],
            ["get_deal", examples.getDeal],
            ["create_deal", examples.createDeal],
            ["update_deal", examples.updateDeal],
            ["add_deal_note", examples.addNote],
            ["list_patients", examples.listPatients],
            ["create_patient", examples.createPatient],
            ["list_pipelines", examples.listPipelines],
          ] as const
        ).map(([key, example]) => (
          <div key={key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {translate(`api.docs.endpoints.${key}`)}
            </span>
            <Code>{example}</Code>
          </div>
        ))}
      </DocSection>

      <DocSection title={translate("api.docs.errors_title")}>
        <p>{translate("api.docs.errors_text")}</p>
        <Code>{`{ "error": { "code": "rate_limited", "message": "…" } }`}</Code>
        <ul className="flex flex-col gap-1">
          {ERRORS.map((error) => (
            <li key={error.code}>
              <span className="font-mono text-xs font-semibold">
                {error.status} {error.code}
              </span>{" "}
              — {translate(`api.docs.errors.${error.code}`)}
            </li>
          ))}
        </ul>
      </DocSection>

      <DocSection title={translate("api.docs.webhooks_title")}>
        <p>{translate("api.docs.webhooks_text")}</p>
        <ul className="flex flex-wrap gap-1.5">
          {WEBHOOK_EVENTS.map((event) => (
            <li key={event} className="rounded-md border px-2 py-0.5 text-xs">
              <span className="font-mono">{event}</span> —{" "}
              {translate(eventLabelKey(event))}
            </li>
          ))}
        </ul>
        <Code>{PAYLOAD_EXAMPLE}</Code>
        <p>{translate("api.docs.signature_text")}</p>
        <Code>{VERIFY_EXAMPLE}</Code>
        <p>{translate("api.docs.retry_text")}</p>
      </DocSection>
    </article>
  );
};

ApiDocsPage.path = "/api-docs";

const DocSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3 text-sm leading-relaxed">
    <h2 className="text-lg font-semibold">{title}</h2>
    {children}
  </section>
);

const Code = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-2 text-xs leading-relaxed">
    <code>{children}</code>
  </pre>
);
