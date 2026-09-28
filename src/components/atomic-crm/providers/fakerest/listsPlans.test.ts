import { beforeAll, describe, expect, it } from "vitest";

import type { SavedFilter } from "../../deals/list/dealFilters";
import type { MailingMessage } from "../../mailings/types";
import type {
  AuditLogEntry,
  Deal,
  MessageTemplate,
  Stage,
  Task,
} from "../../types";
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
const setup = (id = 0, db = generateData()) => ({
  db,
  dataProvider: createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id, fullName: "User" }) },
  }),
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

describe("demo saved filters", () => {
  it("shows the clinic filters and my own", async () => {
    const owner = setup(0);
    expect(
      await list<SavedFilter>(owner.dataProvider, "saved_filters"),
    ).toHaveLength(3);
    const manager = setup(1, owner.db);
    const seen = await list<SavedFilter>(manager.dataProvider, "saved_filters");
    expect(seen.every((filter) => filter.sales_id == null)).toBe(true);
  });

  it("lets a manager save a personal filter, not a clinic one", async () => {
    const { dataProvider } = setup(1);
    await expect(
      dataProvider.create("saved_filters", {
        data: { name: "Общий", filter: {}, sales_id: null },
      }),
    ).rejects.toThrow();
    const { data } = await dataProvider.create("saved_filters", {
      data: { name: "Мой", filter: { sales_id: "$me" } },
    });
    expect(data.sales_id).toBe(1);
  });
});

describe("demo deal list", () => {
  it("filters the open deals without a task", async () => {
    const { dataProvider } = setup();
    const deals = await list<Deal>(dataProvider, "deals", {
      task_state: "no_task",
    });
    expect(deals.length).toBeGreaterThan(0);
    expect(
      deals.every(
        (deal) => deal.stage_kind === "open" && deal.nb_open_tasks === 0,
      ),
    ).toBe(true);
    const overdue = await list<Deal>(dataProvider, "deals", {
      task_state: "overdue",
    });
    expect(
      overdue.every(
        (deal) =>
          deal.stage_kind === "open" &&
          new Date(deal.next_task_due_at!).getTime() < Date.now(),
      ),
    ).toBe(true);
  });
});

describe("demo bulk actions", () => {
  it("reports the deals a rule refuses, changes the others and logs them", async () => {
    const { dataProvider } = setup();
    const deals = (await list<Deal>(dataProvider, "deals")).filter(
      (deal) =>
        deal.stage_kind === "open" &&
        !deal.archived_at &&
        !deal.tags.includes(5),
    );
    const stages = await list<Stage>(dataProvider, "stages");
    const lost = stages.find(
      (stage) =>
        stage.kind === "lost" && stage.pipeline_id === deals[0].pipeline_id,
    )!;
    // Two deals of the lost stage's pipeline (a lost stage of another
    // pipeline is refused for another reason)
    const ids = deals
      .filter(
        (deal) =>
          deal.pipeline_id === deals[0].pipeline_id && !deal.unsorted_at,
      )
      .slice(0, 2)
      .map((deal) => deal.id);
    const refused = await dataProvider.bulkDeals("stage", ids, {
      stage_id: lost.id,
    });
    expect(refused.failed).toBe(2);
    expect(refused.results[0].error).toBe("Укажите причину отказа");

    const tagged = await dataProvider.bulkDeals("add_tags", [...ids, 99_999], {
      tag_ids: [5],
    });
    expect(tagged.ok).toBe(2);
    expect(tagged.results[2].code).toBe("not_found");
    const log = await list<AuditLogEntry>(dataProvider, "audit_log");
    expect(
      log.filter(
        (row) =>
          ids.includes(row.deal_id!) &&
          row.changes.tags &&
          row.source === "user",
      ),
    ).toHaveLength(2);

    await dataProvider.bulkDeals("task", ids, {
      text: "Позвонить по акции",
      due_date: new Date().toISOString(),
    });
    const tasks = await list<Task>(dataProvider, "tasks");
    expect(
      tasks.filter((task) => task.text === "Позвонить по акции"),
    ).toHaveLength(2);
  });

  it("keeps messages, archive and delete for the owner and the head", async () => {
    const { dataProvider } = setup(1);
    const [deal] = await list<Deal>(dataProvider, "deals");
    await expect(dataProvider.bulkDeals("delete", [deal.id])).rejects.toThrow();
  });

  it("queues one message per patient through the mailings", async () => {
    const { dataProvider } = setup();
    const deals = (await list<Deal>(dataProvider, "deals")).slice(0, 5);
    const [template] = await list<MessageTemplate>(
      dataProvider,
      "message_templates",
    );
    const result = await dataProvider.bulkDeals(
      "message",
      deals.map((deal) => deal.id),
      { template_id: template.id },
    );
    expect(result.mailing_id).not.toBeNull();
    const queued = (
      await list<MailingMessage>(dataProvider, "mailing_messages")
    ).filter((row) => row.mailing_id === result.mailing_id);
    expect(queued).toHaveLength(result.ok);
    expect(
      queued.every((row) => deals.some((deal) => deal.id === row.deal_id)),
    ).toBe(true);
  });
});

describe("demo sales plan", () => {
  it("has a plan for this month with facts", async () => {
    const { dataProvider } = setup();
    const report = await dataProvider.getSalesPlanReport(null);
    expect(report.clinic.plan?.paid_amount).toBeGreaterThan(0);
    expect(report.by_sales.some((row) => row.plan != null)).toBe(true);
    expect(report.clinic.fact.new_deals).toBeGreaterThan(0);
  });

  it("saves the targets (owner and head only)", async () => {
    const { db, dataProvider } = setup();
    const before = await dataProvider.getSalesPlanReport(null);
    await dataProvider.saveSalesPlan(before.month, [
      {
        sales_id: null,
        new_deals: 99,
        won_deals: null,
        paid_amount: null,
        visits: null,
      },
    ]);
    const after = await dataProvider.getSalesPlanReport(before.month);
    expect(after.clinic.plan).toEqual({
      new_deals: 99,
      won_deals: null,
      paid_amount: null,
      visits: null,
    });
    const manager = setup(1, db);
    await expect(
      manager.dataProvider.getSalesPlanReport(null),
    ).rejects.toThrow();
  });
});
