import { describe, expect, it } from "vitest";

import type { Deal, Message, Patient, Sale, Stage, Task } from "../types";
import {
  formatPhone,
  globalSearchInMemory,
  highlightParts,
  matchMessage,
  matchPatient,
  parseSearchQuery,
  quickCreatePhone,
  searchNorm,
  type SearchData,
} from "./globalSearch";

const patient = (
  id: number,
  last_name: string,
  first_name: string,
  phones: string[],
  extra: Partial<Patient> = {},
) =>
  ({
    id,
    last_name,
    first_name,
    middle_name: null,
    phones,
    phone_jsonb: phones.map((number) => ({ number, type: "Mobile" })),
    tags: [],
    first_seen: "2026-09-01T00:00:00Z",
    last_seen: "2026-09-01T00:00:00Z",
    ...extra,
  }) as Patient & { id: number };

const ivanova = patient(1, "Иванова", "Анна", ["+77015551234"], {
  middle_name: "Сергеевна",
});
const semenov = patient(2, "Семёнов", "Пётр", ["+77077770011"]);
const latin = patient(3, "Nurlanova", "Aigerim", ["+77021112233"]);
const kimova = patient(4, "Кимова", "Дана", ["+77055512340"]);

const find = (q: string) => {
  const query = parseSearchQuery(q);
  if (!query) return [];
  return [ivanova, semenov, latin, kimova]
    .map((p) => ({ id: p.id, rank: matchPatient(p, query) }))
    .filter((row) => row.rank != null)
    .sort((a, b) => a.rank! - b.rank! || a.id - b.id)
    .map((row) => row.id);
};

describe("searchNorm", () => {
  it("lowers Cyrillic, Kazakh and Latin letters, ё = е", () => {
    expect(searchNorm("СЕМЁНОВ Ёлка")).toBe("семенов елка");
    expect(searchNorm("ӘСЕЛЬ Aigerim")).toBe("әсель aigerim");
  });
});

describe("parseSearchQuery", () => {
  it("reads phone queries", () => {
    expect(parseSearchQuery("+7 701 555 12 34")).toMatchObject({
      isPhone: true,
      phoneDigits: "7015551234",
      exactPhone: "+77015551234",
    });
    expect(parseSearchQuery("87015551234")?.phoneDigits).toBe("7015551234");
    expect(parseSearchQuery("555 12")).toMatchObject({
      phoneDigits: "55512",
      exactPhone: null,
    });
  });

  it("reads card and deal numbers", () => {
    expect(parseSearchQuery("#42")?.idNumber).toBe(42);
    expect(parseSearchQuery("№ 42")?.idNumber).toBe(42);
    expect(parseSearchQuery("42")?.idNumber).toBe(42);
    expect(parseSearchQuery("5551234")?.idNumber).toBeNull();
  });

  it("splits names and digits, drops LIKE wildcards", () => {
    expect(parseSearchQuery("Иванова 701 а%")).toMatchObject({
      isPhone: false,
      nameWords: ["иванова", "а"],
      digitWords: ["701"],
    });
  });

  it("ignores too short queries", () => {
    expect(parseSearchQuery(" и ")).toBeNull();
  });
});

describe("matchPatient (same cases as 031_search.test.sql)", () => {
  it("finds phones in any format", () => {
    expect(find("+7 701 555 12 34")).toEqual([1]);
    expect(find("87015551234")).toEqual([1]);
    expect(find("7015551234")).toEqual([1]);
    expect(find("15 55")).toEqual([1]);
    expect(find("(701) 555-1")).toEqual([1]);
    expect(find("87077770011")).toEqual([2]);
    expect(find("5551234").sort()).toEqual([1, 4]);
  });

  it("ranks the exact number first", () => {
    const query = parseSearchQuery("+77015551234")!;
    expect(matchPatient(ivanova, query)).toBe(0);
    expect(matchPatient(kimova, query)).toBeNull();
  });

  it("finds names by word beginnings, ё = е, Latin", () => {
    expect(find("ИВАНОВА")).toEqual([1]);
    expect(find("ан ив")).toEqual([1]);
    expect(find("ванова")).toEqual([]);
    expect(find("семенов")).toEqual([2]);
    expect(find("СЕМЁН ПЕТР")).toEqual([2]);
    expect(find("aigerim")).toEqual([3]);
    expect(find("NURL")).toEqual([3]);
    expect(find("иванова 701")).toEqual([1]);
    expect(find("иванова 709")).toEqual([]);
  });

  it("ranks the exact name above a beginning", () => {
    const exact = parseSearchQuery("Иванова Анна Сергеевна")!;
    expect(matchPatient(ivanova, exact)).toBe(2);
    expect(matchPatient(ivanova, parseSearchQuery("ива")!)).toBe(3);
    expect(matchPatient(ivanova, parseSearchQuery("анна")!)).toBe(4);
  });

  it("finds card numbers", () => {
    expect(find("#2")).toEqual([2]);
    expect(
      matchPatient(ivanova, parseSearchQuery("MIS-7788")!, "MIS-7788"),
    ).toBe(1);
  });
});

