// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  ADAPTERS,
  applyItems,
  describeHttpError,
  isMisKind,
  misWebhookUrl,
  pollConnection,
  pushAppointment,
  testConnection,
  type OutboxRow,
  type Rpc,
} from "./sync";

const connection = {
  id: 5,
  kind: "dentist_plus" as const,
  base_url: "https://dp.test/v1",
  api_key: "k",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const recordingRpc = (results: Record<string, unknown> = {}) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    return { data: results[fn] ?? { result: "ok" }, error: null };
  };
  return { rpc, calls };
};

describe("applyItems", () => {
  it("sends patients first, then appointments, visits and payments", async () => {
    const { rpc, calls } = recordingRpc();
    const result = await applyItems(rpc, 5, [
      {
        type: "payment",
        data: { external_id: "p", amount: 1, kind: "payment" },
      },
      { type: "visit", data: { appointment_external_id: "a" } },
      { type: "appointment", data: { external_id: "a", status: "scheduled" } },
      { type: "patient", data: { external_id: "1", phones: [] } },
    ]);
    expect(calls.map((c) => c.fn)).toEqual([
      "mis_upsert_patient",
      "mis_upsert_appointment",
      "mis_visit_completed",
      "mis_upsert_payment",
    ]);
    expect(calls[1].args).toEqual({
      connection: 5,
      appt: { external_id: "a", status: "scheduled" },
    });
    expect(result).toEqual({ processed: 4, errors: 0, skipped: 0 });
  });

  it("counts errors and skipped records without stopping", async () => {
    const outcomes = [
      { result: "error" },
      { result: "skipped" },
      { result: "ok" },
    ];
    const rpc: Rpc = async () => ({ data: outcomes.shift(), error: null });
    const result = await applyItems(rpc, 5, [
      { type: "patient", data: { external_id: "1", phones: [] } },
      { type: "patient", data: { external_id: "2", phones: [] } },
      { type: "patient", data: { external_id: "3", phones: [] } },
    ]);
    expect(result).toEqual({ processed: 1, errors: 1, skipped: 1 });
  });
});

describe("pollConnection", () => {
  it("reads every resource page by page and moves the cursor", async () => {
    const pages: Record<string, unknown> = {
      "/patients?updated_from=2026-10-01T00%3A00%3A00.000Z&page=1&per_page=100":
        {
          data: [{ id: 1, phone: "+77011112233", fio: "Ахметова Асель" }],
        },
      "/visits?updated_from=2026-10-01T00%3A00%3A00.000Z&page=1&per_page=100": {
        data: [
          { id: 10, patient_id: 1, date: "2026-10-15 10:00", status: "Пришёл" },
        ],
      },
      "/payments?updated_from=2026-10-01T00%3A00%3A00.000Z&page=1&per_page=100":
        [],
    };
    const fetchFn = vi.fn(async (url: string) =>
      jsonResponse(pages[url.replace("https://dp.test/v1", "")] ?? []),
    );
    const { rpc, calls } = recordingRpc();
    const outcome = await pollConnection({
      adapter: ADAPTERS.dentist_plus,
      connection,
      cursor: "2026-10-01T00:00:00.000Z",
      rpc,
      fetchFn,
      now: new Date("2026-10-20T00:00:00Z"),
    });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(calls.map((c) => c.fn)).toEqual([
      "mis_upsert_patient",
      "mis_upsert_appointment",
    ]);
    expect(outcome).toEqual({
      ok: true,
      message: "Принято: 2, без изменений: 0, ошибок: 0",
      cursor: "2026-10-20T00:00:00.000Z",
      result: { processed: 2, errors: 0, skipped: 0 },
    });
  });

  it("follows full pages and skips the directions switched off", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      phone: `+7701000${String(i).padStart(4, "0")}`,
    }));
    const fetchFn = vi.fn(async (url: string) =>
      jsonResponse(
        /[?&]page=1&/.test(url) ? full : [{ id: 999, phone: "+77019999999" }],
      ),
    );
    const { rpc, calls } = recordingRpc();
    await pollConnection({
      adapter: ADAPTERS.dentist_plus,
      connection,
      cursor: null,
      rpc,
      fetchFn,
      directions: { patients: true, appointments: false, payments: false },
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0][0]).not.toContain("updated_from");
    expect(calls).toHaveLength(101);
  });

  it("stops on an HTTP error and keeps the cursor", async () => {
    const { rpc } = recordingRpc();
    const outcome = await pollConnection({
      adapter: ADAPTERS.dentist_plus,
      connection,
      cursor: "2026-10-01T00:00:00.000Z",
      rpc,
      fetchFn: async () => new Response("Unauthorized", { status: 401 }),
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.cursor).toBeNull();
    expect(outcome.message).toBe("HTTP 401: ключ API не принят (Unauthorized)");
  });
});

