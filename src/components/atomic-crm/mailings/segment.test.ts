import { describe, expect, it } from "vitest";

import {
  addMonths,
  classifySegment,
  isEmptySegment,
  segmentPreview,
  type SegmentData,
} from "./segment";

// The clinic of supabase/tests/017_repeat_mailings.test.sql: same patients,
// same expected numbers
const now = new Date("2026-09-27T12:00:00Z");
const VIP = 1;
const KIDS = 2;
const INSTAGRAM = 10;
const WHATSAPP = 11;
const MANAGER = 100;
const IMPLANTS = 20;
const THERAPY = 21;

const data: SegmentData = {
  patients: [
    {
      id: 1,
      first_name: "P1",
      last_name: "A",
      phones: ["+77020000001"],
      tags: [VIP, KIDS],
      source_id: INSTAGRAM,
      sales_id: 99,
      last_seen: "2026-09-27T00:00:00Z",
    },
    {
      id: 2,
      first_name: "P2",
      last_name: "B",
      phones: ["+77020000002"],
      tags: [VIP],
      source_id: WHATSAPP,
      sales_id: MANAGER,
      last_seen: "2026-09-27T00:00:00Z",
    },
    {
      id: 3,
      first_name: "P3",
      last_name: "C",
      phones: [],
      tags: [KIDS],
      source_id: null,
      sales_id: 99,
      last_seen: "2026-09-27T00:00:00Z",
    },
    {
      id: 4,
      first_name: "P4",
      last_name: "D",
      phones: ["+77020000004"],
      tags: [VIP],
      source_id: null,
      sales_id: 99,
      last_seen: "2026-09-27T00:00:00Z",
      messaging_opt_out: true,
    },
    {
      id: 5,
      first_name: "P5",
      last_name: "E",
      phones: ["+77020000002"],
      tags: [VIP],
      source_id: null,
      sales_id: 99,
      last_seen: "2026-09-26T00:00:00Z",
    },
  ],
  deals: [
    {
      id: 1,
      patient_id: 1,
      stage_id: 7,
      service_id: IMPLANTS,
      closed_at: addMonths(now, -8).toISOString(),
    },
    { id: 2, patient_id: 2, stage_id: 1, service_id: THERAPY },
  ],
  stages: [
    { id: 1, kind: "open" },
    { id: 7, kind: "won" },
    { id: 8, kind: "lost" },
  ],
  chatPatientIds: [],
};

const count = (segment: Parameters<typeof segmentPreview>[1]) =>
  segmentPreview(data, segment, { now }).count;

describe("segmentPreview", () => {
  it("leaves out opted-out patients, patients without contact and duplicates", () => {
    const { patients, ...numbers } = segmentPreview(data, {}, { now });
    expect(numbers).toEqual({
      count: 2,
      matched: 5,
      opted_out: 1,
      no_contact: 1,
      duplicates: 1,
    });
    expect(patients.map((p) => p.first_name)).toEqual(["P1", "P2"]);
  });

  it("filters by tags, any or all", () => {
    expect(segmentPreview(data, { tag_ids: [VIP] }, { now })).toMatchObject({
      count: 2,
      matched: 4,
    });
    expect(
      segmentPreview(data, { tag_ids: [VIP, KIDS], tag_mode: "all" }, { now })
        .matched,
    ).toBe(1);
    expect(
      segmentPreview(data, { tag_ids: [VIP, KIDS], tag_mode: "any" }, { now })
        .matched,
    ).toBe(5);
  });

  it("filters by the service of past deals", () => {
    expect(count({ service_ids: [IMPLANTS] })).toBe(1);
  });

  it("«давно не был»: last visit or won deal older than N months", () => {
    expect(count({ inactive_months: 6 })).toBe(1);
    expect(count({ inactive_months: 12 })).toBe(0);
  });

  it("filters by source, open deal and responsible", () => {
    expect(count({ source_ids: [INSTAGRAM] })).toBe(1);
    expect(count({ has_open_deal: true })).toBe(1);
    // P5 is not a duplicate any more once P2 is out of the segment
    expect(count({ has_open_deal: false })).toBe(2);
    expect(count({ sales_ids: [MANAGER] })).toBe(1);
  });

  it("a patient with a messenger chat but no phone is reachable", () => {
    const rows = classifySegment({ ...data, chatPatientIds: [3] }, {}, now);
    expect(rows.find((row) => row.patient_id === 3)?.status).toBe("ok");
  });
});

describe("isEmptySegment", () => {
  it("is empty without filters", () => {
    expect(isEmptySegment({})).toBe(true);
    expect(isEmptySegment({ tag_ids: [], tag_mode: "all" })).toBe(true);
    expect(isEmptySegment({ has_open_deal: false })).toBe(false);
  });
});

describe("addMonths", () => {
  it("keeps the end of the month like Postgres", () => {
    expect(addMonths("2026-01-31T10:00:00Z", 1).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addMonths("2026-03-15T10:00:00Z", -6).toISOString()).toBe(
      "2025-09-15T10:00:00.000Z",
    );
  });
});
