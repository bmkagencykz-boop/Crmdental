import { describe, expect, it } from "vitest";
import { accent, onAccent } from "./accent";

describe("accent", () => {
  it("maps the previous pastel stage colors to the new accents", () => {
    expect(accent("#83a2db")).toBe("#2F6BFF");
    expect(accent("#FFCE87")).toBe("#FFE500");
    expect(accent("#123456")).toBe("#123456");
  });

  it("picks a readable text color", () => {
    expect(onAccent("#FFE500")).toBe("#000000");
    expect(onAccent("#C6F432")).toBe("#000000");
    expect(onAccent("#2F6BFF")).toBe("#FFFFFF");
  });
});
