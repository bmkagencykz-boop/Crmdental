// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ApiInputError,
  bearerKey,
  listParams,
  mapDbError,
  matchApiRoute,
  parseBody,
  pathSegments,
  rpcCall,
  successStatus,
} from "./publicApi";

describe("matchApiRoute", () => {
  it("understands the paths with or without the functions prefix", () => {
    expect(pathSegments("/functions/v1/api/deals/12/notes")).toEqual([
      "deals",
      "12",
      "notes",
    ]);
    expect(pathSegments("/api/deals/")).toEqual(["deals"]);
    expect(pathSegments("/deals")).toEqual(["deals"]);
  });

  it("maps every method of the API", () => {
    expect(matchApiRoute("GET", "/api/deals")).toEqual({ route: "list_deals" });
    expect(matchApiRoute("POST", "/api/deals")).toEqual({
      route: "create_deal",
    });
    expect(matchApiRoute("GET", "/api/deals/15")).toEqual({
      route: "get_deal",
      id: 15,
    });
    expect(matchApiRoute("patch", "/functions/v1/api/deals/15")).toEqual({
      route: "update_deal",
      id: 15,
    });
    expect(matchApiRoute("POST", "/api/deals/15/notes")).toEqual({
      route: "add_deal_note",
      id: 15,
    });
    expect(matchApiRoute("GET", "/api/patients")).toEqual({
      route: "list_patients",
    });
    expect(matchApiRoute("POST", "/api/patients")).toEqual({
      route: "create_patient",
    });
    expect(matchApiRoute("GET", "/api/pipelines")).toEqual({
      route: "list_pipelines",
    });
  });

  it("refuses unknown paths, bad ids and other methods", () => {
    expect(matchApiRoute("GET", "/api/companies")).toEqual({
      error: "not_found",
    });
    expect(matchApiRoute("GET", "/api/deals/abc")).toEqual({
      error: "not_found",
    });
    expect(matchApiRoute("GET", "/api/deals/0")).toEqual({
      error: "not_found",
    });
    expect(matchApiRoute("GET", "/api/deals/1/notes/2")).toEqual({
      error: "not_found",
    });
    expect(matchApiRoute("DELETE", "/api/deals/1")).toEqual({
      error: "method_not_allowed",
    });
    expect(matchApiRoute("PATCH", "/api/deals")).toEqual({
      error: "method_not_allowed",
    });
    expect(matchApiRoute("GET", "/api/deals/1/notes")).toEqual({
      error: "method_not_allowed",
    });
  });
});

describe("bearerKey", () => {
  it("takes the key of the Authorization header", () => {
    expect(bearerKey("Bearer dcrm_abc123")).toBe("dcrm_abc123");
    expect(bearerKey("bearer   dcrm_abc123 ")).toBe("dcrm_abc123");
    expect(bearerKey("Basic xyz")).toBeNull();
    expect(bearerKey("Bearer")).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });
});

describe("listParams", () => {
  it("keeps the known filters with their types", () => {
    expect(
      listParams(
        "list_deals",
        new URLSearchParams(
          "stage_id=3&pipeline_id=1&updated_since=2026-10-01T00:00:00%2B05:00&page=2&per_page=20&foo=bar",
        ),
      ),
    ).toEqual({
      stage_id: 3,
      pipeline_id: 1,
      updated_since: "2026-09-30T19:00:00.000Z",
      page: 2,
      per_page: 20,
    });
    expect(
      listParams(
        "list_patients",
        new URLSearchParams("phone=%2B77011234567&q=%20Ахмет%20&stage_id=3"),
      ),
    ).toEqual({ phone: "+77011234567", q: "Ахмет" });
  });

  it("refuses wrong values with a clear message", () => {
    expect(() =>
      listParams("list_deals", new URLSearchParams("stage_id=abc")),
    ).toThrow(ApiInputError);
    expect(() =>
      listParams("list_deals", new URLSearchParams("page=-1")),
    ).toThrow("page: ожидается целое число больше нуля");
    expect(() =>
      listParams("list_deals", new URLSearchParams("updated_since=вчера")),
    ).toThrow(/updated_since: ожидается дата ISO 8601/);
  });
});

describe("parseBody", () => {
  it("parses a JSON object, an empty body is an empty object", () => {
    expect(parseBody('{"name": "Имплантация"}')).toEqual({
      name: "Имплантация",
    });
    expect(parseBody("  ")).toEqual({});
  });

  it("refuses anything else", () => {
    expect(() => parseBody("{oops")).toThrow("Тело запроса — не JSON");
    expect(() => parseBody("[1, 2]")).toThrow(
      "Тело запроса должно быть JSON-объектом",
    );
    expect(() => parseBody("null")).toThrow(ApiInputError);
  });
});

describe("rpcCall", () => {
  it("names the database function and its arguments", () => {
    expect(
      rpcCall("list_deals", "k", {
        search: new URLSearchParams("stage_id=4"),
      }),
    ).toEqual({
      fn: "api_list_deals",
      args: { api_key: "k", params: { stage_id: 4 } },
    });
    expect(rpcCall("get_deal", "k", { id: 9 })).toEqual({
      fn: "api_get_deal",
      args: { api_key: "k", deal_id: 9 },
    });
    expect(rpcCall("update_deal", "k", { id: 9, body: { name: "x" } })).toEqual(
      {
        fn: "api_update_deal",
        args: { api_key: "k", deal_id: 9, body: { name: "x" } },
      },
    );
    expect(
      rpcCall("add_deal_note", "k", { id: 9, body: { text: "t" } }),
    ).toEqual({
      fn: "api_add_deal_note",
      args: { api_key: "k", deal_id: 9, body: { text: "t" } },
    });
    expect(rpcCall("create_patient", "k", {})).toEqual({
      fn: "api_create_patient",
      args: { api_key: "k", body: {} },
    });
    expect(rpcCall("list_pipelines", "k", {})).toEqual({
      fn: "api_list_pipelines",
      args: { api_key: "k" },
    });
  });
});

describe("mapDbError", () => {
  it("turns the database errors into HTTP statuses", () => {
    expect(mapDbError({ code: "PT401", message: "Неверный ключ" })).toEqual({
      status: 401,
      code: "invalid_key",
      message: "Неверный ключ",
    });
    expect(mapDbError({ code: "PT403" }).status).toBe(403);
    expect(mapDbError({ code: "PT404" }).status).toBe(404);
    expect(mapDbError({ code: "PT429" })).toMatchObject({
      status: 429,
      code: "rate_limited",
    });
    expect(mapDbError({ code: "23503" })).toMatchObject({
      status: 422,
      code: "invalid_reference",
    });
    expect(
      mapDbError({ code: "23514", message: "Укажите причину отказа" }),
    ).toEqual({
      status: 422,
      code: "rule_violation",
      message: "Укажите причину отказа",
    });
    expect(mapDbError({ code: "22P02" }).status).toBe(400);
    expect(mapDbError({ code: "XX000", message: "secret detail" })).toEqual({
      status: 500,
      code: "internal_error",
      message: "Внутренняя ошибка",
    });
  });
});

describe("successStatus", () => {
  it("201 for what was created", () => {
    expect(successStatus("create_deal", {})).toBe(201);
    expect(successStatus("add_deal_note", {})).toBe(201);
    expect(successStatus("create_patient", { created: true })).toBe(201);
    expect(successStatus("create_patient", { created: false })).toBe(200);
    expect(successStatus("list_deals", {})).toBe(200);
  });
});
