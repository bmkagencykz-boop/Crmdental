import { describe, expect, it } from "vitest";

import type {
  Deal,
  DealEvent,
  DealPayment,
  Message,
  Sale,
  Stage,
  Task,
} from "../types";
import {
  conversionReport,
  keyStages,
  localDate,
  lostReport,
  moneyReport,
  speedReport,
  type ReportData,
} from "./reportMath";

/*
 * Same clinic as supabase/tests/009_reports.test.sql, with the same expected
 * numbers: the database and the demo compute the reports the same way.
 */

const HOUR = 60 * 60 * 1000;
const at = (iso: string, hours = 0) =>
  new Date(new Date(iso).getTime() + hours * HOUR).toISOString();

const STAGES: Stage[] = [
  ["Новый лид", "open"],
  ["В работе", "open"],
  ["Записан", "open"],
  ["Пришёл на консультацию", "open"],
  ["План согласован", "open"],
  ["В лечении", "open"],
  ["Лечение завершено", "won"],
  ["Отказ", "lost"],
].map(([name, kind], position) => ({
  id: position + 1,
  pipeline_id: 1,
  name,
  position,
  kind: kind as Stage["kind"],
  color: "#000",
}));
const stageId = (name: string) => STAGES.find((s) => s.name === name)!.id;

const sale = (id: number, first_name: string, disabled = false): Sale => ({
  id,
  organization_id: 1,
  first_name,
  last_name: "Test",
  role: id === 1 ? "owner" : id === 2 ? "head" : "manager",
  administrator: id !== 3,
  user_id: String(id),
  email: `${first_name}@clinic.kz`,
  disabled,
});
const OWNER = 1;
const HEAD = 2;
const M1 = 3;

