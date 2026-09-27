import { beforeAll, describe, expect, it } from "vitest";

import type { Automessage, Deal, Task } from "../../types";
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

/** Tomorrow + n days at 12:00 UTC (17:00 in Almaty): within the quiet hours */
const daysAhead = (n: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + n);
  date.setUTCHours(12, 0, 0, 0);
  return date.toISOString();
};

describe("demo automatic messages", () => {
  it("has templates, rules and a greeting waiting for the employee", async () => {
    const dataProvider = setup();
    expect(await list(dataProvider, "message_templates")).toHaveLength(3);
    expect(await list(dataProvider, "automessage_rules")).toHaveLength(3);
    const tasks = await list<Task>(dataProvider, "tasks");
    expect(tasks.some((task) => task.automessage_id != null)).toBe(true);
  });

  it("sends a waiting message from its task", async () => {
    const dataProvider = setup();
    const task = (await list<Task>(dataProvider, "tasks")).find(
      (t) => t.automessage_id != null,
    )!;
    const message = await dataProvider.sendMessage(
      task.deal_id,
      "Изменённый текст",
      task.automessage_id,
    );
    expect(message.automessage_id).toBe(task.automessage_id);
    const [row] = await list<Automessage>(dataProvider, "automessages", {
      id: task.automessage_id,
    });
    expect(row).toMatchObject({ status: "sent", text: "Изменённый текст" });
    const { data: done } = await dataProvider.getOne<Task>("tasks", {
      id: task.id,
    });
    expect(done.done_date).toBeTruthy();
    await expect(
      dataProvider.sendMessage(task.deal_id, "ещё раз", task.automessage_id),
    ).rejects.toThrow("automessages.errors.closed");
  });

  it("queues the reminder of the booked stage, moves it with the visit, cancels it on leaving", async () => {
    const dataProvider = setup();
    const { data: patient } = await dataProvider.create("patients", {
      data: { first_name: "Асель", phone_jsonb: [] },
    });
    const { data: deal } = await dataProvider.create<Deal>("deals", {
      data: {
        patient_id: patient.id,
        pipeline_id: 1,
        stage_id: 2,
        appointment_at: daysAhead(3),
      },
    });
    const queued = () =>
      list<Automessage>(dataProvider, "automessages", { deal_id: deal.id });
    expect(await queued()).toEqual([]);

    const update = async (data: Partial<Deal>) => {
      const { data: previousData } = await dataProvider.getOne<Deal>("deals", {
        id: deal.id,
      });
      await dataProvider.update("deals", { id: deal.id, data, previousData });
    };
    await update({ stage_id: 3 });
    let rows = await queued();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      timing: "before_visit",
      send_at: new Date(
        new Date(daysAhead(3)).getTime() - 24 * 60 * 60 * 1000,
      ).toISOString(),
    });

    await update({ appointment_at: daysAhead(5) });
    rows = await queued();
    expect(rows.map((row) => row.status).sort()).toEqual([
      "cancelled",
      "pending",
    ]);

    await update({ stage_id: 4 });
    rows = await queued();
    expect(rows.every((row) => row.status === "cancelled")).toBe(true);
  });

  it("lets an employee cancel a queued message, and nothing else", async () => {
    const dataProvider = setup();
    const row = (await list<Automessage>(dataProvider, "automessages")).find(
      (a) => a.status === "pending",
    )!;
    await expect(
      dataProvider.update("automessages", {
        id: row.id,
        data: { status: "sent" },
        previousData: row,
      }),
    ).rejects.toThrow();
    await dataProvider.update("automessages", {
      id: row.id,
      data: { status: "cancelled" },
      previousData: row,
    });
    const { data } = await dataProvider.getOne<Automessage>("automessages", {
      id: row.id,
    });
    expect(data).toMatchObject({
      status: "cancelled",
      error: "Отменено сотрудником",
    });
  });
});
