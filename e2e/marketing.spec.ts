import { expect, test } from "./fixtures";

test.describe("marketing analytics", () => {
  let token: string;

  test.beforeEach(async ({ createSales, connectLeads, disableTaskRules }) => {
    await createSales({
      role: "owner",
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await createSales({
      first_name: "Dana",
      last_name: "Nurlanova",
      email: "manager@smile.kz",
      password: "password",
    });
    await disableTaskRules();
    token = await connectLeads();
  });

  test("a website request keeps its UTM tags on the deal", async ({
    page,
    login,
    receiveLead,
  }) => {
    const { deal_id } = await receiveLead(token, {
      name: "Daulet",
      phone: "+7 701 555 12 34",
      source: "website",
      utm: {
        utm_source: "instagram",
        utm_medium: "paid_social",
        utm_campaign: "implant_almaty",
      },
      landing_page: "https://clinic.kz/implant",
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal_id}/show`);
    const block = page.getByTestId("deal-attribution");
    // utm_source=instagram gives the source «Instagram»
    await expect(block).toContainText(
      "Instagram · instagram / paid_social / implant_almaty",
    );

    await block.getByRole("button", { name: "Tags" }).click();
    await expect(block).toContainText("https://clinic.kz/implant");
    await block.getByRole("button", { name: "utm_campaign: Edit" }).click();
    const input = block.getByRole("textbox").first();
    await input.fill("implant_autumn");
    await input.press("Enter");
    await expect(block).toContainText("implant_autumn");
  });

  test("the owner books ad spend and reads the cost per lead", async ({
    page,
    login,
    receiveLead,
  }) => {
    for (const [phone, campaign] of [
      ["+77015550001", "implant_almaty"],
      ["+77015550002", "implant_almaty"],
    ]) {
      await receiveLead(token, {
        phone,
        utm_source: "instagram",
        utm_campaign: campaign,
      });
    }

    await login("owner@smile.kz");
    await page.goto("/#/reports");
    await page.getByRole("tab", { name: "Marketing" }).click();
    await page.getByRole("combobox", { name: "Period" }).click();
    await page.getByRole("option", { name: "All time" }).click();

    // Spend of this month on the campaign
    const spend = page.getByTestId("ad-spend");
    const form = spend.getByRole("form", { name: "Add spend" });
    await form.getByRole("combobox", { name: "Source" }).click();
    await page.getByRole("option", { name: "Instagram", exact: true }).click();
    await form
      .getByRole("textbox", { name: "Campaign" })
      .fill("Implant_Almaty");
    await form.getByRole("textbox", { name: "Amount, ₸" }).fill("50000");
    await form.getByRole("button", { name: "Add spend" }).click();
    await expect(spend.getByTestId("ad-spend-row")).toHaveCount(1);

    // 2 leads for 50 000 ₸: 25 000 ₸ a lead
    const report = page.getByTestId("marketing-report");
    const instagram = report
      .getByTestId("marketing-source")
      .filter({ hasText: "Instagram" });
    await expect(instagram).toContainText("50");
    await expect(instagram).toContainText("25");
    await expect(report.getByTestId("marketing-chart")).toContainText(
      "Instagram",
    );

    // The campaign of the spend matches the tag of the deals in any case
    await instagram.getByRole("button", { name: /Instagram/ }).click();
    await expect(
      report
        .getByTestId("marketing-campaign")
        .filter({ hasText: "implant_almaty" }),
    ).toContainText("2");
    await expect(
      report.getByRole("button", { name: "Export CSV" }),
    ).toBeEnabled();
  });

  test("a manager sees neither the report nor the spend", async ({
    page,
    login,
  }) => {
    await login("manager@smile.kz");
    await page.goto("/#/reports");
    await expect(
      page.getByText("Reports are for the owner and the head"),
    ).toBeVisible();
    await expect(page.getByTestId("ad-spend")).toHaveCount(0);
  });
});
