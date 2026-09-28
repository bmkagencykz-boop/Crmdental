import { beforeAll, describe, expect, it } from "vitest";

import type { QuickReply, Service } from "../../types";
import type { CrmDataProvider } from "../types";
import type { createDataProvider as CreateDataProvider } from "./dataProvider";
import type GenerateData from "./dataGenerator";

// The demo provider module reads localStorage when imported
let createDataProvider: typeof CreateDataProvider;
let generateData: typeof GenerateData;
beforeAll(async () => {
  if (typeof localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
  }
  ({ createDataProvider } = await import("./dataProvider"));
  generateData = (await import("./dataGenerator")).default;
});

/** The demo as the owner (id 0) or a manager (id 1) */
const setup = (id = 0) =>
  createDataProvider({
    db: generateData(),
    latency: 0,
    silent: true,
    authProvider: { getIdentity: async () => ({ id, fullName: "User" }) },
  });

const reply = async (dataProvider: CrmDataProvider, shortcut: string) =>
  (
    await dataProvider.getList<QuickReply>("quick_replies", {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "id", order: "ASC" },
      filter: {},
    })
  ).data.find((r) => r.shortcut === shortcut)!;

describe("demo setup wizard", () => {
  it("counts the demo clinic as put off, not finished", async () => {
    const progress = await setup().getOnboardingProgress();
    expect(progress?.postponed_at).toBeTruthy();
    expect(progress?.completed_at).toBeFalsy();
    expect(progress?.dismissed_at).toBeFalsy();
  });

  it("saves the clinic and fills the address reply", async () => {
    const dataProvider = setup();
    await dataProvider.saveClinicProfile({
      name: " Жемчуг Дентал ",
      city: "Алматы",
      timezone: "Asia/Aqtobe",
      phone: "8 701 555 12 34",
      address: "Абая, 10",
    });
    const settings = await dataProvider.getOrganizationSettings();
    expect(settings).toMatchObject({
      clinic_city: "Алматы",
      clinic_phone: "+77015551234",
      clinic_address: "Абая, 10",
    });
    const { data: organization } = await dataProvider.getOne("organizations", {
      id: 1,
    });
    expect(organization).toMatchObject({
      name: "Жемчуг Дентал",
      timezone: "Asia/Aqtobe",
    });
    expect((await dataProvider.getConfiguration()).title).toBe("Жемчуг Дентал");
    expect((await reply(dataProvider, "адрес")).text).toMatch(
      /^Наш адрес: Абая, 10\. /,
    );
  });

  it("fills the price reply from the consultation service", async () => {
    const dataProvider = setup();
    await dataProvider.create<Service>("services", {
      data: { name: "Лечение кариеса", position: 20, price: 25000 } as any,
    });
    expect((await reply(dataProvider, "цена")).text).toContain(
      "[укажите цену]",
    );
    const { data: consultation } = await dataProvider.create<Service>(
      "services",
      { data: { name: "Консультация", position: 21 } as any },
    );
    await dataProvider.update<Service>("services", {
      id: consultation.id,
      data: { price: 5000 },
      previousData: consultation,
    });
    expect((await reply(dataProvider, "цена")).text).toBe(
      "{имя}, консультация врача стоит 5 000 ₸. На ней врач проведёт осмотр и составит план лечения.",
    );
  });

  it("lets the owner change the progress, not a manager", async () => {
    const owner = setup(0);
    const progress = await owner.updateOnboardingProgress({
      steps: { clinic: "done" },
      completed_at: "2026-10-01T10:00:00Z",
    });
    expect(progress).toMatchObject({
      steps: { clinic: "done" },
      completed_at: "2026-10-01T10:00:00Z",
    });
    await expect(
      owner.updateOnboardingProgress({ steps: { clinic: "maybe" as any } }),
    ).rejects.toThrow();
    await expect(
      setup(1).updateOnboardingProgress({ dismissed_at: "2026-10-01" }),
    ).rejects.toThrow();
    await expect(
      setup(1).saveClinicProfile({
        name: "Взлом",
        city: "",
        timezone: "",
        phone: "",
        address: "",
      }),
    ).rejects.toThrow();
  });
});
