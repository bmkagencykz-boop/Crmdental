import { beforeAll, describe, expect, it } from "vitest";

import { isValidIin } from "../../patient-card/iin";
import type {
  PatientFile,
  PatientTooth,
  ToothHistoryRow,
  VisitRecord,
} from "../../patient-card/types";
import type { TreatmentPlanItem } from "../../treatment/types";
import type { Patient, Sale } from "../../types";
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
      filter,
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

describe("demo patient card", () => {
  it("generates charts, records, questionnaires, consents and X-rays", () => {
    const { db } = setup();
    expect(db.patient_teeth.length).toBeGreaterThan(20);
    expect(db.patient_tooth_history.length).toBeGreaterThanOrEqual(
      db.patient_teeth.length,
    );
    expect(db.visit_records.length).toBeGreaterThan(0);
    expect(
      db.visit_records.every((record) => record.diagnosis_codes.length > 0),
    ).toBe(true);
    expect(db.patient_questionnaires.length).toBeGreaterThan(2);
    expect(db.consent_templates).toHaveLength(4);
    expect(db.patient_consents.some((consent) => consent.signed_at)).toBe(true);
    const opg = db.patient_files.filter((file) => file.kind === "opg");
    expect(opg.length).toBeGreaterThanOrEqual(2);
    expect(opg[0].path.startsWith("data:image/svg+xml")).toBe(true);
    // IINs are valid and match the birth date
    const withIin = db.patients.filter((patient) => patient.iin);
    expect(withIin.length).toBeGreaterThan(5);
    for (const patient of withIin) {
      expect(isValidIin(patient.iin)).toBe(true);
      expect(patient.iin!.slice(0, 6)).toBe(
        patient.birth_date!.slice(2).replace(/-/g, ""),
      );
    }
  });

  it("keeps the history of a tooth: who, when, before and after", async () => {
    const { dataProvider, loginAs } = setup();
    const manager = loginAs("manager");
    const [patient] = await list<Patient>(dataProvider, "patients");
    const { data: tooth } = await dataProvider.create<PatientTooth>(
      "patient_teeth",
      { data: { patient_id: patient.id, tooth: 17, state: "caries" } },
    );
    await dataProvider.update<PatientTooth>("patient_teeth", {
      id: tooth.id,
      data: { state: "filling", note: " глубокий " },
      previousData: tooth,
    });
    const history = (
      await list<ToothHistoryRow>(dataProvider, "patient_tooth_history", {
        patient_id: patient.id,
      })
    ).filter((row) => row.tooth === 17);
    expect(history.map((row) => [row.state_before, row.state])).toEqual([
      [null, "caries"],
      ["caries", "filling"],
    ]);
    expect(history[1]).toMatchObject({
      note: "глубокий",
      sales_id: manager.id,
      source: "manual",
    });
    await expect(
      dataProvider.create("patient_teeth", {
        data: { patient_id: patient.id, tooth: 17, state: "crown" },
      }),
    ).rejects.toThrow();
    await expect(
      dataProvider.create("patient_teeth", {
        data: { patient_id: patient.id, tooth: 19, state: "crown" },
      }),
    ).rejects.toThrow();
    const audit = await list<{ entity: string }>(dataProvider, "audit_log", {
      entity: "patient_tooth",
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("sets the teeth of a plan item marked done", async () => {
    const { db, dataProvider } = setup();
    const plan = db.treatment_plans[0];
    const { data: item } = await dataProvider.create<TreatmentPlanItem>(
      "treatment_plan_items",
      {
        data: {
          plan_id: plan.id,
          stage_id: db.treatment_stages.find(
            (stage) => String(stage.plan_id) === String(plan.id),
          )?.id,
          stage_no: 1,
          name: "Коронка циркониевая",
          tooth: "44-45",
          quantity: 2,
          unit_price: 120000,
          discount_percent: 0,
          done: false,
          position: 99,
        },
      },
    );
    const teethOf = async () =>
      (
        await list<PatientTooth>(dataProvider, "patient_teeth", {
          patient_id: plan.patient_id,
        })
      ).filter((row) => [44, 45].includes(row.tooth));
    expect((await teethOf()).every((row) => row.state !== "crown")).toBe(true);
    await dataProvider.update<TreatmentPlanItem>("treatment_plan_items", {
      id: item.id,
      data: { done: true },
      previousData: item,
    });
    const teeth = await teethOf();
    expect(teeth.map((row) => row.state)).toEqual(["crown", "crown"]);
    const history = await list<ToothHistoryRow>(
      dataProvider,
      "patient_tooth_history",
      { patient_id: plan.patient_id },
    );
    expect(
      history.filter(
        (row) =>
          row.source === "plan" && String(row.plan_item_id) === String(item.id),
      ),
    ).toHaveLength(2);
  });

  it("binds a visit record to a visit of the same patient", async () => {
    const { db, dataProvider } = setup();
    const visit = db.visits.find(
      (v) => !db.visit_records.some((r) => String(r.visit_id) === String(v.id)),
    )!;
    const other = db.patients.find(
      (patient) => String(patient.id) !== String(visit.patient_id),
    )!;
    await expect(
      dataProvider.create("visit_records", {
        data: { patient_id: other.id, visit_id: visit.id },
      }),
    ).rejects.toThrow();
    const { data: record } = await dataProvider.create<VisitRecord>(
      "visit_records",
      {
        data: {
          patient_id: visit.patient_id,
          visit_id: visit.id,
          diagnosis_codes: ["k02,1"],
        },
      },
    );
    expect(record).toMatchObject({
      deal_id: visit.deal_id ?? null,
      diagnosis_codes: ["K02.1"],
    });
    await expect(
      dataProvider.create("visit_records", {
        data: { patient_id: visit.patient_id, diagnosis_codes: ["кариес"] },
      }),
    ).rejects.toThrow();
  });

  it("checks the IIN and fills the birth date and the sex", async () => {
    const { db, dataProvider } = setup();
    const patient = db.patients.find((p) => !p.iin)!;
    await expect(
      dataProvider.update<Patient>("patients", {
        id: patient.id,
        data: { iin: "900515400124" },
        previousData: patient,
      }),
    ).rejects.toThrow();
    const { data } = await dataProvider.update<Patient>("patients", {
      id: patient.id,
      data: { iin: "9005 1540 0123", birth_date: null, gender: null },
      previousData: patient,
    });
    expect(data).toMatchObject({
      iin: "900515400123",
      birth_date: "1990-05-15",
      gender: "female",
    });
  });

  it("hides the medical data from the integrator", async () => {
    const { dataProvider, loginAs } = setup();
    expect((await list(dataProvider, "patient_teeth")).length).toBeGreaterThan(
      0,
    );
    loginAs("integrator");
    for (const resource of [
      "patient_teeth",
      "patient_tooth_history",
      "visit_records",
      "patient_questionnaires",
      "patient_consents",
      "consent_templates",
      "patient_files",
    ]) {
      expect(await list(dataProvider, resource)).toEqual([]);
    }
  });

  it("uploads and deletes patient files by the rules", async () => {
    const { db, dataProvider, loginAs } = setup();
    loginAs("manager");
    const [patient] = await list<Patient>(dataProvider, "patients");
    const file = await dataProvider.uploadPatientFile(
      patient.id,
      new File(["x"], "снимок.png", { type: "image/png" }),
      "periapical",
      { taken_at: "2026-09-20" },
    );
    expect(file).toMatchObject({ kind: "periapical", taken_at: "2026-09-20" });
    const colleague = db.patient_files.find(
      (f) => f.sales_id != null && String(f.sales_id) !== String(file.sales_id),
    ) as PatientFile | undefined;
    if (colleague) {
      await expect(dataProvider.deletePatientFile(colleague)).rejects.toThrow();
    }
    await dataProvider.deletePatientFile(file);
    expect(
      (await list<PatientFile>(dataProvider, "patient_files")).some(
        (f) => String(f.id) === String(file.id),
      ),
    ).toBe(false);
  });
});