describe("matchMessage", () => {
  it("returns a snippet around the phrase", () => {
    const text = `${"а".repeat(100)} Сколько стоят брекеты с установкой?`;
    const snippet = matchMessage({ text }, parseSearchQuery("СТОЯТ БРЕКЕТЫ")!);
    expect(snippet?.startsWith("…")).toBe(true);
    expect(snippet).toContain("брекеты с установкой");
    expect(matchMessage({ text }, parseSearchQuery("87077770011")!)).toBeNull();
  });
});

describe("globalSearchInMemory", () => {
  const stage = { id: 1, name: "В работе", kind: "open" } as Stage & {
    id: number;
  };
  const deal = (
    id: number,
    patient_id: number,
    name: string,
    sales_id: number,
  ) =>
    ({
      id,
      patient_id,
      pipeline_id: 1,
      stage_id: 1,
      name,
      sales_id,
      plan_amount: 1000 * id,
      paid_amount: 0,
      tags: [],
      index: 0,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: `2026-09-0${id}T00:00:00Z`,
    }) as Deal;
  const data: SearchData = {
    patients: [ivanova, semenov, latin, kimova],
    deals: [deal(1, 1, "Имплантация", 10), deal(2, 2, "Брекеты", 11)],
    tasks: [
      {
        id: 1,
        deal_id: 2,
        type: "call",
        text: "Перезвонить по брекетам",
        due_date: "2026-09-10T00:00:00Z",
      } as Task,
    ],
    messages: [
      {
        id: 1,
        deal_id: 2,
        patient_id: 2,
        transport: "whatsapp",
        chat_id: "1",
        direction: "in",
        text: "Сколько стоят брекеты с установкой?",
        content_type: "text",
        status: "inbound",
        sent_at: "2026-09-10T00:00:00Z",
      } as Message,
    ],
    stages: [stage],
    sales: [
      { id: 10, first_name: "Жанна", last_name: "К" },
      { id: 11, first_name: "Олег", last_name: "М" },
    ] as Sale[],
    external_refs: [
      {
        entity: "patient",
        entity_id: 1,
        system: "dentistplus",
        external_id: "MIS-7788",
      },
    ],
  };

  it("finds every kind with its details", () => {
    const result = globalSearchInMemory(data, "брек");
    expect(result.deals.map((d) => d.id)).toEqual([2]);
    expect(result.deals[0]).toMatchObject({
      stage_name: "В работе",
      sales_name: "Олег М",
      plan_amount: 2000,
    });
    expect(result.tasks.map((t) => t.id)).toEqual([1]);
    expect(globalSearchInMemory(data, "стоят брекеты").messages).toHaveLength(
      1,
    );
    expect(globalSearchInMemory(data, "иванова").patients[0].card).toBe(
      "MIS-7788",
    );
    expect(globalSearchInMemory(data, "MIS-7788").patients[0].id).toBe(1);
    expect(globalSearchInMemory(data, "иванова имплант").deals[0].id).toBe(1);
  });

  it("follows the deal visibility", () => {
    const own = { ...data, canSeeDeal: (d: Deal) => d.sales_id === 10 };
    expect(globalSearchInMemory(own, "брек").deals).toEqual([]);
    expect(globalSearchInMemory(own, "перезвон").tasks).toEqual([]);
    expect(globalSearchInMemory(own, "стоят брекеты").messages).toEqual([]);
    expect(globalSearchInMemory(own, "семенов").patients).toHaveLength(1);
  });

  it("limits every kind", () => {
    expect(globalSearchInMemory(data, "5551234", 1).patients).toHaveLength(1);
  });
});

describe("display helpers", () => {
  it("formats Kazakh numbers", () => {
    expect(formatPhone("+77015551234")).toBe("+7 701 555 12 34");
    expect(formatPhone("+4912345")).toBe("+4912345");
  });

  it("marks the query words", () => {
    expect(highlightParts("Семёнов Пётр", "семен")).toEqual([
      { text: "Семён", hit: true },
      { text: "ов Пётр", hit: false },
    ]);
  });

  it("offers a new patient only for a whole number", () => {
    expect(quickCreatePhone("8 701 555 12 34")).toBe("+77015551234");
    expect(quickCreatePhone("555 12")).toBeNull();
    expect(quickCreatePhone("Иванова")).toBeNull();
  });
});
