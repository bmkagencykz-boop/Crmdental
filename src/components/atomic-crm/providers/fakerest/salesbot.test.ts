import { beforeAll, describe, expect, it } from "vitest";

import type {
  Salesbot,
  SalesbotLog,
  SalesbotSession,
} from "../../salesbot/types";
import type { StageTriggerRun } from "../../pipeline-automation/types";
import type { Automessage, Deal, Stage } from "../../types";
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

const setup = (identity = 0) =>
  createDataProvider({
    db: generateData(),
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({ id: identity, fullName: "Employee" }),
    },
  });

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

const sessionOf = async (dataProvider: CrmDataProvider, dealId: unknown) =>
  (await list<SalesbotSession>(dataProvider, "salesbot_sessions"))
    .filter((s) => String(s.deal_id) === String(dealId))
    .at(-1);

const newDeal = async (dataProvider: CrmDataProvider) => {
  const stages = await list<Stage>(dataProvider, "stages");
  const first = stages
    .filter((s) => s.pipeline_id === 1)
    .sort((a, b) => a.position - b.position)[0];
  const { data } = await dataProvider.create<Deal>("deals", {
    data: {
      patient_id: 1,
      name: "Тест бота",
      pipeline_id: 1,
      stage_id: first.id,
      sales_id: 0,
    },
  });
  return data;
};

describe("demo salesbot", () => {
  it("has the consultation bot on, the reactivation off, and history", async () => {
    const dataProvider = setup();
    const bots = await list<Salesbot>(dataProvider, "salesbots");
    expect(bots.map((b) => [b.name, b.is_active])).toEqual([
      ["Первичная консультация", true],
      ["Реактивация отказа", false],
    ]);
    expect(bots[0].trigger_new_lead).toBe(true);
    expect(bots[0].trigger_transports).toEqual(["whatsapp"]);
    const sessions = await list<SalesbotSession>(
      dataProvider,
      "salesbot_sessions",
    );
    expect(sessions.map((s) => s.status)).toEqual([
      "waiting",
      "handed_off",
      "done",
    ]);
    const logs = await list<SalesbotLog>(dataProvider, "salesbot_logs");
    expect(logs.filter((l) => l.kind === "sent").length).toBeGreaterThan(4);
  });

  it("starts by hand, queues the greeting, stops when an employee answers", async () => {
    const dataProvider = setup();
    const deal = await newDeal(dataProvider);
    await dataProvider.startSalesbot(deal.id, 1);
    const session = await sessionOf(dataProvider, deal.id);
    expect(session).toMatchObject({
      status: "waiting",
      trigger: "manual",
      current_step: "wait_need",
    });
    const queued = (await list<Automessage>(dataProvider, "automessages")).filter(
      (row) => String(row.salesbot_session_id) === String(session!.id),
    );
    // The demo dispatcher "sends" due messages when the queue is read
    expect(queued).toHaveLength(1);
    expect(queued[0].text).toContain("1 — Боль");

    await dataProvider.sendMessage(deal.id, "Здравствуйте, это администратор");
    expect((await sessionOf(dataProvider, deal.id))?.status).toBe("stopped");
  });

  it("replaces the running session, refuses an inactive bot", async () => {
    const dataProvider = setup();
    const deal = await newDeal(dataProvider);
    await dataProvider.startSalesbot(deal.id, 1);
    await expect(dataProvider.startSalesbot(deal.id, 2)).rejects.toThrow(
      "salesbot.errors.inactive",
    );
    await dataProvider.update("salesbots", {
      id: 2,
      data: { is_active: true },
      previousData: {},
    });
    await dataProvider.startSalesbot(deal.id, 2);
    const sessions = (
      await list<SalesbotSession>(dataProvider, "salesbot_sessions")
    ).filter((s) => String(s.deal_id) === String(deal.id));
    expect(sessions.map((s) => s.status)).toEqual(["stopped", "waiting"]);
    expect(await dataProvider.stopSalesbot(deal.id)).toBe(true);
    expect(await dataProvider.stopSalesbot(deal.id)).toBe(false);
  });

  it("checks the scenario on save and bumps the version", async () => {
    const dataProvider = setup();
    await expect(
      dataProvider.create("salesbots", {
        data: {
          name: "Сломанный",
          is_active: true,
          scenario: { start: "a", steps: [{ id: "a", type: "wait_reply" }] },
        },
      }),
    ).rejects.toThrow("salesbot.errors.invalid");
    const { data } = await dataProvider.create<Salesbot>("salesbots", {
      data: {
        name: "Черновик",
        scenario: { start: "a", steps: [{ id: "a", type: "stop" }] },
        trigger_keywords: [" Цена ", "цена"],
      },
    });
    expect(data.version).toBe(1);
    expect(data.trigger_keywords).toEqual(["цена"]);
    const { data: updated } = await dataProvider.update<Salesbot>("salesbots", {
      id: data.id,
      data: {
        scenario: {
          start: "b",
          steps: [{ id: "b", type: "stop" }],
        },
      },
      previousData: data,
    });
    expect(updated.version).toBe(2);
  });

  it("refuses bot editing to managers", async () => {
    const dataProvider = setup(1);
    await expect(
      dataProvider.update("salesbots", {
        id: 1,
        data: { is_active: false },
        previousData: {},
      }),
    ).rejects.toThrow("salesbot.errors.forbidden");
  });

  it("starts from the digital pipeline", async () => {
    const dataProvider = setup();
    const stages = (await list<Stage>(dataProvider, "stages"))
      .filter((s) => s.pipeline_id === 1)
      .sort((a, b) => a.position - b.position);
    await dataProvider.create("stage_triggers", {
      data: {
        stage_id: stages[1].id,
        event: "stage_entered",
        action: "start_salesbot",
        salesbot_id: 1,
        name: "Бот",
      },
    });
    const deal = await newDeal(dataProvider);
    await dataProvider.update<Deal>("deals", {
      id: deal.id,
      data: { stage_id: stages[1].id },
      previousData: deal,
    });
    expect((await sessionOf(dataProvider, deal.id))?.trigger).toBe("pipeline");
    const runs = (
      await list<StageTriggerRun>(dataProvider, "stage_trigger_runs")
    ).filter((run) => String(run.deal_id) === String(deal.id));
    expect(runs.map((run) => [run.action, run.status])).toContainEqual([
      "start_salesbot",
      "done",
    ]);
  });
});
