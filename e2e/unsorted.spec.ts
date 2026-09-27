import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/** Settings → «Неразобранное»: new leads wait to be accepted */
const enableUnsorted = async (page: Page) => {
  await page.goto("/#/settings?section=unsorted");
  const toggle = page.getByLabel("New leads go to «Unsorted»");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(
    page.getByText("Configuration saved successfully").first(),
  ).toBeVisible();
};

test.describe("«Неразобранное» and duplicate patients", () => {
  let token: string;
  let leadToken: string;
  let ownerId: number;

  test.beforeEach(async ({ createSales, connectMessenger, connectLeads }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    ownerId = owner.id;
    token = await connectMessenger();
    leadToken = await connectLeads();
  });

  test("a new WhatsApp lead waits in «Unsorted» until it is accepted", async ({
    page,
    login,
    menu,
    receiveMessage,
  }) => {
    await login("owner@smile.kz");
    await enableUnsorted(page);

    const { deal_id } = await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77015551234",
      external_id: "wz-u1",
      direction: "in",
      text: "Сколько стоит отбеливание?",
      contact: { name: "Daulet" },
    });

    await menu.goToDeals();
    await expect(
      page
        .getByRole("link", { name: "Deals", exact: true })
        .getByTestId("nav-badge"),
    ).toHaveText("1");
    const column = page.getByTestId("unsorted-column");
    const lead = column.locator(`[data-unsorted-id="${deal_id}"]`);
    await expect(lead).toContainText("Daulet");
    await expect(lead).toContainText("Сколько стоит отбеливание?");
    // Not on the stage columns
    await expect(page.locator(`[data-deal-id="${deal_id}"]`)).toHaveCount(0);

    await lead.getByRole("button", { name: "Accept" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Accept the lead")).toBeVisible();
    await dialog.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText("Lead accepted").first()).toBeVisible();

    await expect(lead).toHaveCount(0);
    await expect(page.locator(`[data-deal-id="${deal_id}"]`)).toContainText(
      "Daulet",
    );
    // Accepted, it gets the automations of a new deal
    await page.goto(`/#/deals/${deal_id}/show`);
    await expect(page.getByTestId("unsorted-banner")).toHaveCount(0);
    await expect(page.getByRole("main").getByLabel("Next steps")).toContainText(
      "Связаться с пациентом по новому обращению",
    );
  });

  test("a website lead is rejected as spam from its deal page", async ({
    page,
    login,
    receiveLead,
  }) => {
    await login("owner@smile.kz");
    await enableUnsorted(page);
    const { deal_id } = await receiveLead(leadToken, {
      name: "Spam bot",
      phone: "8 (701) 000-00-01",
      comment: "Продвижение сайтов недорого",
    });

    await page.goto(`/#/deals/${deal_id}/show`);
    const banner = page.getByTestId("unsorted-banner");
    await expect(banner).toContainText("This lead is in «Unsorted»");
    await banner.getByRole("button", { name: "Reject" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reject" })
      .click();
    await expect(page.getByText("Lead rejected").first()).toBeVisible();
    await expect(banner).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText("Спам / не целевое");
  });

  test("a lead from a new Instagram contact is merged into a known patient's deal", async ({
    page,
    login,
    menu,
    createPatient,
    createDeal,
    receiveMessage,
  }) => {
    const patient = await createPatient({
      first_name: "Asel",
      last_name: "Nurlanova",
      phone: "+77017770011",
      sales_id: ownerId,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: ownerId,
      name: "Implant consultation",
    });

    await login("owner@smile.kz");
    await enableUnsorted(page);
    const { deal_id } = await receiveMessage(token, {
      channel_id: "ig-1",
      transport: "instagram",
      chat_id: "ig-9001",
      external_id: "ig-u1",
      direction: "in",
      text: "Hi, it's Asel, can I move my visit?",
      contact: { username: "asel.n" },
    });

    await menu.goToDeals();
    const lead = page
      .getByTestId("unsorted-column")
      .locator(`[data-unsorted-id="${deal_id}"]`);
    await lead.getByRole("button", { name: "Merge with…" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Patient, deal or phone")
      .fill("Implant consultation");
    await dialog.getByRole("radio", { name: /Nurlanova Asel/ }).click();
    await dialog.getByRole("button", { name: "Merge" }).click();
    await expect(page.getByText("Lead merged").first()).toBeVisible();
    await expect(lead).toHaveCount(0);

    await page.goto(`/#/deals/${deal.id}/show`);
    await expect(
      page.getByRole("main").getByRole("list", { name: "Deal feed" }),
    ).toContainText("Hi, it's Asel, can I move my visit?");
  });

  test("the inbox lists the unsorted conversations", async ({
    page,
    login,
    menu,
    receiveMessage,
  }) => {
    await login("owner@smile.kz");
    await enableUnsorted(page);
    await receiveMessage(token, {
      transport: "whatsapp",
      chat_id: "77015552222",
      external_id: "wz-u2",
      direction: "in",
      text: "Добрый день, есть окно на завтра?",
      contact: { name: "Madina" },
    });
    await menu.goToInbox();
    await page.getByRole("tab", { name: "Unsorted" }).click();
    const conversations = page.getByRole("list", { name: "Conversations" });
    await conversations.getByRole("button", { name: /Madina/ }).click();
    await expect(page.getByText("This lead is in «Unsorted»")).toBeVisible();
    await page.getByRole("button", { name: "Accept" }).first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Accept" })
      .click();
    await expect(page.getByText("Lead accepted").first()).toBeVisible();
    await expect(conversations).not.toContainText("Madina");
  });

  test("two patients with the same phone are shown as duplicates and merged", async ({
    page,
    login,
    createPatient,
  }) => {
    const kept = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77017771122",
      sales_id: ownerId,
    });
    await createPatient({
      first_name: "Daulet",
      last_name: "",
      phone: "8 701 777 11 22",
      sales_id: ownerId,
      notes: [{ text: "Allergic to lidocaine" }],
    });

    await login("owner@smile.kz");
    await page.goto(`/#/patients/${kept.id}/show`);
    const warning = page.getByTestId("duplicate-warning");
    await expect(warning).toContainText("Possible duplicate:");
    await expect(warning).toContainText("same phone");
    await warning.getByRole("button", { name: "Merge" }).click();

    const dialog = page.getByTestId("merge-patients-dialog");
    await expect(dialog).toContainText("Merge patients");
    await dialog.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByText("Patients merged").first()).toBeVisible();

    await page.goto(`/#/patients/${kept.id}/show`);
    await expect(page.getByTestId("duplicate-warning")).toHaveCount(0);
    // The other card's note is now on the kept one
    await expect(page.getByRole("main")).toContainText("Allergic to lidocaine");

    await page.goto("/#/settings?section=duplicates");
    await expect(page.getByText("No duplicates found")).toBeVisible();
  });
});
