import { describe, expect, it } from "vitest";

import { applyTemplate, neverCame, questionnaireAlerts } from "./cardLogic";

describe("patient card rules", () => {
  it("marks «1В» until a visit is arrived or completed", () => {
    expect(neverCame([])).toBe(true);
    expect(neverCame([{ status: "scheduled" }, { status: "no_show" }])).toBe(
      true,
    );
    expect(neverCame([{ status: "completed" }])).toBe(false);
    expect(neverCame([{ status: "arrived" }])).toBe(false);
  });

  it("lists the «yes» answers in the order of the questionnaire", () => {
    expect(
      questionnaireAlerts({
        smoking: { answer: "yes" },
        diabetes: { answer: "yes", comment: "2 тип" },
        pregnancy: { answer: "no" },
      }),
    ).toEqual(["diabetes", "smoking"]);
    expect(questionnaireAlerts(undefined)).toEqual([]);
  });

  it("applies a template without losing what is typed", () => {
    const draft = {
      doctor_id: null,
      record_date: "2026-09-28",
      diagnosis_codes: ["K04.0"],
      complaints: "Боль ночью",
      treatment: "",
    };
    const next = applyTemplate(draft, {
      content: {
        complaints: "Боль от холодного",
        treatment: "Пломба",
        diagnosis: "Кариес дентина",
      },
      diagnosis_codes: ["K02.1", "K04.0"],
    });
    expect(next.complaints).toBe("Боль ночью\nБоль от холодного");
    expect(next.treatment).toBe("Пломба");
    expect(next.diagnosis).toBe("Кариес дентина");
    expect(next.diagnosis_codes).toEqual(["K04.0", "K02.1"]);
    // Applied twice: nothing doubles
    expect(
      applyTemplate(next, {
        content: { treatment: "Пломба" },
        diagnosis_codes: [],
      }).treatment,
    ).toBe("Пломба");
  });
});
