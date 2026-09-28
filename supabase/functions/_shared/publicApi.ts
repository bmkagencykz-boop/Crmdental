/**
 * Public REST API of a clinic (edge function api): routing, query
 * validation and error mapping. The work itself is done by the public.api_*
 * functions of the database (supabase/schemas/20_digital_pipeline.sql and,
 * for the configuration of the clinic, 25_marketplace.sql). Each function
 * checks the scope of the key it needs (deals:read, pipelines:write...).
 * No Deno import here so that it can be unit tested.
 */

export type ApiRoute =
  | "list_deals"
  | "get_deal"
  | "create_deal"
  | "update_deal"
  | "add_deal_note"
  | "list_patients"
  | "create_patient"
  | "list_pipelines"
  // Stage 25: configuration of the clinic, tasks, messages
  | "get_account"
  | "create_pipeline"
  | "update_pipeline"
  | "list_stages"
  | "create_stage"
  | "update_stage"
  | "list_stage_triggers"
  | "create_stage_trigger"
  | "update_stage_trigger"
  | "delete_stage_trigger"
  | "list_custom_fields"
  | "create_custom_field"
  | "list_tasks"
  | "create_task"
  | "list_messages"
  | "send_message";

export type RouteMatch =
  | { route: ApiRoute; id?: number }
  | { error: "not_found" | "method_not_allowed" };

/** Routes with a JSON body (a key without the scope gets 403 from the database) */
export const WRITE_ROUTES: ApiRoute[] = [
  "create_deal",
  "update_deal",
  "add_deal_note",
  "create_patient",
  "create_pipeline",
  "update_pipeline",
  "create_stage",
  "update_stage",
  "create_stage_trigger",
  "update_stage_trigger",
  "create_custom_field",
  "create_task",
  "send_message",
];

/**
 * "/functions/v1/api/deals/12/notes" (or "/api/deals/12/notes", as the edge
 * runtime passes it) → ["deals", "12", "notes"]
 */
export const pathSegments = (pathname: string) => {
  const parts = pathname.split("/").filter(Boolean);
  let start = 0;
  if (parts[0] === "functions" && parts[1] === "v1") start = 2;
  if (parts[start] === "api") start += 1;
  return parts.slice(start);
};

const ID = /^[1-9]\d{0,17}$/;

export const matchApiRoute = (method: string, pathname: string): RouteMatch => {
  const [resource, rawId, sub, ...rest] = pathSegments(pathname);
  const verb = method.toUpperCase();
  if (rest.length) return { error: "not_found" };
  const id = rawId != null && ID.test(rawId) ? Number(rawId) : undefined;
  if (rawId != null && id == null) return { error: "not_found" };

  const pick = (options: Partial<Record<string, ApiRoute>>): RouteMatch => {
    const route = options[verb];
    return route
      ? { route, ...(id != null ? { id } : {}) }
      : { error: "method_not_allowed" };
  };

  if (resource === "deals" && id == null) {
    return pick({ GET: "list_deals", POST: "create_deal" });
  }
  if (resource === "deals" && sub == null) {
    return pick({ GET: "get_deal", PATCH: "update_deal" });
  }
  if (resource === "deals" && sub === "notes") {
    return pick({ POST: "add_deal_note" });
  }
  if (resource === "patients" && id == null) {
    return pick({ GET: "list_patients", POST: "create_patient" });
  }
  if (sub != null) return { error: "not_found" };
  if (resource === "pipelines") {
    return id == null
      ? pick({ GET: "list_pipelines", POST: "create_pipeline" })
      : pick({ PATCH: "update_pipeline" });
  }
  if (resource === "stages") {
    return id == null
      ? pick({ GET: "list_stages", POST: "create_stage" })
      : pick({ PATCH: "update_stage" });
  }
  if (resource === "stage_triggers") {
    return id == null
      ? pick({ GET: "list_stage_triggers", POST: "create_stage_trigger" })
      : pick({ PATCH: "update_stage_trigger", DELETE: "delete_stage_trigger" });
  }
  if (resource === "custom_fields" && id == null) {
    return pick({ GET: "list_custom_fields", POST: "create_custom_field" });
  }
  if (resource === "tasks" && id == null) {
    return pick({ GET: "list_tasks", POST: "create_task" });
  }
  if (resource === "messages" && id == null) {
    return pick({ GET: "list_messages", POST: "send_message" });
  }
  if (resource === "account" && id == null) {
    return pick({ GET: "get_account" });
  }
  return { error: "not_found" };
};

