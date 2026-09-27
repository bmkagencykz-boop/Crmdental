import fakeRestDataProvider from "ra-data-fakerest";
import { describe, expect, it } from "vitest";

import type { BatchRow } from "../../import/importMapping";
import { importBatchInMemory } from "./importBatch";

const newStore = () =>
  fakeRestDataProvider(
    {
      pipelines: [{ id: 1, name: "Основная", position: 0, is_default: true }],
      stages: [
        {
          id: 10,
          pipeline_id: 1,
          name: "Новый лид",
          position: 0,
          kind: "open",
        },
        { id: 11, pipeline_id: 1, name: "Записан", position: 1, kind: "open" },
        { id: 12, pipeline_id: 1, name: "Завершено", position: 2, kind: "won" },
        { id: 13, pipeline_id: 1, name: "Отказ", position: 3, kind: "lost" },
      ],
      lost_reasons: [
        { id: 1, name: "Дорого", position: 0 },
        { id: 2, name: "Другое", position: 1 },
      ],
      patients: [],
      deals: [],
      deal_events: [],
      deal_payments: [],
      tasks: [],
      external_refs: [],
    },
    false,
    0,
  );

const rows: BatchRow[] = [
  {
    index: 2,
    system: "amocrm",
    patient: { first_name: "Асель", phones: ["8 701 111 22 33"], tags: [] },
    deal: {
      external_id: "1001",
      name: "Имплантация",
      stage_id: 11,
      plan_amount: 450000,
      paid_amount: 150000,
      tags: [],
    },
  },
  {
    index: 3,
    system: "amocrm",
    patient: { first_name: "Асель", phones: ["+7 (701) 111-22-33"], tags: [] },
    deal: { external_id: "1002", name: "Гигиена", stage_id: 13, tags: [] },
  },
  { index: 4, system: "amocrm", patient: { phones: [], tags: [] } },
];

const all = async (store: ReturnType<typeof newStore>, resource: string) =>
  (
    await store.getList(resource, {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    })
  ).data;

describe("importBatchInMemory", () => {
  it("imports patients and deals once, like import_batch", async () => {
    const base = newStore();
    const first = await importBatchInMemory({
      base,
      kind: "deals",
      rows,
      role: "owner",
    });
    expect(first).toMatchObject({
      created: 2,
      patients_created: 1,
      deals_created: 2,
      errors: [{ index: 4, message: "Нет ни имени, ни телефона пациента" }],
    });
    const deals = await all(base, "deals");
    expect(
      deals.map((deal) => [deal.name, deal.stage_id, deal.paid_amount]),
    ).toEqual([
      ["Имплантация", 11, 150000],
      ["Гигиена", 13, 0],
    ]);
    // A refusal without a reason gets "Другое"
    expect(deals[1].lost_reason_id).toBe(2);
    expect(await all(base, "tasks")).toEqual([]);

    const second = await importBatchInMemory({
      base,
      kind: "deals",
      rows,
      role: "owner",
    });
    expect(second).toMatchObject({ created: 0, updated: 0, skipped: 2 });
    expect(await all(base, "patients")).toHaveLength(1);
    expect(await all(base, "deals")).toHaveLength(2);
    expect(await all(base, "deal_payments")).toHaveLength(1);
  });

  it("is for the owner and the head only", async () => {
    await expect(
      importBatchInMemory({
        base: newStore(),
        kind: "patients",
        rows,
        role: "manager",
      }),
    ).rejects.toThrow();
  });
});
