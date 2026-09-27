import { beforeAll, describe, expect, it } from "vitest";

import type {
  StageTrigger,
  StageTriggerRun,
  Webhook,
  WebhookDelivery,
} from "../../pipeline-automation/types";
import type { AuditLogEntry, Deal } from "../../types";
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

const runsOf = async (dataProvider: CrmDataProvider, dealId: unknown) =>
  (await list<StageTriggerRun>(dataProvider, "stage_trigger_runs")).filter(
    (run) => String(run.deal_id) === String(dealId),
  );

const newDeal = async (
  dataProvider: CrmDataProvider,
  pipelineId: number,
  stageId: number,
) => {
  const { data } = await dataProvider.create<Deal>("deals", {
    data: {
      patient_id: 1,
      name: "Тест воронки",
      pipeline_id: pipelineId,
      stage_id: stageId,
    },
  });
  return data;
};

describe("demo digital pipeline", () => {
  it("has triggers, runs in the feed, a webhook with deliveries and an API key", async () => {
    const dataProvider = setup();
    expect(
      (await list<StageTrigger>(dataProvider, "stage_triggers")).length,
    ).toBeGreaterThan(3);
    expect(
      (await list<StageTriggerRun>(dataProvider, "stage_trigger_runs")).length,
    ).toBeGreaterThan(0);
    expect(await list<Webhook>(dataProvider, "webhooks")).toHaveLength(1);
    expect(
      (await list<WebhookDelivery>(dataProvider, "webhook_deliveries")).length,
    ).toBeGreaterThan(3);
    expect(await dataProvider.listApiKeys()).toHaveLength(1);
  });

  it("a payment moves the deal, logs the run and notifies the webhook", async () => {
    const dataProvider = setup();
    const deal = await newDeal(dataProvider, 1, 5);
    await dataProvider.create("deal_payments", {
      data: { deal_id: deal.id, amount: 50_000 },
    });
    const { data: moved } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    expect(moved.stage_id).toBe(6);
    expect(await runsOf(dataProvider, deal.id)).toMatchObject([
      {
        action: "move_stage",
        status: "done",
        trigger_name: "Оплата получена",
        details: { from_stage_id: 5, to_stage_id: 6 },
      },
    ]);
    const audit = await list<AuditLogEntry>(dataProvider, "audit_log");
    expect(
      audit.some(
        (row) =>
          String(row.deal_id) === String(deal.id) &&
          row.action === "stage_change" &&
          row.source === "automation" &&
          row.sales_id == null,
      ),
    ).toBe(true);
    // Listing the deliveries "sends" them: nothing leaves the browser
    const deliveries = await list<WebhookDelivery>(
      dataProvider,
      "webhook_deliveries",
    );
    const mine = deliveries.filter(
      (d) =>
        String((d.payload.data as { deal_id?: unknown })?.deal_id) ===
        String(deal.id),
    );
    expect(mine.map((d) => d.event).sort()).toEqual([
      "deal.created",
      "deal.stage_changed",
      "payment.added",
    ]);
    expect(mine.every((d) => d.status === "delivered")).toBe(true);
  });

  it("a chain of moves stops at the depth limit", async () => {
    const dataProvider = setup();
    for (const [stage, target] of [
      [9, 10],
      [10, 9],
    ]) {
      await dataProvider.create("stage_triggers", {
        data: {
          stage_id: stage,
          event: "stage_entered",
          action: "move_stage",
          target_stage_id: target,
        },
      });
    }
    const deal = await newDeal(dataProvider, 2, 9);
    const runs = await runsOf(dataProvider, deal.id);
    expect(runs.map((run) => run.status)).toEqual([
      "done",
      "done",
      "done",
      "skipped",
    ]);
    expect(runs[3].error).toMatch(/Слишком длинная цепочка/);
  });

  it("a move blocked by the stage checklist is skipped", async () => {
    const dataProvider = setup();
    await dataProvider.create("stage_checklist_items", {
      data: { stage_id: 2, text: "Уточнить жалобы", position: 0 },
    });
    await dataProvider.create("stage_triggers", {
      data: {
        stage_id: 2,
        name: "Записали",
        event: "appointment_set",
        action: "move_stage",
        target_stage_id: 3,
      },
    });
    const deal = await newDeal(dataProvider, 1, 2);
    const { data: current } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    await dataProvider.update("deals", {
      id: deal.id,
      data: { appointment_at: new Date(Date.now() + 86_400_000).toISOString() },
      previousData: current,
    });
    const { data: after } = await dataProvider.getOne<Deal>("deals", {
      id: deal.id,
    });
    expect(after.stage_id).toBe(2);
    expect(await runsOf(dataProvider, deal.id)).toMatchObject([
      {
        action: "move_stage",
        status: "skipped",
        error: "Выполните чек-лист этапа «В работе»",
      },
    ]);
  });

  it("refuses an incomplete trigger", async () => {
    const dataProvider = setup();
    await expect(
      dataProvider.create("stage_triggers", {
        data: { stage_id: 1, event: "message_in", action: "add_tag" },
      }),
    ).rejects.toThrow("pipeline_automation.errors.incomplete");
  });

  it("shows an API key once, then only its prefix; revokes it", async () => {
    const dataProvider = setup();
    const created = await dataProvider.createApiKey("МИС", "read");
    expect(created.key).toMatch(/^dcrm_[0-9a-f]{64}$/);
    const keys = await dataProvider.listApiKeys();
    const listed = keys.find((key) => key.id === created.id)!;
    expect(listed.prefix).toBe(created.key.slice(0, 12));
    expect("key" in listed).toBe(false);
    await dataProvider.revokeApiKey(created.id);
    expect(
      (await dataProvider.listApiKeys()).find((key) => key.id === created.id)
        ?.revoked_at,
    ).toBeTruthy();
  });

  it("tests a webhook and refuses private addresses", async () => {
    const dataProvider = setup();
    await dataProvider.sendTestWebhook(1);
    const deliveries = await list<WebhookDelivery>(
      dataProvider,
      "webhook_deliveries",
    );
    expect(deliveries.some((d) => d.event === "ping")).toBe(true);
    await expect(
      dataProvider.create("webhooks", {
        data: { url: "http://127.0.0.1:54321/", events: [] },
      }),
    ).rejects.toThrow("api.errors.webhook_private");
  });
});