describe("testConnection", () => {
  it("reports success, errors and a missing key", async () => {
    expect(
      await testConnection(
        ADAPTERS.macdent,
        { ...connection, kind: "macdent" },
        async () => jsonResponse({ data: [{ id: 1 }] }),
      ),
    ).toEqual({ ok: true, message: "MacDent ответила, записей в ответе: 1" });
    expect(
      await testConnection(ADAPTERS.dentist_plus, connection, async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    ).toEqual({ ok: false, message: "МИС недоступна: getaddrinfo ENOTFOUND" });
    expect(
      await testConnection(
        ADAPTERS.dentist_plus,
        connection,
        async () => new Response("<html>", { status: 200 }),
      ),
    ).toEqual({ ok: false, message: "МИС ответила не JSON" });
    expect(
      await testConnection(
        ADAPTERS.dentist_plus,
        { ...connection, api_key: null },
        async () => jsonResponse({}),
      ),
    ).toEqual({ ok: false, message: "Не указан ключ API" });
  });
});

describe("pushAppointment", () => {
  const row: OutboxRow = {
    id: 1,
    kind: "dentist_plus",
    connection_id: 5,
    base_url: "https://dp.test/v1",
    api_key: "k",
    settings: {},
    deal_id: 31,
    payload: {
      deal_id: 31,
      patient: {
        id: 33,
        first_name: "Мадина",
        phones: ["+77074445566"],
        external_id: null,
      },
      appointment: {
        starts_at: "2026-11-02T10:00:00+00:00",
        doctor_external_id: "D1",
      },
    },
    attempts: 0,
  };

  it("creates the patient first when the MIS does not know them", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      jsonResponse(
        url.endsWith("/patients") ? { id: "P9" } : { data: { id: "A9" } },
      ),
    );
    expect(await pushAppointment(ADAPTERS.dentist_plus, row, fetchFn)).toEqual({
      ok: true,
      result: { patient_external_id: "P9", appointment_external_id: "A9" },
    });
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      "https://dp.test/v1/patients",
      "https://dp.test/v1/visits",
    ]);
  });

  it("uses the known MIS id and reports failures", async () => {
    const known = {
      ...row,
      payload: {
        ...row.payload,
        patient: { ...row.payload.patient, external_id: "P1" },
      },
    };
    const fetchFn = vi.fn(async () => new Response("boom", { status: 502 }));
    expect(
      await pushAppointment(ADAPTERS.dentist_plus, known, fetchFn),
    ).toEqual({
      ok: false,
      error: "HTTP 502: ошибка на стороне МИС (boom)",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(
      await pushAppointment(ADAPTERS.dentist_plus, row, async () =>
        jsonResponse({ ok: true }),
      ),
    ).toEqual({ ok: false, error: "МИС не вернула ID пациента" });
  });
});

describe("helpers", () => {
  it("knows the MIS kinds, errors and the webhook address", () => {
    expect(isMisKind("macdent")).toBe(true);
    expect(isMisKind("ident")).toBe(false);
    expect(describeHttpError(404, "")).toBe(
      "HTTP 404: адрес API не найден — проверьте адрес и пути в документации вендора",
    );
    expect(
      misWebhookUrl(
        "https://x.supabase.co/functions/v1/",
        "dentist_plus",
        "a b",
      ),
    ).toBe(
      "https://x.supabase.co/functions/v1/mis_webhook?kind=dentist_plus&token=a%20b",
    );
  });
});
