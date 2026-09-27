import { describe, expect, it } from "vitest";

import type { Patient } from "../types";
import {
  defaultMergeChoices,
  duplicateGroupRows,
  groupDuplicates,
  matchKeys,
  mergePatientRecords,
  normalizePersonName,
  patientDuplicates,
  patientLabel,
  suggestKeep,
} from "./duplicates";

const patient = (id: number, fields: Partial<Patient> = {}): Patient =>
  ({
    id,
    first_name: "",
    last_name: "",
    middle_name: null,
    phone_jsonb: [],
    phones: [],
    birth_date: null,
    telegram: null,
    instagram: null,
    whatsapp: null,
    tags: [],
    first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-01-01T00:00:00Z",
    ...fields,
  }) as Patient;

describe("normalizePersonName", () => {
  it("ignores case, spaces and ё", () => {
    expect(normalizePersonName(" Сейтжанова ", "Алия  ", "Ерлановна")).toBe(
      "сейтжанова алия ерлановна",
    );
    expect(normalizePersonName("Ёлкин", "Пётр", null)).toBe("елкин петр");
    expect(normalizePersonName("", " ", null)).toBeNull();
  });
});

describe("matchKeys", () => {
  it("lists phones, handles, chats and name with birth date", () => {
    const keys = matchKeys(
      patient(1, {
        first_name: "Мария",
        last_name: "Ким",
        birth_date: "1990-05-12",
        phones: ["+77010000001"],
        telegram: "Maria_Kim",
        instagram: "maria.k",
      }),
      [
        {
          patient_id: 1,
          transport: "telegram_bot",
          chat_id: "555",
          username: "@Maria_Kim",
        },
        { patient_id: 1, transport: "whatsapp", chat_id: "77010000001" },
        { patient_id: 2, transport: "instagram", chat_id: "ig-9" },
      ],
    );
    expect(keys).toEqual([
      { kind: "phone", key: "+77010000001" },
      { kind: "chat", key: "tg:maria_kim" },
      { kind: "chat", key: "ig:maria.k" },
      { kind: "chat", key: "tgid:555" },
      { kind: "name_birth", key: "ким мария|1990-05-12" },
    ]);
  });
  it("needs a last and a first name for the name criterion", () => {
    expect(
      matchKeys(patient(1, { first_name: "Мария", birth_date: "1990-05-12" })),
    ).toEqual([]);
  });
});

describe("patientDuplicates", () => {
  const patients = [
    patient(1, {
      phones: ["+77017771122"],
      last_name: "Ахметов",
      first_name: "Даулет",
    }),
    patient(2, { phones: ["+77017771122", "+77050000000"] }),
    patient(3, { telegram: "Maria_Kim" }),
    patient(4, { first_name: "maria_kim" }),
    patient(5, {
      last_name: "Сейтжанова",
      first_name: "Алия",
      birth_date: "1990-05-12",
    }),
    patient(6, {
      last_name: "СЕЙТЖАНОВА",
      first_name: " алия ",
      birth_date: "1990-05-12",
      phones: ["+77012223344"],
    }),
    patient(7, {
      last_name: "Сейтжанова",
      first_name: "Алия",
      birth_date: "1991-05-12",
    }),
    patient(8, { phones: ["+77012223344"] }),
  ];
  const chats = [
    {
      patient_id: 4,
      transport: "telegram_bot" as const,
      chat_id: "1",
      username: "maria_kim",
    },
  ];
  it("finds a duplicate by each criterion", () => {
    expect(patientDuplicates(1, patients, chats)).toMatchObject([
      { patient_id: 2, reasons: ["phone"] },
    ]);
    expect(patientDuplicates(3, patients, chats)).toMatchObject([
      { patient_id: 4, reasons: ["chat"] },
    ]);
    expect(patientDuplicates(5, patients, chats)).toMatchObject([
      { patient_id: 6, reasons: ["name_birth"] },
    ]);
    expect(patientDuplicates(7, patients, chats)).toEqual([]);
  });
  it("groups patients linked through another one", () => {
    const rows = duplicateGroupRows(patients, chats, new Map([["1", 2]]));
    const groups = groupDuplicates(rows);
    expect(
      groups.map((g) => [g.id, g.patients.map((p) => p.patient_id)]),
    ).toEqual([
      [1, [1, 2]],
      [3, [3, 4]],
      [5, [5, 6, 8]],
    ]);
    expect(groups[2].reasons).toEqual(["name_birth", "phone"]);
    expect(rows.find((r) => r.patient_id === 6)?.reasons).toEqual([
      "name_birth",
      "phone",
    ]);
    expect(rows.find((r) => r.patient_id === 1)?.nb_deals).toBe(2);
  });
});

describe("merge", () => {
  const keep = patient(1, {
    first_name: "Даулет",
    last_name: "Ахметов",
    phone_jsonb: [{ number: "+77017771122", type: "mobile" }],
    phones: ["+77017771122"],
    tags: [1],
    sales_id: 5,
    first_seen: "2026-03-01T00:00:00Z",
    last_seen: "2026-03-02T00:00:00Z",
  });
  const merge = patient(2, {
    first_name: "Даулет",
    birth_date: "1985-01-02",
    background: "По рекомендации",
    phone_jsonb: [
      { number: "+77017771122", type: "mobile" },
      { number: "+77051234567", type: "mobile" },
    ],
    phones: ["+77017771122", "+77051234567"],
    tags: [2, 1],
    sales_id: 6,
    city: "Алматы",
    messaging_opt_out: true,
    first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-02-01T00:00:00Z",
  });
  it("keeps the kept values unless they are empty", () => {
    expect(defaultMergeChoices(keep, merge)).toEqual({
      name: "keep",
      birth_date: "merge",
      source: "keep",
      responsible: "keep",
      comment: "merge",
    });
  });
  it("applies the choices and unions phones and tags", () => {
    const merged = mergePatientRecords(keep, merge, {
      name: "keep",
      responsible: "merge",
    });
    expect(merged).toMatchObject({
      id: 1,
      last_name: "Ахметов",
      birth_date: "1985-01-02",
      background: "По рекомендации",
      sales_id: 6,
      city: "Алматы",
      tags: [1, 2],
      messaging_opt_out: true,
      first_seen: "2026-01-01T00:00:00Z",
      last_seen: "2026-03-02T00:00:00Z",
    });
    expect(merged.phone_jsonb.map((p) => p.number)).toEqual([
      "+77017771122",
      "+77051234567",
    ]);
    expect(
      mergePatientRecords(keep, merge, { birth_date: "keep" }).birth_date,
    ).toBeNull();
  });
  it("suggests keeping the patient with more requests, else the older one", () => {
    expect(
      suggestKeep({ id: 1, nb_deals: 1 }, { id: 2, nb_deals: 3 })[0].id,
    ).toBe(2);
    expect(
      suggestKeep(
        { id: 1, nb_deals: 1, first_seen: "2026-05-01" },
        { id: 2, nb_deals: 1, first_seen: "2026-01-01" },
      )[0].id,
    ).toBe(2);
    expect(suggestKeep({ id: 4 }, { id: 3 })[0].id).toBe(3);
  });
  it("labels a patient like the audit row", () => {
    expect(patientLabel(keep)).toBe("Ахметов Даулет (#1)");
    expect(patientLabel(patient(9, { phones: ["+77010000000"] }))).toBe(
      "+77010000000 (#9)",
    );
  });
});