const buildData = (): ReportData => {
  const deals: Deal[] = [];
  const events: DealEvent[] = [];
  const addDeal = (
    id: number,
    options: {
      source: number;
      service: number;
      sales: number;
      plan: number;
      created: string;
      path: string[];
      steps: number[];
      paid?: number;
      firstResponseMinutes?: number;
    },
  ) => {
    const times = [options.created];
    options.steps.forEach((hours) =>
      times.push(at(times[times.length - 1], hours)),
    );
    const path = ["Новый лид", ...options.path];
    path.forEach((name, index) =>
      events.push({
        id: events.length + 1,
        deal_id: id,
        type: index === 0 ? "created" : "stage_changed",
        from_stage_id: index === 0 ? null : stageId(path[index - 1]),
        to_stage_id: stageId(name),
        changes: {},
        created_at: times[index],
      }),
    );
    const last = path[path.length - 1];
    const kind = STAGES.find((s) => s.name === last)!.kind;
    deals.push({
      id,
      patient_id: 1,
      pipeline_id: 1,
      stage_id: stageId(last),
      name: `d${id}`,
      source_id: options.source,
      service_id: options.service,
      sales_id: options.sales,
      plan_amount: options.plan,
      paid_amount: options.paid ?? 0,
      lost_reason_id: kind === "lost" ? 1 : null,
      tags: [],
      index: 0,
      created_at: options.created,
      updated_at: times[times.length - 1],
      stage_changed_at: times[times.length - 1],
      closed_at: kind === "open" ? null : times[times.length - 1],
      first_response_at:
        options.firstResponseMinutes != null
          ? at(options.created, options.firstResponseMinutes / 60)
          : null,
    });
  };
  const sept10 = "2026-09-10T10:00:00+05:00";
  addDeal(1, {
    source: 1,
    service: 1,
    sales: M1,
    plan: 300000,
    created: sept10,
    path: ["Записан", "Пришёл на консультацию", "План согласован", "В лечении"],
    steps: [1, 2, 3, 4],
    paid: 150000,
    firstResponseMinutes: 30,
  });
  addDeal(2, {
    source: 1,
    service: 3,
    sales: M1,
    plan: 50000,
    created: sept10,
    path: ["Записан", "Отказ"],
    steps: [1, 4],
  });
  addDeal(3, {
    source: 2,
    service: 4,
    sales: HEAD,
    plan: 20000,
    created: "2026-09-20T10:00:00+05:00",
    path: [],
    steps: [],
    firstResponseMinutes: 90,
  });
  addDeal(4, {
    source: 2,
    service: 2,
    sales: HEAD,
    plan: 200000,
    created: sept10,
    path: ["В работе", "План согласован", "Лечение завершено"],
    steps: [1, 1, 1],
    paid: 200000,
  });
  addDeal(5, {
    source: 1,
    service: 1,
    sales: M1,
    plan: 400000,
    created: "2025-09-10T10:00:00+05:00",
    path: ["Записан"],
    steps: [1],
  });

  const payments: DealPayment[] = [
    [1, 100000, "2026-09-12"],
    [1, 50000, "2026-08-01"],
    [4, 200000, "2026-09-13"],
  ].map(([deal_id, amount, paid_at], index) => ({
    id: index + 1,
    deal_id: deal_id as number,
    amount: amount as number,
    paid_at: paid_at as string,
    created_at: paid_at as string,
  }));
  const tasks: Task[] = [
    [1, "2026-09-11T12:00:00+05:00", "2026-09-12T12:00:00+05:00"],
    [2, "2026-09-11T12:00:00+05:00", "2026-09-10T18:00:00+05:00"],
    [1, "2026-09-15T12:00:00+05:00", null],
  ].map(([deal_id, due_date, done_date], index) => ({
    id: index + 1,
    deal_id: deal_id as number,
    type: "call",
    text: "task",
    sales_id: M1,
    created_at: "2026-09-10T12:00:00+05:00",
    due_date: due_date as string,
    done_date: done_date as string | null,
  }));
  const messages: Message[] = [
    "2026-09-10T11:00:00+05:00",
    "2026-09-11T11:00:00+05:00",
    "2026-08-01T11:00:00+05:00",
  ].map((sent_at, index) => ({
    id: index + 1,
    patient_id: 1,
    deal_id: 1,
    transport: "whatsapp",
    chat_id: "1",
    direction: "out",
    sales_id: M1,
    text: "hi",
    content_type: "text",
    status: "sent",
    sent_at,
  }));

  const dictionary = (names: string[]) =>
    names.map((name, index) => ({
      id: index + 1,
      name,
      position: index,
      is_archived: false,
    }));
  return {
    deals,
    stages: STAGES,
    pipelines: [
      { id: 1, name: "Основная", position: 0, is_default: true },
      { id: 2, name: "Ортодонтия", position: 1, is_default: false },
    ],
    deal_events: events,
    deal_payments: payments,
    tasks,
    messages,
    sales: [sale(OWNER, "owner"), sale(HEAD, "head"), sale(M1, "m1")],
    lead_sources: dictionary(["WhatsApp", "Instagram"]).map((s) => ({
      ...s,
      is_system: true,
    })),
    services: dictionary(["Имплантация", "Ортодонтия", "Терапия", "Гигиена"]),
    lost_reasons: dictionary(["Дорого"]),
  };
};

const SEPTEMBER = {
  from: "2026-09-01T00:00:00+05:00",
  to: "2026-10-01T00:00:00+05:00",
};
const NOW = new Date("2026-09-27T12:00:00+05:00");

describe("keyStages", () => {
  it("finds the template stages by name", () => {
    expect(keyStages(STAGES, 1)).toEqual({ appointment: 2, visit: 3, plan: 4 });
  });

  it("falls back to the order of the open stages, then the won stage", () => {
    const stages: Stage[] = [
      ["Консультация", "open"],
      ["Брекеты", "open"],
      ["Готово", "won"],
      ["Отказ", "lost"],
    ].map(([name, kind], position) => ({
      id: 100 + position,
      pipeline_id: 2,
      name,
      position,
      kind: kind as Stage["kind"],
      color: "#000",
    }));
    expect(keyStages(stages, 2)).toEqual({
      appointment: null,
      visit: null,
      plan: 2,
    });
  });
});

