import { describe, expect, it } from "vitest";

import { normalizeReply, parseVisitReply } from "./visitReply";

const CONFIRM = ["1", "да", "подтверждаю"];
const RESCHEDULE = ["2", "перенести", "перенос"];
const parse = (text: string) => parseVisitReply(text, CONFIRM, RESCHEDULE);

describe("parseVisitReply", () => {
  it("confirms with the number or the words", () => {
    expect(parse("1")).toBe("confirm");
    expect(parse(" 1. ")).toBe("confirm");
    expect(parse("Да")).toBe("confirm");
    expect(parse("ДА, ПОДТВЕРЖДАЮ!")).toBe("confirm");
    expect(parse("да спасибо")).toBe("confirm");
  });

  it("asks to reschedule with the number or the words", () => {
    expect(parse("2")).toBe("reschedule");
    expect(parse("Нужно перенести")).toBe("reschedule");
    expect(parse("перенос, пожалуйста")).toBe("reschedule");
  });

  it("a reschedule word wins over a confirmation", () => {
    expect(parse("Да, но нужно перенести")).toBe("reschedule");
  });

  it("never confirms a negation", () => {
    expect(parse("не подтверждаю")).toBeNull();
    expect(parse("Нет, не да")).toBeNull();
  });

  it("numbers only count as the first word", () => {
    expect(parse("приду в 12")).toBeNull();
    expect(parse("буду к 1 часу")).toBeNull();
    expect(parse("12")).toBeNull();
  });

  it("whole words only, short messages only", () => {
    expect(parse("дайте адрес")).toBeNull();
    expect(parse("Подскажите, пожалуйста, да или нет, можно ли будет прийти с ребёнком")).toBeNull();
    expect(parse("")).toBeNull();
    expect(parse("👍")).toBeNull();
  });

  it("uses the clinic's keywords", () => {
    expect(parseVisitReply("ок", ["ок"], [])).toBe("confirm");
    expect(parseVisitReply("иә", ["иә"], [])).toBe("confirm");
    expect(parseVisitReply("1", [], ["2"])).toBeNull();
  });
});

describe("normalizeReply", () => {
  it("lowercases, folds ё and drops punctuation", () => {
    expect(normalizeReply("  Всё ОК!!  ")).toBe("все ок");
    expect(normalizeReply("Қазақша, ИӘ")).toBe("қазақша иә");
  });
});
