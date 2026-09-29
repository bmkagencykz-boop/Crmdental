import { beforeAll, describe, expect, it } from "vitest";

import type { Visit } from "../../schedule/types";
import type { AuditLogEntry, CrmNotification, Sale } from "../../types";
import type { WaitingEntry } from "../../waiting-list/types";
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
}, 120_000);

const setup = () => {
  const db = generateData();
  let current: Sale = db.sales.find((sale) => sale.role === "owner")!;
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({
        id: current.id,
        fullName: current.first_name,
      }),
    },
  });
  const loginAs = (role: Sale["role"]) => {
    current = db.sales.find((sale) => sale.role === role && !sale.disabled)!;
    return current;
  };
  return { db, dataProvider, loginAs };
};

const list = async <T>(
  dataProvider: CrmDataProvider,
  resource: string,
  filter: Record<string, unknown> = {},
) =>
  (
    await dataProvider.getList(resource, {
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
      filter,
    })
  ).data as T[];

const DAY = 86_400_000;

describe("waiting list demo", { timeout: 30_000 }, () => {
  it("has about ten realistic entries in every status", () => {
    const { db } = setup();
    expect(db.waiting_list.length).toBeGreaterThanOrEqual(8);
    const statuses = new Set(db.waiting_list.map((entry) => entry.status));
    expect([...statuses].sort()).toEqual([
      "booked",
      "cancelled",
      "offered",
      "waiting",
    ]);
    expect(
      db.waiting_list.filter((entry) => entry.priority === "urgent").length,
    ).toBeGreaterThanOrEqual(2);
    // Booked entries are linked to a visit of their patient
    for (const entry of db.waiting_list.filter((e) => e.status === "booked")) {
      const visit = db.visits.find((v) => v.id === entry.visit_id);
      expect(visit?.patient_id).toBe(entry.patient_id);
    }
    // A freed slot is highlighted, and its responsible was notified
    const freed = db.waiting_list.filter((entry) => entry.slot_starts_at);
    expect(freed.length).toBeGreaterThanOrEqual(1);
    expect(db.notifications.some((n) => n.kind === "waiting_list_slot")).toBe(
      true,
    );
  });

  it("a new entry: defaults, the deal's responsible, checks, audit", async () => {
    const { db, dataProvider } = setup();
    const deal = db.deals.find(
      (d) =>
        d.sales_id != null &&
        !db.waiting_list.some((e) => e.patient_id === d.patient_id),
    )!;
    const { data } = await dataProvider.create<WaitingEntry>("waiting_list", {
      data: {
        patient_id: deal.patient_id,
        deal_id: deal.id,
        weekdays: [4, 2, 2],
        comment: "  пораньше ",
      } as Partial<WaitingEntry>,
    });
    expect(data).toMatchObject({
      status: "waiting",
      priority: "normal",
      sales_id: deal.sales_id,
      weekdays: [2, 4],
      comment: "пораньше",
    });
    const other = db.deals.find((d) => d.patient_id !== deal.patient_id)!;
    await expect(
      dataProvider.create("waiting_list", {
        data: { patient_id: deal.patient_id, deal_id: other.id },
      }),
    ).rejects.toThrow("Сделка другого пациента");
    const audit = await list<AuditLogEntry>(dataProvider, "audit_log");
    expect(
      audit.some(
        (row) => row.entity === "waiting_list" && row.entity_id === data.id,
      ),
    ).toBe(true);
  });

  it("a cancelled visit highlights the fitting entries and notifies", async () => {
    const { db, dataProvider } = setup();
    const doctor = db.doctors.find(
      (d) => d.is_active && d.specialty === "терапевт",
    )!;
    const patients = db.patients.filter(
      (p) => !db.waiting_list.some((e) => e.patient_id === p.id),
    );
    const [freedPatient, waitingPatient] = patients;
    // Far ahead: no demo visit there
    const starts = new Date(Date.now() + 40 * DAY);
    starts.setUTCHours(4, 0, 0, 0);
    const ends = new Date(starts.getTime() + 30 * 60_000);
    const { data: entry } = await dataProvider.create<WaitingEntry>(
      "waiting_list",
      {
        data: {
          patient_id: waitingPatient.id,
          doctor_id: doctor.id,
          priority: "urgent",
        } as Partial<WaitingEntry>,
      },
    );
    const { data: visit } = await dataProvider.create<Visit>("visits", {
      data: {
        patient_id: freedPatient.id,
        doctor_id: doctor.id,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      },
    });
    await dataProvider.update<Visit>("visits", {
      id: visit.id,
      data: { status: "cancelled" },
      previousData: visit,
    });
    const { data: after } = await dataProvider.getOne<WaitingEntry>(
      "waiting_list",
      { id: entry.id },
    );
    expect(after.slot_starts_at).toBe(starts.toISOString());
    expect(after.slot_doctor_id).toBe(doctor.id);
    const notes = (
      await list<CrmNotification>(dataProvider, "notifications")
    ).filter(
      (n) =>
        n.kind === "waiting_list_slot" && n.patient_id === waitingPatient.id,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].sales_id).toBe(entry.sales_id);

    // Booking the entry closes it; cancelling the visit puts it back
    const { data: booked } = await dataProvider.create<Visit>("visits", {
      data: {
        patient_id: waitingPatient.id,
        doctor_id: doctor.id,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      },
    });
    const { data: linked } = await dataProvider.update<WaitingEntry>(
      "waiting_list",
      { id: entry.id, data: { visit_id: booked.id }, previousData: after },
    );
    expect(linked).toMatchObject({ status: "booked", slot_starts_at: null });
    await dataProvider.update<Visit>("visits", {
      id: booked.id,
      data: { status: "cancelled" },
      previousData: booked,
    });
    expect(
      (
        await dataProvider.getOne<WaitingEntry>("waiting_list", {
          id: entry.id,
        })
      ).data,
    ).toMatchObject({
      status: "waiting",
      visit_id: null,
    });
  });

  it("an offer records when and by whom", async () => {
    const { db, dataProvider } = setup();
    const entry = db.waiting_list.find((e) => e.status === "waiting")!;
    const { data } = await dataProvider.update<WaitingEntry>("waiting_list", {
      id: entry.id,
      data: {
        status: "offered",
        offered_starts_at: new Date(Date.now() + DAY).toISOString(),
      },
      previousData: entry,
    });
    expect(data.offered_at).toBeTruthy();
    expect(data.offered_by).toBe(
      db.sales.find((sale) => sale.role === "owner")!.id,
    );
  });

  it("rights: the integrator sees nothing, a manager deletes only their own", async () => {
    const { db, dataProvider, loginAs } = setup();
    loginAs("integrator");
    expect(await list(dataProvider, "waiting_list")).toHaveLength(0);
    const manager = loginAs("manager");
    const foreign = db.waiting_list.find((e) => e.created_by !== manager.id);
    if (foreign) {
      await expect(
        dataProvider.delete("waiting_list", {
          id: foreign.id,
          previousData: foreign,
        }),
      ).rejects.toThrow();
    }
    loginAs("owner");
    const any = db.waiting_list[0];
    await dataProvider.delete("waiting_list", {
      id: any.id,
      previousData: any,
    });
    expect(
      (await list<WaitingEntry>(dataProvider, "waiting_list")).some(
        (e) => e.id === any.id,
      ),
    ).toBe(false);
  });
});
