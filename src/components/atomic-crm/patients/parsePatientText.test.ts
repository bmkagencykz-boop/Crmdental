import { describe, expect, it } from "vitest";
import { parsePatientText, patientDisplayName } from "./parsePatientText";

describe("parsePatientText", () => {
  it("reads a full name in Russian order", () => {
    expect(parsePatientText("Нурланова Асель Ерлановна")).toEqual({
      last_name: "Нурланова",
      first_name: "Асель",
      middle_name: "Ерлановна",
    });
  });

  it("reads a phone number alone", () => {
    expect(parsePatientText("8 701 123 45 67")).toEqual({
      phone: "8 701 123 45 67",
    });
  });

  it("reads a name followed by a phone", () => {
    expect(parsePatientText("Ахметов Марат +7 (702) 765-43-21")).toEqual({
      last_name: "Ахметов",
      first_name: "Марат",
      phone: "+7 (702) 765-43-21",
    });
  });

  it("ignores empty input", () => {
    expect(parsePatientText("   ")).toEqual({});
  });
});

describe("patientDisplayName", () => {
  it("shows the full name, else the phone", () => {
    expect(patientDisplayName({ last_name: "Ким", first_name: "Анна" })).toBe(
      "Ким Анна",
    );
    expect(patientDisplayName({ phones: ["+77011234567"] })).toBe(
      "+77011234567",
    );
  });
});
