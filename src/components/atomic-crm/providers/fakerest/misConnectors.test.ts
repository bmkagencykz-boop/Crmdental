import { beforeAll, describe, expect, it } from "vitest";

import type {
  MisAppointment,
  MisDoctor,
  MisSyncLogEntry,
} from "../../mis/types";
import type { Deal, Stage } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
});

/** The demo as the owner (id 0) or a manager (id 1) */
const setup = (id = 0) =>
  createDataProvider({
    db: generateData(),
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id, fullName: "User" }) },
  });

const list = async <T>(
  dataProvider: CrmDataProvider,
  resource: string,
  filter: Record<string, unknown> = {},
) =>
  (
    await dataProvider.getList<T & { id: number }>(resource, {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "id", order: "ASC" },
      filter,
    })
  ).data;

describe("MIS connectors in the demo", () => {
  it("shows Dentist Plus connected with synced visits, a payment and a log", async () => {
    const dataProvider = setup();
    const connection = await dataProvider.getMisConnection("dentist_plus");
    expect(connection).toMatchObject({
      status: "connected",
      has_api_key: true,
      push_appointments: false,
    });
    expect(connection?.webhook_url).toContain(
      "/mis_webhook?kind=dentist_plus&token=",
    );
    expect(
      (await dataProvider.getIntegrationStatus()).find(
        (row) => row.kind === "dentist_plus",
      )?.status,
    ).toBe("connected");

    const visits = await list<MisAppointment>(dataProvider, "mis_appointments");
    expect(visits.length).toBeGreaterThanOrEqual(3);
    const deals = await list<Deal>(dataProvider, "deals");
    for (const visit of visits) {
      const deal = deals.find((d) => d.id === visit.deal_id);
      expect(deal?.patient_id).toBe(visit.patient_id);
    }
    const booked = visits.find((visit) => visit.status === "scheduled");
    expect(
      deals.find((deal) => deal.id === booked?.deal_id)?.appointment_at,
    ).toBe(booked?.starts_at);

    const payments = await list<{ comment: string }>(
      dataProvider,
      "deal_payments",
    );
    expect(
      payments.filter((payment) =>
        payment.comment?.startsWith("Оплата из МИС"),
      ),
    ).toHaveLength(1);
    const log = await list<MisSyncLogEntry>(dataProvider, "mis_sync_log", {
      kind: "dentist_plus",
    });
    expect(log.some((entry) => entry.result === "skipped")).toBe(true);
    const doctors = await list<MisDoctor>(dataProvider, "mis_doctors");
    expect(doctors.some((doctor) => doctor.doctor_id == null)).toBe(true);
  });

  it("connects MacDent with the default mapping and refuses bad settings", async () => {
    const dataProvider = setup();
    expect(await dataProvider.getMisConnection("macdent")).toBeNull();
    await expect(
      dataProvider.saveMisConnection("macdent", {
        base_url: "http://insecure.kz",
      }),
    ).rejects.toThrow("https://");
    const saved = await dataProvider.saveMisConnection("macdent", {
      api_key: "md-key",
    });
    const stages = await list<Stage>(dataProvider, "stages");
    const booked = stages.find(
      (stage) => stage.pipeline_id === 1 && stage.name === "Записан",
    );
    expect(saved).toMatchObject({ status: "connected", has_api_key: true });
    expect(saved.status_map.scheduled).toEqual({ stage_id: booked?.id });
    const lost = stages.find((stage) => stage.kind === "lost");
    await expect(
      dataProvider.saveMisConnection("macdent", {
        status_map: { no_show: { stage_id: lost!.id } },
      }),
    ).rejects.toThrow("отказа");
    expect(await dataProvider.testMisConnection("macdent")).toMatchObject({
      ok: true,
    });
    expect(await dataProvider.syncMisNow("macdent")).toMatchObject({
      ok: true,
    });
    const log = await list<MisSyncLogEntry>(dataProvider, "mis_sync_log", {
      kind: "macdent",
    });
    expect(log.map((entry) => entry.operation).sort()).toEqual([
      "poll",
      "test",
    ]);
    await dataProvider.disconnectMis("macdent");
    expect(await dataProvider.getMisConnection("macdent")).toMatchObject({
      status: "disabled",
      has_api_key: false,
    });
  });

  it("links a MIS doctor and its visits follow", async () => {
    const dataProvider = setup();
    const [misDoctor] = await list<MisDoctor>(dataProvider, "mis_doctors");
    await dataProvider.linkMisDoctor(misDoctor.id, 5);
    const visits = (
      await list<MisAppointment>(dataProvider, "mis_appointments")
    ).filter((visit) => visit.doctor_external_id === misDoctor.external_id);
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((visit) => visit.doctor_id === 5)).toBe(true);
  });

  it("keeps the settings for the owner and the head", async () => {
    const manager = setup(1);
    expect(await manager.getMisConnection("dentist_plus")).toBeNull();
    await expect(
      manager.saveMisConnection("dentist_plus", { push_appointments: true }),
    ).rejects.toThrow();
  });
});