describe("conversionReport", () => {
  it("counts the deals created in the period and how far they went", () => {
    const report = conversionReport(buildData(), SEPTEMBER);
    expect(report.totals).toEqual({
      deals: 4,
      appointment: 3,
      visit: 2,
      plan: 2,
      paid: 2,
      won: 1,
      lost: 1,
    });
    expect(report.funnel.map((s) => `${s.name}=${s.deals}`)).toEqual([
      "Новый лид=4",
      "В работе=3",
      "Записан=3",
      "Пришёл на консультацию=2",
      "План согласован=2",
      "В лечении=2",
      "Лечение завершено=1",
      "Отказ=1",
    ]);
  });

  it("breaks the conversion down by source and employee", () => {
    const report = conversionReport(buildData(), SEPTEMBER);
    expect(
      [...report.by_source].sort((a, b) =>
        String(a.name).localeCompare(String(b.name)),
      ),
    ).toEqual([
      {
        id: 2,
        name: "Instagram",
        deals: 2,
        appointment: 1,
        visit: 1,
        plan: 1,
        paid: 1,
        won: 1,
        lost: 0,
      },
      {
        id: 1,
        name: "WhatsApp",
        deals: 2,
        appointment: 2,
        visit: 1,
        plan: 1,
        paid: 1,
        won: 0,
        lost: 1,
      },
    ]);
    expect(report.by_sales.map((row) => row.id).sort()).toEqual([HEAD, M1]);
  });

  it("applies the filters", () => {
    const data = buildData();
    expect(
      conversionReport(data, { ...SEPTEMBER, source_id: 2 }).totals.deals,
    ).toBe(2);
    expect(
      conversionReport(data, { ...SEPTEMBER, sales_id: M1 }).totals,
    ).toEqual({
      deals: 2,
      appointment: 2,
      visit: 1,
      plan: 1,
      paid: 1,
      won: 0,
      lost: 1,
    });
    expect(conversionReport(data, {}).totals.deals).toBe(5);
    expect(conversionReport(data, { pipeline_id: 2 }).totals.deals).toBe(0);
  });
});

describe("speedReport", () => {
  const report = speedReport(buildData(), SEPTEMBER, NOW);

  it("averages the first response time", () => {
    expect(report.first_response).toEqual({ deals: 2, avg_seconds: 3600 });
  });

  it("averages the time in each open stage", () => {
    const stage = (name: string) => report.stages.find((s) => s.name === name);
    expect(stage("Записан")).toMatchObject({ stays: 2, avg_seconds: 10800 });
    expect(stage("План согласован")).toMatchObject({ avg_seconds: 9000 });
    expect(stage("Лечение завершено")).toBeUndefined();
  });

  it("gives the KPI of every employee", () => {
    expect(report.by_sales).toHaveLength(3);
    const {
      id: _id,
      name: _name,
      ...m1
    } = report.by_sales.find((row) => row.id === M1)!;
    expect(m1).toEqual({
      deals: 2,
      first_response_seconds: 1800,
      tasks_created: 3,
      tasks_done: 2,
      tasks_due: 3,
      tasks_overdue: 2,
      messages_sent: 2,
      open_deals: 2,
      deals_without_task: 1,
    });
    expect(
      speedReport(buildData(), { sales_id: M1 }, NOW).by_sales,
    ).toHaveLength(1);
  });
});

describe("lostReport", () => {
  it("groups the deals lost in the period by reason and stage", () => {
    expect(lostReport(buildData(), SEPTEMBER)).toEqual({
      totals: { deals: 1, plan_amount: 50000 },
      by_reason: [{ id: 1, name: "Дорого", deals: 1, plan_amount: 50000 }],
      by_stage: [
        {
          id: stageId("Записан"),
          name: "Записан",
          pipeline_name: "Основная",
          deals: 1,
          plan_amount: 50000,
        },
      ],
    });
    expect(
      lostReport(buildData(), { from: "2026-10-01T00:00:00+05:00" }).totals
        .deals,
    ).toBe(0);
  });
});

describe("moneyReport", () => {
  it("sums the agreed plans, the payments and the average check", () => {
    const report = moneyReport(buildData(), SEPTEMBER);
    expect(report.totals).toEqual({
      agreed_deals: 2,
      agreed_amount: 500000,
      paid_amount: 300000,
      paying_deals: 2,
      average_check: 150000,
    });
    expect(
      Object.fromEntries(report.by_service.map((r) => [r.name, r.paid_amount])),
    ).toEqual({ Имплантация: 100000, Ортодонтия: 200000 });
    expect(report.by_sales.find((r) => r.id === M1)?.agreed_amount).toBe(
      300000,
    );
    expect(moneyReport(buildData(), {}).totals.paid_amount).toBe(350000);
  });

  it("takes payment dates in the clinic time zone", () => {
    expect(localDate("2026-08-31T20:00:00Z", "Asia/Almaty")).toBe("2026-09-01");
  });
});
