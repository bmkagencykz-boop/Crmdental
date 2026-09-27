import { expect, test } from "./fixtures";

test.describe("website requests and the Telegram bot", () => {
  let token: string;

  test.beforeEach(async ({ createSales, connectLeads }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    token = await connectLeads();
  });

  test("a website request lands on the board with a note", async ({
    page,
    login,
    menu,
    receiveLead,
  }) => {
    const { deal_id } = await receiveLead(token, {
      name: "Daulet",
      phone: "8 (701) 555-12-34",
      source: "2gis",
      service: "Имплантация",
      comment: "Call me after 6 pm",
      utm_source: "google",
    });

    await login("owner@smile.kz");
    await menu.goToDeals();
    const card = page.locator(`[data-deal-id="${deal_id}"]`);
    await expect(card).toContainText("Daulet");

    await page.goto(`/#/deals/${deal_id}/show`);
    const feed = page
      .getByRole("main")
      .getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Заявка (2GIS)");
    await expect(feed).toContainText("Call me after 6 pm");
    await expect(feed).toContainText("utm_source: google");

    // The same patient writes again: same deal, a second note
    const again = await receiveLead(token, {
      name: "Daulet",
      phone: "+77015551234",
      comment: "Is Saturday possible?",
    });
    expect(again.deal_id).toBe(deal_id);
    await page.reload();
    await expect(
      page.getByRole("main").getByRole("list", { name: "Deal feed" }),
    ).toContainText("Is Saturday possible?");
  });

  test("settings show the address for requests", async ({ page, login }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Website requests" }).click();
    await expect(page.getByLabel("Address for requests")).toHaveValue(
      new RegExp(`/leads_webhook\\?token=${token}$`),
    );
    await expect(
      page.getByRole("button", { name: "Copy", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send a test request" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Form for your website" }),
    ).toBeVisible();
  });

  test("settings show the connected Telegram bot", async ({
    page,
    login,
    connectTelegramBot,
  }) => {
    await connectTelegramBot("smile_clinic_bot");
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Messengers" }).click();
    await expect(
      page.getByText("Bot connected: @smile_clinic_bot"),
    ).toBeVisible();
    await expect(page.getByLabel("Bot token")).toBeVisible();
  });
});
