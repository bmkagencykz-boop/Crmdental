import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import {
  ApiInputError,
  apiHeaders,
  bearerKey,
  mapDbError,
  matchApiRoute,
  parseBody,
  rpcCall,
  successStatus,
  WRITE_ROUTES,
} from "../_shared/publicApi.ts";

const json = (
  status: number,
  data: unknown,
  extraHeaders: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...apiHeaders, ...extraHeaders },
  });

const fail = (status: number, code: string, message: string) =>
  json(
    status,
    { error: { code, message } },
    status === 429 ? { "Retry-After": "60" } : {},
  );

/**
 * Public REST API of a clinic (verify_jwt = false):
 *   Authorization: Bearer <API key from Settings → API и вебхуки>
 *   GET /api/deals, GET /api/deals/:id, POST /api/deals, PATCH /api/deals/:id,
 *   POST /api/deals/:id/notes, GET /api/patients, POST /api/patients,
 *   GET /api/pipelines
 * The database functions public.api_* resolve the clinic from the key hash,
 * check the scope and the rate limit (60 requests per minute per key) and
 * only touch that clinic. Documentation: docs/stages/20-digital-pipeline.md.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: apiHeaders });
  }
  const url = new URL(req.url);
  const match = matchApiRoute(req.method, url.pathname);
  if ("error" in match) {
    return match.error === "not_found"
      ? fail(404, "not_found", "Нет такого метода API")
      : fail(405, "method_not_allowed", "Метод не поддерживается");
  }
  const apiKey = bearerKey(req.headers.get("Authorization"));
  if (!apiKey) {
    return fail(
      401,
      "invalid_key",
      "Нужен заголовок Authorization: Bearer <API-ключ>",
    );
  }

  let call: ReturnType<typeof rpcCall>;
  try {
    const body = WRITE_ROUTES.includes(match.route)
      ? parseBody(await req.text())
      : undefined;
    call = rpcCall(match.route, apiKey, {
      id: match.id,
      search: url.searchParams,
      body,
    });
  } catch (error) {
    if (error instanceof ApiInputError) {
      return fail(400, "invalid_input", error.message);
    }
    throw error;
  }

  const { data, error } = await supabaseAdmin.rpc(call.fn, call.args);
  if (error) {
    const mapped = mapDbError(error);
    if (mapped.status === 500) {
      console.error(`${call.fn} failed`, error);
    }
    return fail(mapped.status, mapped.code, mapped.message);
  }
  return json(successStatus(match.route, data), data);
});