/** The key of "Authorization: Bearer <key>" */
export const bearerKey = (authorization: string | null | undefined) =>
  authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? null;

export class ApiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiInputError";
  }
}

const INTEGER_PARAMS = [
  "page",
  "per_page",
  "pipeline_id",
  "stage_id",
  "patient_id",
  "deal_id",
];
const DATE_PARAMS = ["updated_since", "created_since"];
const TEXT_PARAMS = ["phone", "q"];
const BOOLEAN_PARAMS = ["done"];
/** Parameters with a fixed set of values */
const ENUM_PARAMS: Record<string, string[]> = { entity: ["deal", "patient"] };

const LIST_PARAMS: Partial<Record<ApiRoute, string[]>> = {
  list_deals: [
    "page",
    "per_page",
    "pipeline_id",
    "stage_id",
    "patient_id",
    "updated_since",
  ],
  list_patients: ["page", "per_page", "phone", "q", "created_since"],
  list_stages: ["pipeline_id"],
  list_stage_triggers: ["pipeline_id", "stage_id"],
  list_custom_fields: ["entity"],
  list_tasks: ["page", "per_page", "deal_id", "done"],
  list_messages: ["page", "per_page", "deal_id"],
};

/**
 * Query string of a list → params of the database function. Unknown
 * parameters are ignored; wrong values are refused with a clear message.
 */
export const listParams = (route: ApiRoute, search: URLSearchParams) => {
  const params: Record<string, string | number> = {};
  for (const name of LIST_PARAMS[route] ?? []) {
    const raw = search.get(name)?.trim();
    if (raw == null || raw === "") continue;
    if (INTEGER_PARAMS.includes(name)) {
      if (!ID.test(raw)) {
        throw new ApiInputError(`${name}: ожидается целое число больше нуля`);
      }
      params[name] = Number(raw);
    } else if (DATE_PARAMS.includes(name)) {
      if (Number.isNaN(Date.parse(raw))) {
        throw new ApiInputError(
          `${name}: ожидается дата ISO 8601, например 2026-10-01T00:00:00Z`,
        );
      }
      params[name] = new Date(raw).toISOString();
    } else if (TEXT_PARAMS.includes(name)) {
      params[name] = raw.slice(0, 200);
    } else if (BOOLEAN_PARAMS.includes(name)) {
      if (raw !== "true" && raw !== "false") {
        throw new ApiInputError(`${name}: ожидается true или false`);
      }
      params[name] = raw;
    } else if (ENUM_PARAMS[name]) {
      if (!ENUM_PARAMS[name].includes(raw)) {
        throw new ApiInputError(
          `${name}: одно из значений ${ENUM_PARAMS[name].join(", ")}`,
        );
      }
      params[name] = raw;
    }
  }
  return params;
};

/** JSON object of a POST / PATCH body */
export const parseBody = (text: string): Record<string, unknown> => {
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiInputError("Тело запроса — не JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiInputError("Тело запроса должно быть JSON-объектом");
  }
  return value as Record<string, unknown>;
};

