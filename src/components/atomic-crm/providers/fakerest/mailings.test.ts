import { beforeAll, describe, expect, it } from "vitest";

import type {
  MailingMessage,
  MailingSummary,
  Recall,
  RecallRule,
} from "../../mailings/types";
import type { Deal, LeadSource } from "../../types";
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

const setup = (id = 0) =>
  createDataProvider({
    db: generateData(),
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id, fullName: "User" }) },
  });

const list = async <T>(dataProvider: CrmDataProvider, resource: string) =>
  (
    await dataProvider.getList(resource, {
      filter: {},
      pagination: { page: 1, perPage: 10_000 },
      sort: { field: "id", order: "ASC" },
    })
  ).data as T[];

describe("demo repeat sales and mailings", () => {
  it("has recall rules, a mailing in progress and upcoming recalls", async () => {
    const dataProvider = setup();
    expect(await list<RecallRule>(dataProvider, "recall_rules")).toHaveLength(
      2,
    );
    const [mailing] = await list<MailingSummary>(
      dataProvider,
      "mailings_summary",
    );
    expect(mailing.recipients_count).toBeGreaterThan(0);
    expect(mailing.sent_count).toBeGreaterThan(0);
    expect(mailing.read_count).toBeGreaterThan(0);
    expect(mailing.failed_count).toBe(1);
    const report = await dataProvider.getRecallReport({});
    expect(report.upcoming.length).toBeGreaterThan(0);
    expect(report.totals.upcoming).toBe(report.upcoming.length);
  });

  it("the daily job creates the due recall deals once", async () => {
    const dataProvider = setup();
    const first = await dataProvider.getRecallReport({});
    const recalls = await list<Recall>(dataProvider, "recalls");
    expect(recalls.length).toBeGreaterThan(0);
    expect(first.recalls).toHaveLength(recalls.length);
    const created = recalls.filter((r) => r.status === "created");
    for (const recall of created) {
      const { data: deal } = await dataProvider.getOne<Deal>("deals", {
        id: recall.recall_deal_id!,
      });
      expect(deal.name).toMatch(/^Повторный визит: /);
      const sources = await list<LeadSource>(dataProvider, "lead_sources");
      expect(sources.find((s) => s.id === deal.source_id)?.code).toBe("repeat");
    }
    for (const recall of recalls.filter((r) => r.status === "skipped")) {
      expect(recall.reason).toBe("У пациента уже есть открытая сделка");
    }
    await dataProvider.getRecallReport({});
    expect(await list<Recall>(dataProvider, "recalls")).toHaveLength(
      recalls.length,
    );
  });

  it("queues a mailing to a segment and cancels it", async () => {
    const dataProvider = setup();
    const preview = await dataProvider.getSegmentPreview({ tag_ids: [0] });
    expect(preview.count).toBeGreaterThan(0);
    const { data } = await dataProvider.create("mailings", {
      data: {
        name: "Тест",
        segment: { tag_ids: [0] },
        body: "Здравствуйте, {имя}!",
        scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const rows = (
      await list<MailingMessage>(dataProvider, "mailing_messages")
    ).filter((row) => row.mailing_id === data.id);
    expect(rows).toHaveLength(preview.count);
    expect(rows.every((row) => row.status === "pending")).toBe(true);

    // Opting a recipient out cancels its message
    await dataProvider.setPatientOptOut(rows[0].patient_id, true);
    expect(
      (await dataProvider.getPatientOptOut(rows[0].patient_id))
        .messaging_opt_out,
    ).toBe(true);
    const { data: mailing } = await dataProvider.getOne("mailings", {
      id: data.id,
    });
    await dataProvider.update("mailings", {
      id: data.id,
      data: { status: "cancelled" },
      previousData: mailing,
    });
    const after = (
      await list<MailingMessage>(dataProvider, "mailing_messages")
    ).filter((row) => row.mailing_id === data.id);
    expect(after.every((row) => row.status === "cancelled")).toBe(true);
    await expect(
      dataProvider.update("mailings", {
        id: data.id,
        data: { status: "scheduled" },
        previousData: { ...mailing, status: "cancelled" },
      }),
    ).rejects.toThrow("mailings.errors.status_locked");
  });

  it("refuses the segments to a manager", async () => {
    const db = generateData();
    const manager = db.sales.find((sale) => sale.role === "manager")!;
    const dataProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: {
        getIdentity: async () => ({ id: manager.id, fullName: "M" }),
      },
    });
    await expect(dataProvider.getSegmentPreview({})).rejects.toThrow(
      "mailings.forbidden",
    );
  });
});
