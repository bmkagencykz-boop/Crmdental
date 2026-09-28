import { describe, expect, it } from "vitest";

import type { TreatmentPlanItem } from "../treatment/types";
import {
  chartMarks,
  historyOfTooth,
  plannedToothStates,
  servicesByTooth,
  STATE_LOOK,
  stateCounts,
  toothChange,
  toothStateForService,
} from "./toothStates";
import { TOOTH_STATES, type ToothHistoryRow } from "./types";

const item = (patch: Partial<TreatmentPlanItem>): TreatmentPlanItem => ({
  id: 1,
  plan_id: 1,
  stage_no: 1,
  name: "",
  quantity: 1,
  unit_price: 0,
  discount_percent: 0,
  done: false,
  position: 0,
  ...patch,
});

// The same names as supabase/tests/037_patient_card.test.sql
describe("toothStateForService", () => {
  it("maps a done service to the state of the tooth", () => {
    expect(toothStateForService("Пломба светоотверждаемая")).toBe("filling");
    expect(toothStateForService("Лечение каналов (эндодонтия)")).toBe(
      "filling",
    );
    expect(toothStateForService("Коронка металлокерамическая")).toBe("crown");
    expect(toothStateForService("Установка импланта Osstem")).toBe("implant");
    expect(toothStateForService("Коронка на имплант")).toBe("implant");
    expect(toothStateForService("Удаление зуба сложное")).toBe("missing");
  });
  it("leaves the chart alone for other services", () => {
    expect(toothStateForService("Снятие коронки")).toBeNull();
    expect(toothStateForService("Консультация")).toBeNull();
    expect(toothStateForService("Профессиональная гигиена")).toBeNull();
    expect(toothStateForService(null)).toBeNull();
  });
});

describe("plannedToothStates", () => {
  it("sets the teeth of an item when it becomes done", () => {
    expect(
      plannedToothStates(
        item({ name: "Коронка циркониевая", tooth: "11-12", done: true }),
        false,
      ),
    ).toEqual([
      { tooth: 12, state: "crown" },
      { tooth: 11, state: "crown" },
    ]);
  });
  it("does nothing for a planned item, an item already done or a jaw", () => {
    expect(
      plannedToothStates(item({ name: "Пломба", tooth: "36" }), false),
    ).toEqual([]);
    expect(
      plannedToothStates(
        item({ name: "Пломба", tooth: "36", done: true }),
        true,
      ),
    ).toEqual([]);
    expect(
      plannedToothStates(
        item({ name: "Удаление", tooth: "Верхняя челюсть", done: true }),
        false,
      ),
    ).toEqual([]);
  });
});

describe("chart marks", () => {
  const items = [
    item({ id: 1, name: "Пломба", tooth: "36" }),
    item({ id: 2, name: "Удаление", tooth: "46", done: true }),
    item({ id: 3, name: "Имплант", tooth: "46", plan_id: 2 }),
    item({ id: 4, name: "Коронка", tooth: "11", stage_id: 9 }),
  ];
  const services = servicesByTooth(
    items,
    [{ id: 2, status: "declined" }],
    [{ id: 9, status: "cancelled" }],
  );

  it("groups the services by tooth, without declined plans or cancelled stages", () => {
    expect(services).toEqual({
      36: { planned: ["Пломба"], done: [] },
      46: { planned: [], done: ["Удаление"] },
    });
  });

  it("colours the states and dots the services", () => {
    const marks = chartMarks(
      [
        { tooth: 36, state: "caries", note: "глубокий" },
        { tooth: 46, state: "missing" },
        { tooth: 21, state: "healthy" },
      ],
      services,
      (state) => state,
      { planned: "План", done: "Сделано" },
    );
    expect(marks[36]).toEqual({
      color: STATE_LOOK.caries.color,
      glyph: "caries",
      badge: "planned",
      title: "caries · глубокий · План: Пломба",
    });
    expect(marks[46]).toMatchObject({ glyph: "missing", badge: "done" });
    // A healthy tooth keeps the default colour
    expect(marks[21].color).toBeUndefined();
  });

  it("has a look for every state and counts them", () => {
    for (const state of TOOTH_STATES) expect(STATE_LOOK[state]).toBeTruthy();
    expect(
      stateCounts([
        { state: "caries" },
        { state: "caries" },
        { state: "crown" },
      ]),
    ).toEqual({ caries: 2, crown: 1 });
  });
});

describe("history", () => {
  it("writes a change only when the state or the note changes", () => {
    expect(
      toothChange(
        { state: "caries", note: "a" },
        { state: "caries", note: "a " },
      ),
    ).toBeNull();
    expect(toothChange(null, { state: "caries", note: " глубокий " })).toEqual({
      state_before: null,
      state: "caries",
      note_before: null,
      note: "глубокий",
    });
    expect(toothChange({ state: "root" }, null)).toEqual({
      state_before: "root",
      state: null,
      note_before: null,
      note: null,
    });
  });

  it("lists the changes of a tooth, newest first", () => {
    const rows = [
      { id: 1, tooth: 36, created_at: "2026-09-01T10:00:00Z" },
      { id: 2, tooth: 11, created_at: "2026-09-02T10:00:00Z" },
      { id: 3, tooth: 36, created_at: "2026-09-03T10:00:00Z" },
    ] as ToothHistoryRow[];
    expect(historyOfTooth(rows, 36).map((row) => row.id)).toEqual([3, 1]);
  });
});
