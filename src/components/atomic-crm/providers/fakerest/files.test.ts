import { beforeAll, describe, expect, it } from "vitest";

import type { AuditLogEntry, DealFile, Message } from "../../types";
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

const setup = (identity = 0) => {
  const db = generateData();
  const dataProvider = createDataProvider({
    db,
    latency: 0,
    silent: true,
    authProvider: {
      getIdentity: async () => ({ id: identity, fullName: "Сотрудник" }),
    },
  });
  return { db, dataProvider };
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

describe("demo files", () => {
  it("has files on deals and in some conversations, all inline", () => {
    const { db } = setup();
    expect(db.deal_files.length).toBeGreaterThan(4);
    expect(db.deal_files.every((file) => file.path.startsWith("data:"))).toBe(
      true,
    );
    const chat = db.messages.filter((message) => message.attachment_path);
    expect(chat.some((message) => message.direction === "in")).toBe(true);
    expect(
      chat.some(
        (message) =>
          message.direction === "out" &&
          message.attachment_mime === "application/pdf",
      ),
    ).toBe(true);
    // Every chat file is also listed in its deal, with its patient
    for (const message of chat) {
      const file = db.deal_files.find((f) => f.message_id === message.id);
      expect(file?.deal_id).toBe(message.deal_id);
      expect(file?.patient_id).toBe(message.patient_id);
    }
    expect(new Set(db.messages.map((m) => m.id)).size).toBe(db.messages.length);
  });

  it("uploads a file to a deal, lists it for the patient and logs it", async () => {
    const { db, dataProvider } = setup();
    const deal = db.deals[0];
    const file = new File(["%PDF-1.4"], "План.pdf", {
      type: "application/pdf",
    });
    const row = await dataProvider.uploadDealFile(deal.id, file);
    expect(row).toMatchObject({
      deal_id: deal.id,
      patient_id: deal.patient_id,
      name: "План.pdf",
      mime: "application/pdf",
      size: 8,
      sales_id: 0,
      message_id: null,
    });
    expect(row.path).toMatch(/^data:application\/pdf;base64,/);
    expect(await dataProvider.getFileUrl(row.path)).toBe(row.path);
    const forPatient = await list<DealFile>(dataProvider, "deal_files", {
      patient_id: deal.patient_id,
    });
    expect(forPatient.map((f) => f.id)).toContain(row.id);
    const audit = await list<AuditLogEntry>(dataProvider, "audit_log", {
      entity: "file",
    });
    expect(audit.at(-1)).toMatchObject({ action: "create", deal_id: deal.id });
  });

  it("refuses big and unsupported files", async () => {
    const { db, dataProvider } = setup();
    await expect(
      dataProvider.uploadDealFile(
        db.deals[0].id,
        new File(["MZ"], "setup.exe", { type: "application/x-msdownload" }),
      ),
    ).rejects.toThrow("files.errors.type_not_allowed");
    const big = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "clip.mp4", {
      type: "video/mp4",
    });
    await expect(
      dataProvider.uploadDealFile(db.deals[0].id, big),
    ).rejects.toThrow("files.errors.too_large");
  });

  it("sends a file with a caption in the chat and lists it in the deal", async () => {
    const { db, dataProvider } = setup();
    const deal = db.deals[0];
    const message = await dataProvider.sendMessage(
      deal.id,
      "Ваш снимок",
      null,
      new File(["<svg/>"], "Снимок.svg", { type: "image/svg+xml" }),
    );
    expect(message).toMatchObject({
      direction: "out",
      text: "Ваш снимок",
      content_type: "image",
      attachment_name: "Снимок.svg",
      attachment_mime: "image/svg+xml",
    });
    const files = await list<DealFile>(dataProvider, "deal_files", {
      deal_id: deal.id,
    });
    expect(files.find((f) => f.message_id === message.id)?.name).toBe(
      "Снимок.svg",
    );
    const messages = await list<Message>(dataProvider, "messages", {
      deal_id: deal.id,
    });
    expect(messages.at(-1)?.attachment_path).toMatch(/^data:image\/svg\+xml/);
  });

  it("lets the uploader, the owner and the head delete, not a colleague", async () => {
    const db = generateData();
    const manager = db.sales.find((sale) => sale.role === "manager")!;
    const colleague = db.sales.find(
      (sale) => sale.role === "manager" && sale.id !== manager.id,
    )!;
    const owner = db.sales.find((sale) => sale.role === "owner")!;
    // One demo database, the signed-in employee changes
    let me = manager.id;
    const dataProvider = createDataProvider({
      db,
      latency: 0,
      silent: true,
      authProvider: { getIdentity: async () => ({ id: me }) },
    });
    const deal = db.deals[0];
    const mine = await dataProvider.uploadDealFile(
      deal.id,
      new File(["x"], "a.txt", { type: "text/plain" }),
    );
    me = colleague.id;
    await expect(dataProvider.deleteDealFile(mine)).rejects.toThrow(
      "files.errors.delete",
    );
    const other = await dataProvider.uploadDealFile(
      deal.id,
      new File(["y"], "b.txt", { type: "text/plain" }),
    );
    me = manager.id;
    await dataProvider.deleteDealFile(mine);
    me = owner.id;
    const chatFile = db.deal_files.find((file) => file.message_id != null)!;
    await expect(dataProvider.deleteDealFile(chatFile)).rejects.toThrow(
      "files.errors.delete",
    );
    await dataProvider.deleteDealFile(other);
    const left = await list<DealFile>(dataProvider, "deal_files", {
      deal_id: deal.id,
    });
    expect(left.map((f) => f.id)).not.toContain(mine.id);
    expect(left.map((f) => f.id)).not.toContain(other.id);
  });
});
