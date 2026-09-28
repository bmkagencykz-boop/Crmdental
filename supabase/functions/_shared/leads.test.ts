// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isTestPing, parseFields, toLead } from "./leads";

describe("toLead", () => {
  it("maps our own field names", () => {
    expect(
      toLead({
        name: "Даулет",
        phone: "+7 701 555 12 34",
        source: "2gis",
        service: "Имплантация",
        comment: "Перезвоните вечером",
        utm_source: "google",
      }),
    ).toEqual({
      name: "Даулет",
      phone: "+7 701 555 12 34",
      source: "2gis",
      service: "Имплантация",
      comment: "Перезвоните вечером",
      referrer: null,
      landing_page: null,
      utm: { utm_source: "google" },
    });
  });

  it("understands Tilda forms and keeps their extra questions", () => {
    expect(
      toLead({
        Name: "Асель",
        Phone: "+7 (747) 111-22-33",
        Textarea: "Болит зуб",
        "Удобное время": "после 18:00",
        tranid: "123:456",
        formid: "form1",
        COOKIES: "_ga=1",
        UTM_CAMPAIGN: "implants",
      }),
    ).toEqual({
      name: "Асель",
      phone: "+7 (747) 111-22-33",
      source: null,
      service: null,
      comment: "Болит зуб\nУдобное время: после 18:00",
      referrer: null,
      landing_page: null,
      utm: { utm_campaign: "implants" },
    });
  });

  it("reads a nested utm object and joins multiple values", () => {
    expect(
      toLead({
        phone: "87015551234",
        услуга: ["Имплантация", "Гигиена"],
        utm: { utm_medium: "cpc", other: "x" },
      }),
    ).toMatchObject({
      phone: "87015551234",
      service: "Имплантация, Гигиена",
      utm: { utm_medium: "cpc" },
    });
  });

  it("ignores empty values", () => {
    expect(toLead({ name: "  ", phone: "", comment: null })).toEqual({
      name: null,
      phone: null,
      source: null,
      service: null,
      comment: null,
      referrer: null,
      landing_page: null,
      utm: {},
    });
  });

  it("keeps the referrer and the landing page of the form", () => {
    expect(
      toLead({
        phone: "87015551234",
        Referer: "https://www.google.com/",
        landing_page: "https://clinic.kz/implant",
        utm_source: "google",
      }),
    ).toMatchObject({
      referrer: "https://www.google.com/",
      landing_page: "https://clinic.kz/implant",
      comment: null,
      utm: { utm_source: "google" },
    });
  });
});

describe("isTestPing", () => {
  it("recognises the Tilda test request", () => {
    expect(isTestPing({ test: "test" })).toBe(true);
    expect(isTestPing({ test: "test", Phone: "87015551234" })).toBe(false);
    expect(isTestPing({ name: "x" })).toBe(false);
  });
});

describe("parseFields", () => {
  it("parses JSON and forms", () => {
    expect(parseFields("application/json", '{"name":"A"}')).toEqual({
      name: "A",
    });
    expect(
      parseFields(
        "application/x-www-form-urlencoded",
        "Name=%D0%90&Phone=%2B77015551234&a=1&a=2",
      ),
    ).toEqual({ Name: "А", Phone: "+77015551234", a: ["1", "2"] });
    expect(parseFields(null, "test=test")).toEqual({ test: "test" });
    expect(parseFields("application/json", "[1]")).toBe(null);
    expect(parseFields("application/json", "{oops")).toBe(null);
    expect(parseFields(null, "")).toEqual({});
  });
});
