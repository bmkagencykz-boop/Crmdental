import { beforeAll, describe, expect, it } from "vitest";

import type { Deal, Patient, Sale } from "../../types";
import type { AccountOperation } from "../../payments/types";
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
  // A head among the managers
  const managers = db.sales.filter((sale) => sale.role === "manager");
  managers[managers.length - 1].role = "head";
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
      filter,
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

const newPatient = async (
  dataProvider: CrmDataProvider,
  data: Partial<Patient> = {},
) =>
  (
    await dataProvider.create<Patient>("patients", {
      data: {
        first_name: "Тест",
        last_name: "Пациентов",
        phone_jsonb: [],
        tags: [],
        ...data,
      } as Partial<Patient>,
    })
  ).data;

describe("demo data safety", () => {
  it("keeps archived patients out of the list, the pickers and the search", async () => {
    const { db, dataProvider } = setup();
    const archived = db.patients.filter((p) => p.archived_at);
    expect(archived).toHaveLength(2);
    const active = await list<Patient>(dataProvider, "patients");
    expect(active).toHaveLength(db.patients.length - 2);
    const archive = await list<Patient>(dataProvider, "patients", {
      archived: true,
    });
    expect(archive.map((p) => p.id).sort()).toEqual(
      archived.map((p) => p.id).sort(),
    );
    const found = await dataProvider.globalSearch(archived[0].last_name);
    expect(found.patients.map((p) => p.id)).not.toContain(archived[0].id);
    // Still readable by id (a deal, a payment keep their patient)
    const { data } = await dataProvider.getOne<Patient>("patients", {
      id: archived[0].id,
    });
    expect(data.archived_at).toBeTruthy();
  });

  it("archives with the delete right, restores with the owner or the head", async () => {
    const { db, dataProvider, loginAs } = setup();
    const patient = db.patients.find((p) => !p.archived_at)!;
    loginAs("manager");
    await expect(
      dataProvider.update("patients", {
        id: patient.id,
        data: { archived_at: new Date().toISOString() },
        previousData: patient,
      }),
    ).rejects.toThrow("Нет права");
    const owner = loginAs("owner");
    const { data } = await dataProvider.update<Patient>("patients", {
      id: patient.id,
      data: { archived_at: "2020-01-01T00:00:00Z" },
      previousData: patient,
    });
    expect(data.archived_at).not.toBe("2020-01-01T00:00:00Z");
    expect(data.archived_by).toBe(owner.id);
    loginAs("manager");
    await expect(
      dataProvider.update("patients", {
        id: patient.id,
        data: { archived_at: null },
        previousData: data,
      }),
    ).rejects.toThrow("владелец или руководитель");
    loginAs("head");
    const restored = await dataProvider.update<Patient>("patients", {
      id: patient.id,
      data: { archived_at: null },
      previousData: data,
    });
    expect(restored.data.archived_at).toBeNull();
    expect(restored.data.archived_by).toBeNull();
  });

  it("deletes for good only the owner's patient without history", async () => {
    const { db, dataProvider, loginAs } = setup();
    const withMoney = db.patients.find((p) =>
      db.account_operations.some((op) => op.patient_id === p.id),
    )!;
    loginAs("owner");
    await expect(
      dataProvider.delete("patients", {
        id: withMoney.id,
        previousData: withMoney,
      }),
    ).rejects.toThrow("удалить его нельзя");
    const mistake = await newPatient(dataProvider);
    loginAs("head");
    await expect(
      dataProvider.delete("patients", {
        id: mistake.id,
        previousData: mistake,
      }),
    ).rejects.toThrow("только владелец");
    loginAs("owner");
    await dataProvider.delete("patients", {
      id: mistake.id,
      previousData: mistake,
    });
    expect(db.patients.some((p) => p.id === mistake.id)).toBe(false);
  });

  it("keeps a deal with payments", async () => {
    const { db, dataProvider } = setup();
    const deal = db.deals.find((d) =>
      db.deal_payments.some((p) => p.deal_id === d.id),
    )!;
    await expect(
      dataProvider.delete<Deal>("deals", { id: deal.id, previousData: deal }),
    ).rejects.toThrow("По сделке есть оплаты");
  });

  it("locks the operations of a closed cash shift", async () => {
    const { db, dataProvider } = setup();
    const closed = db.cash_shifts.find((s) => s.closed_at)!;
    const op = db.account_operations.find(
      (row) => row.shift_id === closed.id,
    ) as AccountOperation;
    await expect(
      dataProvider.update("account_operations", {
        id: op.id,
        data: { comment: "исправлено" },
        previousData: op,
      }),
    ).rejects.toThrow("Смена закрыта");
    await expect(
      dataProvider.delete("account_operations", {
        id: op.id,
        previousData: op,
      }),
    ).rejects.toThrow("Смена закрыта");
    if (op.deal_payment_id != null) {
      const payment = db.deal_payments.find(
        (p) => p.id === op.deal_payment_id,
      )!;
      await expect(
        dataProvider.delete("deal_payments", {
          id: payment.id,
          previousData: payment,
        }),
      ).rejects.toThrow("Смена закрыта");
    }
  });

  it("hides the IIN and the medical notes from the integrator", async () => {
    const { db, dataProvider, loginAs } = setup();
    const patient = db.patients.find((p) => p.iin && !p.archived_at)!;
    const iin = patient.iin!;
    const staff = await dataProvider.getOne<Patient>("patients", {
      id: patient.id,
    });
    expect(staff.data.iin).toBe(iin);
    expect(
      (await dataProvider.globalSearch(iin)).patients.map((p) => p.id),
    ).toContain(patient.id);
    loginAs("integrator");
    const integrator = await dataProvider.getOne<Patient>("patients", {
      id: patient.id,
    });
    expect(integrator.data.iin).toBeNull();
    expect(integrator.data.allergies).toBeNull();
    expect((await dataProvider.globalSearch(iin)).patients).toHaveLength(0);
  });

  it("keeps the IIN unique and numbers the cards", async () => {
    const { db, dataProvider } = setup();
    const taken = db.patients.find((p) => p.iin)!.iin!;
    await expect(
      newPatient(dataProvider, {
        iin: `${taken.slice(0, 6)} ${taken.slice(6)}`,
      }),
    ).rejects.toThrow("уже есть");
    const highest = Math.max(
      ...db.patients.map((p) => Number(p.card_number) || 0),
    );
    const first = await newPatient(dataProvider);
    const second = await newPatient(dataProvider, { last_name: "Второй" });
    expect(Number(first.card_number)).toBe(highest + 1);
    expect(Number(second.card_number)).toBe(highest + 2);
    const given = await newPatient(dataProvider, { card_number: "A-7" });
    expect(given.card_number).toBe("A-7");
  });
});