/** The database function of a route and its arguments */
export const rpcCall = (
  route: ApiRoute,
  apiKey: string,
  {
    id,
    search,
    body,
  }: { id?: number; search?: URLSearchParams; body?: Record<string, unknown> },
): { fn: string; args: Record<string, unknown> } => {
  const query = search ?? new URLSearchParams();
  switch (route) {
    case "list_deals":
    case "list_patients":
    case "list_stages":
    case "list_stage_triggers":
    case "list_custom_fields":
    case "list_tasks":
    case "list_messages":
      return {
        fn: `api_${route}`,
        args: { api_key: apiKey, params: listParams(route, query) },
      };
    case "get_deal":
      return { fn: "api_get_deal", args: { api_key: apiKey, deal_id: id } };
    case "update_deal":
    case "add_deal_note":
      return {
        fn: `api_${route}`,
        args: { api_key: apiKey, deal_id: id, body: body ?? {} },
      };
    case "create_deal":
    case "create_patient":
    case "create_pipeline":
    case "create_stage":
    case "create_stage_trigger":
    case "create_custom_field":
    case "create_task":
    case "send_message":
      return {
        fn: `api_${route}`,
        args: { api_key: apiKey, body: body ?? {} },
      };
    case "update_pipeline":
      return {
        fn: "api_update_pipeline",
        args: { api_key: apiKey, pipeline_id: id, body: body ?? {} },
      };
    case "update_stage":
      return {
        fn: "api_update_stage",
        args: { api_key: apiKey, stage_id: id, body: body ?? {} },
      };
    case "update_stage_trigger":
      return {
        fn: "api_update_stage_trigger",
        args: { api_key: apiKey, trigger_id: id, body: body ?? {} },
      };
    case "delete_stage_trigger":
      return {
        fn: "api_delete_stage_trigger",
        args: { api_key: apiKey, trigger_id: id },
      };
    case "list_pipelines":
    case "get_account":
      return { fn: `api_${route}`, args: { api_key: apiKey } };
  }
};

/** Routes that create something (201) */
const CREATE_ROUTES: ApiRoute[] = [
  "create_deal",
  "add_deal_note",
  "create_pipeline",
  "create_stage",
  "create_stage_trigger",
  "create_custom_field",
  "create_task",
];

/**
 * 201 for what was created (an existing patient found by phone: 200), 202
 * for a message put in the sending queue
 */
export const successStatus = (route: ApiRoute, data: unknown) => {
  if (CREATE_ROUTES.includes(route)) return 201;
  if (route === "send_message") return 202;
  if (route === "create_patient") {
    return (data as { created?: boolean } | null)?.created === false
      ? 200
      : 201;
  }
  return 200;
};

export type ApiError = { status: number; code: string; message: string };

/**
 * An error of the database function → HTTP status and code. PTnnn codes carry
 * the status (401 key, 403 scope, 404 not found, 429 rate limit); the rules of
 * the deals (checklist, refusal reason) and unknown ids are 422; wrong values
 * 400.
 */
export const mapDbError = (error: {
  code?: string;
  message?: string;
  hint?: string;
}): ApiError => {
  const message = error.message ?? "";
  switch (error.code) {
    case "PT401":
      return { status: 401, code: "invalid_key", message };
    case "PT403":
      // A key without the scope of the method (stage 25), or a read key of stage 20
      return {
        status: 403,
        code:
          error.hint === "insufficient_scope"
            ? "insufficient_scope"
            : "read_only_key",
        message,
      };
    case "PT404":
      return { status: 404, code: "not_found", message };
    case "PT429":
      return { status: 429, code: "rate_limited", message };
    case "23503":
      return {
        status: 422,
        code: "invalid_reference",
        message:
          "Неизвестный id (этап, воронка, сотрудник, услуга, тег...) или объект другой клиники",
      };
    case "23514":
    case "23502":
      return { status: 422, code: "rule_violation", message };
    case "22023":
    case "22P02":
    case "22007":
    case "22008":
    case "22003":
      return { status: 400, code: "invalid_input", message };
    default:
      return {
        status: 500,
        code: "internal_error",
        message: "Внутренняя ошибка",
      };
  }
};

/** API answers are JSON, callable from a browser too */
export const apiHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
