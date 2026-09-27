import { describe, expect, it } from "vitest";

import type { Deal, Stage } from "../types";
import {
  acceptStageChoices,
  defaultAcceptStage,
  firstLeadContact,
  leadExcerpt,
  mergeTargets,
  unsortedAge,
  unsortedIntake,
  unsortedLeads,
} from "./unsorted";

const stage = (
  id: number,
  pipeline_id: number,
  position: number,
  kind: Stage["kind"] = "open",
): Stage => ({
  id,
  pipeline_id,
  position,
  kind,
  name: `S${id}`,
  color: "#fff",
});

describe("unsortedIntake", () => {
  const now = new Date("2026-09-27T10:00:00Z");
  it("is off by default", () => {
    expect(unsortedIntake(undefined, 1, now)).toBeNull();
    expect(
      unsortedIntake(
        { unsorted_enabled: false, unsorted_source_ids: [] },
        1,
        now,
      ),
    ).toBeNull();
  });
  it("takes every source when the list is empty", () => {
    expect(
      unsortedIntake(
        { unsorted_enabled: true, unsorted_source_ids: [] },
        3,
        now,
      ),
    ).toBe(now.toISOString());
    expect(
      unsortedIntake(
        { unsorted_enabled: true, unsorted_source_ids: [] },
        null,
        now,
      ),
    ).toBe(now.toISOString());
  });
  it("only takes the listed sources", () => {
    const settings = { unsorted_enabled: true, unsorted_source_ids: [1, 2] };
    expect(unsortedIntake(settings, "2", now)).toBe(now.toISOString());
    expect(unsortedIntake(settings, 5, now)).toBeNull();
    expect(unsortedIntake(settings, null, now)).toBeNull();
  });
});

describe("firstLeadContact", () => {
  it("takes the earliest incoming message, form or call", () => {
    expect(
      firstLeadContact({
        messages: [
          {
            direction: "out",
            transport: "whatsapp",
            text: "Ответ",
            sent_at: "2026-09-27T09:00:00Z",
          },
          {
            direction: "in",
            transport: "whatsapp",
            text: "Сколько стоит?",
            sent_at: "2026-09-27T09:05:00Z",
          },
        ],
        notes: [
          { type: "lead", text: "Заявка (Сайт)", date: "2026-09-27T09:10:00Z" },
        ],
        calls: [{ direction: "in", called_at: "2026-09-27T09:30:00Z" }],
      }),
    ).toEqual({
      channel: "whatsapp",
      first_text: "Сколько стоит?",
      first_at: "2026-09-27T09:05:00Z",
    });
  });
  it("falls back to the form, then to the call", () => {
    expect(
      firstLeadContact({
        messages: [],
        notes: [
          { type: null as any, text: "Заметка", date: "2026-09-27T08:00:00Z" },
          { type: "lead", text: "Заявка", date: "2026-09-27T09:00:00Z" },
        ],
        calls: [{ direction: "in", called_at: "2026-09-27T09:00:00Z" }],
      }).channel,
    ).toBe("form");
    expect(
      firstLeadContact({
        messages: [],
        notes: [],
        calls: [
          { direction: "out", called_at: "2026-09-27T08:00:00Z" },
          { direction: "in", called_at: "2026-09-27T09:00:00Z" },
        ],
      }),
    ).toEqual({
      channel: "call",
      first_text: null,
      first_at: "2026-09-27T09:00:00Z",
    });
    expect(firstLeadContact({ messages: [], notes: [], calls: [] })).toEqual({
      channel: null,
      first_text: null,
      first_at: null,
    });
  });
});

