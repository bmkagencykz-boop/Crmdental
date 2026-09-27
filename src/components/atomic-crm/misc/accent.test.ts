import { describe, expect, it } from "vitest";
import { accent, onAccent } from "./accent";

describe("accent", () => {
  it("maps the previous palettes to the brand accents", () => {
    expect(accent("#83a2db")).toBe("#F8B4C6");
    expect(accent("#FD8E8C")).toBe("#6E6468");
    expect(accent("#FFE500")).toBe("#E8A87C");
    expect(accent("#123456")).toBe("#123456");
  });

  it("picks a readable text color", () => {
    expect(onAccent("#F8B4C6")).toBe("#1A1517");
    expect(onAccent("#F6F4F1")).toBe("#1A1517");
    expect(onAccent("#EF3B6E")).toBe("#FFFFFF");
    expect(onAccent("#6E6468")).toBe("#FFFFFF");
  });
});
