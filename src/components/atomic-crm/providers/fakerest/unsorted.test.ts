import { beforeAll, describe, expect, it } from "vitest";

import type {
  AuditLogEntry,
  Deal,
  LostReason,
  Message,
  OrganizationSettings,
  Patient,
  Stage,
  Task,
} from "../../types";
import { groupDuplicates } from "../../duplicates/duplicates";
import type { UnsortedLead } from "../../unsorted/unsorted";
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

const leadOf = async (dataProvider: CrmDataProvider, channel: string) =>
  (await list<UnsortedLead>(dataProvider, "unsorted_leads")).find(
    (lead) => lead.channel === channel,
  )!;

describe("demo «Неразобранное»", () => {
  it("has unsorted leads of every channel, hidden from the board", async () => {
    const dataProvider = setup();
    const leads = await list<UnsortedLead>(dataProvider, "unsorted_leads");
    expect(leads.map((lead) => lead.channel).sort()).toEqual([
      "call",
      "form",
      "instagram",
      "whatsapp",
    ]);
    const board = await list<Deal>(dataProvider, "deals", {
      "unsorted_at@is": null,
    });
    expect(board.some((deal) => deal.unsorted_at)).toBe(false);
    expect(
      await list<Deal>(dataProvider, "deals", { "unsorted_at@not.is": null }),
    ).toHaveLength(4);
  });

  it("accept runs the automations of a new deal", async () => {
    const dataProvider = setup();
    const lead = await leadOf(dataProvider, "whatsapp");
    const before = (await list<Task>(dataProvider, "tasks")).filter(
      (task) => task.deal_id === lead.id,
    );
    expect(before).toHaveLength(0);
    await dataProvider.acceptUnsorted(lead.id, null, 2);
    const { data: deal } = await dataProvider.getOne<Deal>("deals", {
      id: lead.id,
    });
    expect(deal.unsorted_at).toBeNull();
    expect(deal.sales_id).toBe(2);
    const tasks = (await list<Task>(dataProvider, "tasks")).filter(
      (task) => task.deal_id === lead.id,
    );
    expect(tasks.map((task) => task.text)).toContain(
      "Связаться с пациентом по новому обращению",
    );
    expect(tasks.every((task) => task.sales_id === 2)).toBe(true);
    await expect(dataProvider.acceptUnsorted(lead.id)).rejects.toThrow(
      "unsorted.errors.not_unsorted",
    );
  });

  it("reject closes the lead as spam", async () => {
    const dataProvider = setup();
    const lead = await leadOf(dataProvider, "call");
    await dataProvider.rejectUnsorted(lead.id, "Ошиблись номером");
    const [deal, stages, reasons, tasks] = await Promise.all([
      dataProvider.getOne<Deal>("deals", { id: lead.id }).then((r) => r.data),
      list<Stage>(dataProvider, "stages"),
      list<LostReason>(dataProvider, "lost_reasons"),
      list<Task>(dataProvider, "tasks"),
    ]);
    expect(stages.find((s) => s.id === deal.stage_id)?.kind).toBe("lost");
    expect(reasons.find((r) => r.id === deal.lost_reason_id)).toMatchObject({
      name: "Спам / не целевое",
      code: "spam",
    });
    expect(deal.lost_comment).toBe("Ошиблись номером");
    expect(
      tasks.filter((t) => t.deal_id === lead.id && !t.done_date),
    ).toHaveLength(0);
  });

  it("merges a lead into the deal of the patient it duplicates", async () => {
    const dataProvider = setup();
    const lead = await leadOf(dataProvider, "instagram");
    const duplicates = await dataProvider.getPatientDuplicates(lead.patient_id);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].reasons).toEqual(["chat"]);
    const [stages, deals] = await Promise.all([
      list<Stage>(dataProvider, "stages"),
      list<Deal>(dataProvider, "deals"),
    ]);
    const open = new Set(
      stages.filter((s) => s.kind === "open").map((s) => s.id),
    );
    const target =
      deals.find(
        (d) =>
          d.patient_id === duplicates[0].patient_id &&
          open.has(d.stage_id) &&
          !d.archived_at,
      ) ??
      deals.find(
        (d) => open.has(d.stage_id) && !d.unsorted_at && !d.archived_at,
      )!;
    const result = await dataProvider.mergeUnsorted(lead.id, target.id);
    expect(result.deal_id).toBe(target.id);
    expect(
      (await list<Deal>(dataProvider, "deals")).some((d) => d.id === lead.id),
    ).toBe(false);
    const moved = (await list<Message>(dataProvider, "messages")).filter(
      (m) => m.chat_id === "ig-demo-lead",
    );
    expect(moved.length).toBeGreaterThan(0);
    expect(
      moved.every(
        (m) => m.deal_id === target.id && m.patient_id === target.patient_id,
      ),
    ).toBe(true);
    // The Instagram contact had no other deal: it joined the deal's patient
    expect(result.merged_patient_id).toBe(lead.patient_id);
    expect(
      (await list<Patient>(dataProvider, "patients")).some(
        (p) => p.id === lead.patient_id,
      ),
    ).toBe(false);
  });

  it("follows the clinic setting for new leads", async () => {
    const dataProvider = setup();
    await dataProvider.updateOrganizationSettings({ unsorted_enabled: false });
    await dataProvider.sendTestLead("");
    const off = (await list<Deal>(dataProvider, "deals")).at(-1)!;
    expect(off.unsorted_at ?? null).toBeNull();
    const settings = (
      await list<OrganizationSettings>(dataProvider, "organization_settings")
    )[0];
    expect(settings.unsorted_enabled).toBe(false);
  });
});

describe("demo duplicates", () => {
  it("finds the duplicate pairs by phone, chat and name with birth date", async () => {
    const dataProvider = setup();
    const groups = groupDuplicates(await dataProvider.getDuplicateGroups());
    const reasons = groups.flatMap((group) => group.reasons);
    expect(reasons).toContain("phone");
    expect(reasons).toContain("chat");
    expect(reasons).toContain("name_birth");
  });

  it("merges two patients (owner and head only) with an audit row", async () => {
    const owner = setup(0);
    const group = groupDuplicates(await owner.getDuplicateGroups()).find((g) =>
      g.reasons.includes("name_birth"),
    )!;
    const [keep, merge] = group.patients.map((p) => p.patient_id);
    const manager = setup(1);
    await expect(manager.mergePatients(keep, merge, {})).rejects.toThrow(
      "duplicates.errors.forbidden",
    );
    await owner.mergePatients(keep, merge, { comment: "merge" });
    const patients = await list<Patient>(owner, "patients");
    expect(patients.some((p) => p.id === merge)).toBe(false);
    const kept = patients.find((p) => p.id === keep)!;
    expect(kept.background).toBe(
      "Записывалась по телефону, карту завели заново",
    );
    expect(kept.phones).toContain("+77473015518");
    expect(
      (await list<any>(owner, "patient_notes")).some(
        (n) => n.patient_id === keep && n.text === "Аллергия на лидокаин",
      ),
    ).toBe(true);
    const audit = (await list<AuditLogEntry>(owner, "audit_log")).find(
      (row) => row.action === "merge",
    );
    expect(audit).toMatchObject({
      entity: "patient",
      entity_id: keep,
      changes: { merged_patient_id: [merge, keep] },
    });
    expect(await owner.getPatientDuplicates(keep)).toEqual([]);
  });
});
