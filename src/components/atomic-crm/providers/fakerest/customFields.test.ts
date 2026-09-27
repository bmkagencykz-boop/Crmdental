import { beforeAll, describe, expect, it } from "vitest";

import type { CustomField, Deal, Patient, Stage } from "../../types";
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

const setup = () =>
  createDataProvider({
    db: generateData(),
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id: 0, fullName: "Owner" }) },
  });

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

const firstStages = async (dataProvider: CrmDataProvider) => {
  const stages = (await list<Stage>(dataProvider, "stages"))
    .filter((stage) => stage.pipeline_id === 1)
    .sort((a, b) => a.position - b.position);
  return { first: stages[0], second: stages[1] };
};

describe("demo custom fields (stage 19)", () => {
  it("has the example fields and values on deals and patients", async () => {
    const dataProvider = setup();
    const fields = await list<CustomField>(dataProvider, "custom_fields");
    expect(fields.map((field) => field.name)).toEqual([
      "Жалоба",
      "Откуда узнал",
      "Есть снимок КТ",
      "Полис ДМС",
    ]);
    const deals = await list<Deal>(dataProvider, "deals_summary");
    expect(deals.some((deal) => deal.custom_values?.["2"])).toBe(true);
    expect(deals.some((deal) => deal.custom_values?.["1"])).toBe(true);
    const patients = await list<Patient>(dataProvider, "patients_summary");
    expect(patients.some((patient) => patient.custom_values?.["4"])).toBe(true);
  });

  it("filters the deals by jsonb containment", async () => {
    const dataProvider = setup();
    const deals = await list<Deal>(dataProvider, "deals_summary");
    const expected = deals.filter(
      (deal) =>
        deal.custom_values?.["2"] === "Инстаграм" &&
        deal.custom_values?.["3"] === true,
    );
    const found = await list<Deal>(dataProvider, "deals_summary", {
      "custom_values@cs": JSON.stringify({ "2": "Инстаграм", "3": true }),
    });
    expect(found.map((deal) => deal.id)).toEqual(
      expected.map((deal) => deal.id),
    );
  });

  it("normalizes values, drops unknown keys and logs each field", async () => {
    const dataProvider = setup();
    const [deal] = await list<Deal>(dataProvider, "deals");
    const { data } = await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { custom_values: { "2": " 2gis", "99": "?", "3": "да" } },
      previousData: deal,
    });
    expect(data.custom_values).toEqual({ "2": "2GIS", "3": true });
    await expect(
      dataProvider.update<Deal>("deals", {
        id: deal.id,
        data: { custom_values: { "2": "Telegram" } },
        previousData: data,
      }),
    ).rejects.toThrow("Поле «Откуда узнал»: ожидается значение из списка");
    const events = await list<{ deal_id: number; changes: object }>(
      dataProvider,
      "deal_events",
      { deal_id: deal.id },
    );
    const changed = Object.keys(events.at(-1)?.changes ?? {});
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((key) => key.startsWith("cf:"))).toBe(true);
  });

  it("requires the required fields outside the first stage", async () => {
    const dataProvider = setup();
    const fields = await list<CustomField>(dataProvider, "custom_fields");
    const complaint = fields.find((field) => field.name === "Жалоба")!;
    await dataProvider.update("custom_fields", {
      id: complaint.id,
      data: { required: true },
      previousData: complaint,
    });
    const { first, second } = await firstStages(dataProvider);
    const [patient] = await list<Patient>(dataProvider, "patients");
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: { patient_id: patient.id, pipeline_id: 1, stage_id: first.id },
    });
    await expect(
      dataProvider.update<Deal>("deals", {
        id: deal.id,
        data: { stage_id: second.id },
        previousData: deal,
      }),
    ).rejects.toThrow("Заполните поле «Жалоба»");
    const { data: moved } = await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { stage_id: second.id, custom_values: { "1": "Болит зуб" } },
      previousData: deal,
    });
    expect(moved.stage_id).toBe(second.id);
  });

  it("keeps the card to two fields and the type fixed", async () => {
    const dataProvider = setup();
    const fields = await list<CustomField>(dataProvider, "custom_fields");
    const complaint = fields.find((field) => field.name === "Жалоба")!;
    await expect(
      dataProvider.update("custom_fields", {
        id: complaint.id,
        data: { show_on_card: true },
        previousData: complaint,
      }),
    ).rejects.toThrow("не больше двух полей");
    await expect(
      dataProvider.update("custom_fields", {
        id: complaint.id,
        data: { type: "text" },
        previousData: complaint,
      }),
    ).rejects.toThrow("Тип поля изменить нельзя");
  });
});
