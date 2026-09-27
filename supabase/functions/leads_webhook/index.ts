import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  isTestPing,
  leadCorsHeaders,
  parseFields,
  toLead,
} from "../_shared/leads.ts";

const json = (status: number, data: Record<string, unknown>) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...leadCorsHeaders },
  });

/**
 * Requests from the clinic's website, Tilda and 2GIS (spec §5):
 *   POST /functions/v1/leads_webhook?token=<lead token of the clinic>
 * JSON or form body with name, phone, source, service, comment, utm_*
 * (Tilda's Name / Phone / Textarea... are understood too). The token
 * identifies the clinic; everything else happens in public.ingest_lead.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: leadCorsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, code: "method_not_allowed" });
  }
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json(401, { ok: false, code: "missing_token" });

  const contentType = req.headers.get("content-type");
  let fields: Record<string, unknown> | null;
  if (contentType?.includes("multipart/form-data")) {
    fields = {};
    try {
      for (const [key, value] of await req.formData()) {
        if (typeof value === "string") fields[key] = value;
      }
    } catch {
      fields = null;
    }
  } else {
    fields = parseFields(contentType, await req.text());
  }
  if (!fields) return json(400, { ok: false, code: "invalid_body" });

  // Tilda checks the webhook address with test=test and expects a 200
  if (isTestPing(fields)) return json(200, { ok: true, test: true });

  const { data, error } = await supabaseAdmin.rpc("ingest_lead", {
    token,
    lead: toLead(fields),
  });
  if (error?.code === "28000") {
    return json(401, { ok: false, code: "unknown_token" });
  }
  if (error?.code === "22023") {
    return json(400, { ok: false, code: "phone_required" });
  }
  if (error) {
    console.error("ingest_lead failed", error);
    return json(500, { ok: false, code: "internal_error" });
  }
  return json(200, { ok: true, duplicate: !!data?.duplicate });
});
