import { describe, expect, it } from "vitest";

import { buildPatientHistory, filterHistory, groupByDay } from "./history";

describe("patient history", () => {
  const events = buildPatientHistory({
    deals: [
      {
        id: 1,
        name: "Имплантация",
        created_at: "2026-09-01T09:00:00",
        stage_id: 1,
      },
    ],
    messages: [
      {
        id: 1,
        deal_id: 1,
        direction: "in",
        transport: "whatsapp",
        sent_at: "2026-09-01T09:05:00",
      },
      {
        id: 2,
        deal_id: 1,
        direction: "out",
        transport: "whatsapp",
        sent_at: "2026-09-01T09:10:00",
      },
      {
        id: 3,
        deal_id: 1,
        direction: "in",
        transport: "whatsapp",
        sent_at: "2026-09-01T18:00:00",
      },
      {
        id: 4,
        deal_id: 1,
        direction: "in",
        transport: "telegram",
        sent_at: "2026-09-02T10:00:00",
      },
    ],
    visits: [
      {
        id: 5,
        deal_id: 1,
        starts_at: "2026-09-10T10:00:00",
        status: "completed",
        source: "crm",
      },
    ],
    records: [
      {
        id: 6,
        deal_id: 1,
        record_date: "2026-09-10",
        diagnosis_codes: ["K02.1"],
        diagnosis: "Кариес",
      },
    ],
    operations: [
      {
        id: 7,
        deal_id: 1,
        occurred_at: "2026-09-10T11:00:00",
        kind: "payment",
        amount: 25000,
        method: "cash",
      },
    ],
    plans: [
      {
        id: 8,
        deal_id: 1,
        name: "План",
        status: "agreed",
        created_at: "2026-09-03T10:00:00",
        agreed_at: "2026-09-04T10:00:00",
      },
    ],
    dealFiles: [
      {
        id: 9,
        deal_id: 1,
        name: "chat.jpg",
        created_at: "2026-09-01T09:06:00",
        message_id: 2,
      },
      {
        id: 10,
        deal_id: 1,
        name: "ОПТГ.png",
        created_at: "2026-09-03T09:00:00",
        message_id: null,
      },
    ],
    patientFiles: [
      { id: 11, name: "КТ.png", kind: "ct", created_at: "2026-09-05T09:00:00" },
    ],
    teeth: [
      {
        id: 12,
        patient_id: 1,
        tooth: 36,
        state_before: "caries",
        state: "filling",
        source: "plan",
        created_at: "2026-09-10T10:50:00",
      },
    ],
    consents: [
      {
        id: 13,
        title: "Согласие",
        created_at: "2026-09-09T09:00:00",
        signed_at: "2026-09-10",
      },
    ],
  });

  it("puts everything on one timeline, newest first", () => {
    expect(events.map((event) => event.key)).toEqual([
      "consent:13",
      "record:6",
      "payment:7",
      "tooth:12",
      "visit:5",
      "patient-file:11",
      "plan-agreed:8",
      "plan:8",
      "deal-file:10",
      "messages:1:telegram:2026-09-02",
      "messages:1:whatsapp:2026-09-01",
      "deal:1",
    ]);
  });

  it("sums the conversation per day and channel, without the chat files", () => {
    const whatsapp = events.find(
      (event) => event.key === "messages:1:whatsapp:2026-09-01",
    );
    expect(whatsapp).toMatchObject({
      at: "2026-09-01T18:00:00",
      data: { incoming: 2, outgoing: 1, count: 3 },
    });
    expect(events.some((event) => event.key === "deal-file:9")).toBe(false);
  });

  it("filters by kind and groups by day", () => {
    expect(filterHistory(events, ["plan"]).map((e) => e.key)).toEqual([
      "plan-agreed:8",
      "plan:8",
    ]);
    expect(filterHistory(events, null)).toHaveLength(events.length);
    const days = groupByDay(events);
    expect(days[0][0]).toBe("2026-09-10");
    expect(days[0][1]).toHaveLength(5);
  });
});
