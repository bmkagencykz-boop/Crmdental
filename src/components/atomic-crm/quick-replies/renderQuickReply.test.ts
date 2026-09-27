import { describe, expect, it } from "vitest";

import type { QuickReply } from "../types";
import {
  filterQuickReplies,
  findSlashQuery,
  formatVisitDate,
  insertQuickReply,
  normalizeShortcut,
  quickReplyContext,
  renderQuickReply,
} from "./renderQuickReply";

describe("renderQuickReply", () => {
  it("fills every variable", () => {
    expect(
      renderQuickReply(
        "Здравствуйте, {имя}! {сотрудник} из {клиника}: {услуга}, {дата_визита}.",
        {
          имя: "Асель",
          сотрудник: "Айгерим",
          клиника: "Жемчуг",
          услуга: "Имплантация",
          дата_визита: "5 октября в 14:30",
        },
      ),
    ).toBe(
      "Здравствуйте, Асель! Айгерим из Жемчуг: Имплантация, 5 октября в 14:30.",
    );
  });

  it("gives an empty string for a missing value and collapses the spaces", () => {
    expect(
      renderQuickReply("{имя} записали вас {дата_визита} на приём", {
        имя: null,
      }),
    ).toBe("Записали вас на приём");
    expect(renderQuickReply("Ждём  вас  {дата_визита}  в  клинике", {})).toBe(
      "Ждём вас в клинике",
    );
  });

  it("tidies the punctuation around a missing value", () => {
    expect(renderQuickReply("Спасибо,  {имя}  !", { имя: "  " })).toBe(
      "Спасибо!",
    );
    expect(
      renderQuickReply(
        "{имя}, записали вас на консультацию {дата_визита}. Ждём!",
        {},
      ),
    ).toBe("Записали вас на консультацию. Ждём!");
    expect(renderQuickReply("Цена: 5 000 ₸ , скидка", {})).toBe(
      "Цена: 5 000 ₸ , скидка",
    );
  });

  it("keeps line breaks and trims the spaces around them", () => {
    expect(
      renderQuickReply("Здравствуйте, {имя}!  \n  Адрес: {клиника}", {
        имя: "Асель",
      }),
    ).toBe("Здравствуйте, Асель!\nАдрес:");
  });

  it("leaves unknown variables and placeholders alone", () => {
    expect(
      renderQuickReply("Адрес: [укажите адрес] {этаж}", { имя: "Асель" }),
    ).toBe("Адрес: [укажите адрес] {этаж}");
  });

  it("replaces a variable used twice", () => {
    expect(renderQuickReply("{имя}, {имя}", { имя: "Асель" })).toBe(
      "Асель, Асель",
    );
  });
});

describe("formatVisitDate", () => {
  it("formats in the clinic's time zone", () => {
    expect(formatVisitDate("2026-10-05T09:30:00Z", "Asia/Almaty")).toBe(
      "5 октября в 14:30",
    );
    expect(formatVisitDate("2026-01-01T00:05:00Z", "UTC")).toBe(
      "1 января в 00:05",
    );
  });

  it("is empty without a date", () => {
    expect(formatVisitDate(null)).toBe("");
    expect(formatVisitDate("not a date")).toBe("");
  });
});

describe("quickReplyContext", () => {
  it("takes the patient, the appointment then the visit", () => {
    expect(
      quickReplyContext({
        deal: {
          patient_first_name: "Асель",
          appointment_at: null,
          visit_at: "2026-10-05T09:30:00Z",
        },
        serviceName: "Гигиена",
        clinicName: "Жемчуг",
        salesFirstName: "Айгерим",
      }),
    ).toEqual({
      имя: "Асель",
      услуга: "Гигиена",
      дата_визита: "5 октября в 14:30",
      клиника: "Жемчуг",
      сотрудник: "Айгерим",
    });
  });
});

const reply = (
  id: number,
  title: string,
  shortcut: string | null,
  position: number,
  sales_id: number | null = null,
): QuickReply => ({ id, title, text: title, shortcut, position, sales_id });

describe("filterQuickReplies", () => {
  const replies = [
    reply(1, "Приветствие", "привет", 0),
    reply(2, "Мой адрес", "мой", 0, 7),
    reply(3, "Адрес и парковка", "адрес", 1),
    reply(4, "Спасибо", null, 2),
  ];

  it("lists clinic replies first, then personal ones, by position", () => {
    expect(filterQuickReplies(replies, "").map((r) => r.id)).toEqual([
      1, 3, 4, 2,
    ]);
  });

  it("matches the title and the shortcut, shortcut prefix first", () => {
    expect(filterQuickReplies(replies, "адр").map((r) => r.id)).toEqual([3, 2]);
    expect(filterQuickReplies(replies, "МОЙ").map((r) => r.id)).toEqual([2]);
    expect(filterQuickReplies(replies, "спас").map((r) => r.id)).toEqual([4]);
    expect(filterQuickReplies(replies, "xyz")).toEqual([]);
  });
});

describe("findSlashQuery", () => {
  it("finds a slash at the start or after a space", () => {
    expect(findSlashQuery("/адр", 4)).toEqual({ start: 0, query: "адр" });
    expect(findSlashQuery("Добрый день /", 13)).toEqual({
      start: 12,
      query: "",
    });
    expect(findSlashQuery("строка\n/цена", 12)).toEqual({
      start: 7,
      query: "цена",
    });
  });

  it("ignores a slash inside a word or a finished query", () => {
    expect(findSlashQuery("1/2", 3)).toBeNull();
    expect(findSlashQuery("http://site", 11)).toBeNull();
    expect(findSlashQuery("/адрес ", 7)).toBeNull();
    expect(findSlashQuery("текст", 5)).toBeNull();
  });

  it("looks at the text before the caret only", () => {
    expect(findSlashQuery("/ад и дальше", 3)).toEqual({
      start: 0,
      query: "ад",
    });
  });
});

describe("insertQuickReply", () => {
  it("replaces the /query with the reply", () => {
    expect(insertQuickReply("Добрый день /адр", 12, 16, "Наш адрес")).toEqual({
      text: "Добрый день Наш адрес",
      caret: 21,
    });
  });

  it("keeps the text after the caret, a word separated by a space", () => {
    expect(insertQuickReply("/ад!", 0, 3, "Адрес")).toEqual({
      text: "Адрес!",
      caret: 5,
    });
    expect(insertQuickReply("/адвот", 0, 3, "Адрес")).toEqual({
      text: "Адрес вот",
      caret: 6,
    });
    expect(insertQuickReply("/ад хвост", 0, 3, "Адрес")).toEqual({
      text: "Адрес хвост",
      caret: 5,
    });
  });
});

describe("normalizeShortcut", () => {
  it("keeps one lowercase word without slashes", () => {
    expect(normalizeShortcut(" /Адрес ")).toBe("адрес");
    expect(normalizeShortcut("два слова")).toBe("два_слова");
    expect(normalizeShortcut("  ")).toBeNull();
  });
});