describe("unsortedLeads", () => {
  it("lists the unsorted deals with their patient and first contact", () => {
    const rows = unsortedLeads({
      deals: [
        { id: 1, patient_id: 10, unsorted_at: "2026-09-27T09:00:00Z" },
        { id: 2, patient_id: 10, unsorted_at: null },
      ] as unknown as Deal[],
      patients: [
        {
          id: 10,
          first_name: "Асель",
          last_name: "",
          phones: ["+77010000001"],
        },
      ] as any,
      messages: [
        {
          id: 1,
          deal_id: 1,
          direction: "in",
          transport: "instagram",
          text: "Привет",
          sent_at: "2026-09-27T09:00:00Z",
        },
      ] as any,
      notes: [],
      calls: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1,
      patient_first_name: "Асель",
      patient_phone: "+77010000001",
      channel: "instagram",
      first_text: "Привет",
      nb_messages: 1,
    });
  });
});

describe("leadExcerpt", () => {
  it("shows the comment of a form", () => {
    expect(
      leadExcerpt({
        channel: "form",
        first_text:
          "Заявка (Сайт)\nИмя: Мадина\nТелефон: +77010000004\nКомментарий: Нужен имплант",
      }),
    ).toBe("Нужен имплант");
    expect(
      leadExcerpt({
        channel: "form",
        first_text: "Заявка (2GIS)\nИмя: Мадина\nТелефон: +77010000004",
      }),
    ).toBe("Имя: Мадина · Телефон: +77010000004");
  });
  it("shortens a long message", () => {
    const text = "а".repeat(200);
    expect(leadExcerpt({ channel: "whatsapp", first_text: text }, 10)).toBe(
      "ааааааааа…",
    );
    expect(leadExcerpt({ channel: "call", first_text: null })).toBe("");
  });
});

describe("accept stages", () => {
  const stages = [
    stage(3, 1, 2),
    stage(1, 1, 0),
    stage(2, 1, 1),
    stage(4, 1, 3, "won"),
    stage(5, 1, 4, "lost"),
    stage(6, 2, 0),
  ];
  it("proposes the first open stage of the pipeline", () => {
    expect(defaultAcceptStage(stages, 1)?.id).toBe(1);
    expect(defaultAcceptStage(stages, 2)?.id).toBe(6);
  });
  it("offers the open stages, named by pipeline when there are several", () => {
    expect(
      acceptStageChoices(stages, [{ id: 1, name: "Основная", position: 0 }]),
    ).toEqual([
      { id: 1, name: "S1" },
      { id: 2, name: "S2" },
      { id: 3, name: "S3" },
    ]);
    expect(
      acceptStageChoices(stages, [
        { id: 2, name: "Ортодонтия", position: 1 },
        { id: 1, name: "Основная", position: 0 },
      ]).map((c) => c.name),
    ).toEqual([
      "Основная · S1",
      "Основная · S2",
      "Основная · S3",
      "Ортодонтия · S6",
    ]);
  });
});

describe("mergeTargets", () => {
  it("keeps the open deals, the lead's patient first", () => {
    const stages = [stage(1, 1, 0), stage(9, 1, 5, "lost")];
    const deal = (
      id: number,
      patient_id: number,
      stage_id: number,
      updated_at: string,
      archived_at: string | null = null,
    ) => ({ id, patient_id, stage_id, updated_at, archived_at });
    const targets = mergeTargets(
      [
        deal(1, 7, 1, "2026-09-20"),
        deal(2, 8, 1, "2026-09-25"),
        deal(3, 7, 1, "2026-09-10"),
        deal(4, 7, 9, "2026-09-26"),
        deal(5, 7, 1, "2026-09-26", "2026-09-26"),
        deal(6, 7, 1, "2026-09-27"),
      ],
      stages,
      { id: 6, patient_id: 7 },
    );
    expect(targets.map((d) => d.id)).toEqual([1, 3, 2]);
  });
});

describe("unsortedAge", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  it("reads in minutes, hours or days", () => {
    expect(unsortedAge("2026-09-27T11:55:00Z", now)).toEqual({
      unit: "minutes",
      value: 5,
    });
    expect(unsortedAge("2026-09-27T09:00:00Z", now)).toEqual({
      unit: "hours",
      value: 3,
    });
    expect(unsortedAge("2026-09-24T12:00:00Z", now)).toEqual({
      unit: "days",
      value: 3,
    });
    expect(unsortedAge("2026-09-27T13:00:00Z", now).value).toBe(0);
  });
});
