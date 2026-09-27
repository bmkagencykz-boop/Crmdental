import { afterEach, describe, expect, it, vi } from "vitest";
import { getInitialLocale, i18nProvider } from "./i18nProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i18nProvider", () => {
  it("registers ru and en locales", () => {
    expect(i18nProvider.getLocales?.()).toEqual([
      { locale: "ru", name: "Русский" },
      { locale: "en", name: "English" },
    ]);
  });

  it("translates crm keys in russian", async () => {
    await i18nProvider.changeLocale("ru");

    expect(i18nProvider.translate("crm.language")).toBe("Язык");
    expect(i18nProvider.translate("crm.roles.owner")).toBe("Владелец");
  });

  it("translates react-admin and ra-supabase keys in russian", async () => {
    await i18nProvider.changeLocale("ru");

    expect(i18nProvider.translate("ra.action.save")).toBe("Сохранить");
    expect(i18nProvider.translate("ra-supabase.auth.forgot_password")).toBe(
      "Забыли пароль?",
    );
  });

  it("uses russian plural forms", async () => {
    await i18nProvider.changeLocale("ru");

    expect(
      i18nProvider.translate("crm.common.task_count", { smart_count: 1 }),
    ).toBe("1 задача");
    expect(
      i18nProvider.translate("crm.common.task_count", { smart_count: 3 }),
    ).toBe("3 задачи");
    expect(
      i18nProvider.translate("crm.common.task_count", { smart_count: 5 }),
    ).toBe("5 задач");
  });

  it("falls back to russian for unknown locales", async () => {
    await i18nProvider.changeLocale("es");

    expect(i18nProvider.translate("crm.language")).toBe("Язык");
  });

  it("uses english when the browser prefers it", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US"],
    });

    expect(getInitialLocale()).toBe("en");
  });

  it("defaults to russian for other browser locales", () => {
    vi.stubGlobal("navigator", {
      language: "kk-KZ",
      languages: ["kk-KZ", "ru-RU"],
    });

    expect(getInitialLocale()).toBe("ru");
  });
});
