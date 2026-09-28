import { beforeAll, describe, expect, it } from "vitest";

import { findConflict, isActiveStatus } from "../../schedule/scheduleLayout";
import type { Chair, Visit } from "../../schedule/types";
import type { Deal, Doctor, Message, Stage, Task } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";

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

const setup = (db: Db = generateData()) => ({
  db,
  dataProvider: createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: 0, fullName: "User" }) },
  }),
});

const list = async <T>(
  dataProvider: CrmDataProvider,
  resource: string,
  filter: Record<string, unknown> = {},
) =>
  (
    await dataProvider.getList<T & { id: number }>(resource, {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "id", order: "ASC" },
      filter,
    })
  ).data;

const stageName = (db: Db, deal: Deal) =>
  db.stages.find((stage: Stage) => stage.id === deal.stage_id)?.name;

/** A deal of the main pipeline in «В работе», without visits */
const freeDeal = (db: Db) =>
  db.deals.find(
    (deal) =>
      deal.pipeline_id === 1 &&
      stageName(db, deal) === "В работе" &&
      !deal.unsorted_at &&
      !db.visits.some((visit) => visit.deal_id === deal.id),
  )!;

const inDays = (days: number, hour: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

describe("the schedule of the demo", () => {
  it("has chairs, doctors' hours and a week of visits in mixed statuses", () => {
    const { db } = setup();
    expect(db.chairs.map((chair: Chair) => chair.name)).toHaveLength(3);
    expect(
      db.doctors.every(
        (doctor: Doctor) =>
          Object.keys(doctor.working_hours ?? {}).length > 0 &&
          (doctor.visit_minutes ?? 0) > 0,
      ),
    ).toBe(true);
    const statuses = new Set(db.visits.map((visit) => visit.status));
    ["scheduled", "confirmed", "completed", "no_show", "cancelled"].forEach(
      (status) => expect(statuses.has(status as Visit["status"])).toBe(true),
    );
    expect(db.visits.length).toBeGreaterThan(20);
    expect(db.visits.every((visit) => visit.deal_id != null)).toBe(true);
    expect(db.visits.filter((visit) => visit.source === "mis")).toHaveLength(4);
    // No two active CRM visits collide
    db.visits
      .filter((visit) => visit.source === "crm" && isActiveStatus(visit.status))
      .forEach((visit) =>
        expect(findConflict(visit, db.visits)).toBeNull(),
      );
    // Booked deals point at their visit
    db.visits
      .filter((visit) => visit.source === "crm" && ["scheduled", "confirmed"].includes(visit.status))
      .forEach((visit) => {
        const deal = db.deals.find((d) => d.id === visit.deal_id)!;
        expect(deal.appointment_at).toBe(visit.starts_at);
      });
  });

  it("books a visit: the deal gets the date, the doctor and «Записан»", async () => {
    const { db, dataProvider } = setup();
    const deal = freeDeal(db);
    // 07:00 in Almaty: before the demo visits of the day
    const starts = inDays(3, 2);
    const doctor = db.doctors[3];
    await dataProvider.create<Visit>("visits", {
      data: {
        patient_id: deal.patient_id,
        deal_id: deal.id,
        doctor_id: doctor.id,
        chair_id: 1,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 30 * 60000).toISOString(),
      } as Partial<Visit>,
    });
    const { data: after } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    expect(after.appointment_at).toBe(starts.toISOString());
    expect(stageName(db, after)).toBe("Записан");
    expect(after.doctor_id).toBe(deal.doctor_id ?? doctor.id);

    // The same doctor at the same time is refused
    const other = freeDeal(db);
    await expect(
      dataProvider.create<Visit>("visits", {
        data: {
          patient_id: other.patient_id,
          deal_id: other.id,
          doctor_id: doctor.id,
          starts_at: new Date(starts.getTime() + 15 * 60000).toISOString(),
          ends_at: new Date(starts.getTime() + 45 * 60000).toISOString(),
        } as Partial<Visit>,
      }),
    ).rejects.toThrow("Врач уже занят");

    // «Пришёл» moves the deal on and sets the visit
    const [visit] = await list<Visit>(dataProvider, "visits", {
      deal_id: deal.id,
    });
    await dataProvider.update<Visit>("visits", {
      id: visit.id,
      data: { status: "arrived" },
      previousData: visit,
    });
    const { data: visited } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    expect(stageName(db, visited)).toBe("Пришёл на консультацию");
    expect(visited.visit_at).toBe(starts.toISOString());
    expect(visited.appointment_at).toBeNull();
  });

  it("«Не пришёл» adds the tag and a call-back task", async () => {
    const { db, dataProvider } = setup();
    const deal = freeDeal(db);
    const starts = inDays(-1, 6);
    const { data: visit } = await dataProvider.create<Visit>("visits", {
      data: {
        patient_id: deal.patient_id,
        deal_id: deal.id,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 30 * 60000).toISOString(),
      } as Partial<Visit>,
    });
    await dataProvider.update<Visit>("visits", {
      id: visit.id,
      data: { status: "no_show" },
      previousData: visit,
    });
    const tag = (await list<{ name: string }>(dataProvider, "tags")).find(
      (t) => t.name === "Не пришёл",
    );
    const { data: after } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    expect(tag && after.tags.includes(Number(tag.id))).toBe(true);
    const tasks = await list<Task>(dataProvider, "tasks", { deal_id: deal.id });
    expect(tasks.some((task) => task.text?.startsWith("Перезвонить"))).toBe(
      true,
    );
  });

  it("MIS visits are read-only", async () => {
    const { db, dataProvider } = setup();
    const mis = db.visits.find((visit) => visit.source === "mis")!;
    await expect(
      dataProvider.update<Visit>("visits", {
        id: mis.id,
        data: { note: "x" },
        previousData: mis,
      }),
    ).rejects.toThrow("Запись ведётся в МИС");
  });

  it("settings: saved and checked", async () => {
    const { db, dataProvider } = setup();
    const settings = await dataProvider.getScheduleSettings();
    expect(settings.mis_kind).toBeNull();
    expect(settings.status_map.no_show?.tag).toBe("Не пришёл");
    const lost = db.stages.find((stage) => stage.kind === "lost")!;
    await expect(
      dataProvider.saveScheduleSettings({
        status_map: { arrived: { stage_id: lost.id } },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.saveScheduleSettings({ hours_start: "20:00", hours_end: "08:00" }),
    ).rejects.toThrow();
    const saved = await dataProvider.saveScheduleSettings({
      hours_start: "08:00",
      confirm_keywords: ["1", "да", " "],
    });
    expect(saved.hours_start).toBe("08:00");
    expect(saved.confirm_keywords).toEqual(["1", "да"]);
    await expect(
      dataProvider.saveDoctorHours(1, { "1": { start: "18:00", end: "09:00" } }),
    ).rejects.toThrow();
  });

  it("a reply «1» confirms the visit of the next 48 hours", async () => {
    const { db, dataProvider } = setup();
    const deal = freeDeal(db);
    const starts = new Date(Date.now() + 20 * 3600 * 1000);
    starts.setUTCMinutes(0, 0, 0);
    const { data: visit } = await dataProvider.create<Visit>("visits", {
      data: {
        patient_id: deal.patient_id,
        deal_id: deal.id,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 30 * 60000).toISOString(),
      } as Partial<Visit>,
    });
    // The demo has no inbound channel: the trigger is called as the app does
    const createDemo = (await import("./schedule")).createScheduleDemo;
    expect(createDemo).toBeTypeOf("function");
    const message = {
      id: 999999,
      patient_id: deal.patient_id,
      deal_id: deal.id,
      direction: "in",
      text: "Да, подтверждаю",
    } as unknown as Message;
    const all = async <T,>(resource: string) =>
      (await list<T>(dataProvider, resource)) as T[];
    const demo = createDemo({
      baseDataProvider: dataProvider,
      all,
      currentSalesId: async () => 0,
      getDataProvider: () => dataProvider,
    });
    expect(await demo.onMessage(message)).toBe("confirm");
    const { data: after } = await dataProvider.getOne<Visit>("visits", {
      id: visit.id,
    });
    expect(after.status).toBe("confirmed");
  });
});
