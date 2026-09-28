import { describe, expect, it } from "vitest";

import { addRecent, recentFromPath } from "./recent";
import {
  createShortcutReader,
  isTypingTarget,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
} from "./shortcuts";

const press = (
  read: ReturnType<typeof createShortcutReader>,
  code: string,
  extra: Partial<Parameters<ReturnType<typeof createShortcutReader>>[0]> = {},
) =>
  read({
    code,
    key: code.replace(/^Key/, "").toLowerCase(),
    time: 0,
    ...extra,
  });

describe("createShortcutReader", () => {
  it("focuses the search with / and Ctrl/Cmd+K", () => {
    const read = createShortcutReader();
    expect(press(read, "Slash", { key: "/" })).toEqual({ action: "search" });
    expect(press(read, "KeyK", { ctrlKey: true })).toEqual({
      action: "search",
    });
    expect(press(read, "KeyK", { metaKey: true })).toEqual({
      action: "search",
    });
  });

  it("opens the help with ?", () => {
    const read = createShortcutReader();
    expect(press(read, "Slash", { key: "?", shiftKey: true })).toEqual({
      action: "help",
    });
    // Russian layout: «?» is Shift+7
    expect(press(read, "Digit7", { key: "?", shiftKey: true })).toEqual({
      action: "help",
    });
  });

  it("creates deals and patients", () => {
    const read = createShortcutReader();
    expect(press(read, "KeyN")).toEqual({ action: "new_deal" });
    expect(press(read, "KeyN", { shiftKey: true })).toEqual({
      action: "new_patient",
    });
  });

  it("goes to sections with g + key, whatever the layout", () => {
    const read = createShortcutReader();
    expect(press(read, "KeyG", { key: "п", time: 100 })).toBeNull();
    expect(press(read, "KeyD", { key: "в", time: 400 })).toEqual({
      to: "/deals",
    });
    press(read, "KeyG", { time: 1000 });
    expect(press(read, "KeyS", { time: 1200 })).toEqual({ to: "/schedule" });
    press(read, "KeyG", { time: 2000 });
    expect(press(read, "KeyP", { time: 2100 })).toEqual({ to: "/patients" });
  });

  it("forgets a g pressed too long ago", () => {
    const read = createShortcutReader();
    press(read, "KeyG", { time: 0 });
    expect(press(read, "KeyD", { time: SEQUENCE_TIMEOUT_MS + 1 })).toBeNull();
  });

  it("does nothing while typing, except Ctrl+K", () => {
    const read = createShortcutReader();
    expect(press(read, "KeyN", { typing: true })).toBeNull();
    expect(press(read, "Slash", { key: "/", typing: true })).toBeNull();
    press(read, "KeyG");
    expect(press(read, "KeyD", { typing: true })).toBeNull();
    expect(press(read, "KeyK", { ctrlKey: true, typing: true })).toEqual({
      action: "search",
    });
  });

  it("leaves browser shortcuts alone", () => {
    const read = createShortcutReader();
    expect(press(read, "KeyN", { ctrlKey: true })).toBeNull();
    expect(press(read, "KeyD", { altKey: true })).toBeNull();
  });

  it("lists every shortcut in the help", () => {
    expect(
      SHORTCUTS.every((s) => s.label.startsWith("search.shortcuts.")),
    ).toBe(true);
    expect(
      SHORTCUTS.filter((s) => s.to).map((s) => s.keys.join(" ")),
    ).toContain("g s");
  });
});

describe("isTypingTarget", () => {
  it("recognizes text fields", () => {
    expect(isTypingTarget({ tagName: "INPUT", type: "text" } as never)).toBe(
      true,
    );
    expect(
      isTypingTarget({ tagName: "INPUT", type: "checkbox" } as never),
    ).toBe(false);
    expect(isTypingTarget({ tagName: "TEXTAREA" } as never)).toBe(true);
    expect(
      isTypingTarget({ tagName: "DIV", isContentEditable: true } as never),
    ).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON" } as never)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("recent items", () => {
  it("keeps the latest first, without duplicates, limited", () => {
    let list = addRecent([], { kind: "patient", id: 1 });
    list = addRecent(list, { kind: "deal", id: 1 });
    list = addRecent(list, { kind: "patient", id: 1 });
    expect(list).toEqual([
      { kind: "patient", id: 1 },
      { kind: "deal", id: 1 },
    ]);
    for (let i = 2; i < 20; i++)
      list = addRecent(list, { kind: "deal", id: i });
    expect(list).toHaveLength(8);
    expect(list[0]).toEqual({ kind: "deal", id: 19 });
  });

  it("reads the opened patient or deal from the route", () => {
    expect(recentFromPath("/patients/12/show")).toEqual({
      kind: "patient",
      id: 12,
    });
    expect(recentFromPath("/deals/5/show")).toEqual({ kind: "deal", id: 5 });
    expect(recentFromPath("/deals")).toBeNull();
    expect(recentFromPath("/patients/create")).toBeNull();
  });
});
