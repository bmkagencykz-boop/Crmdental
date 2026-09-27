import { expect, test } from "./fixtures";

test.describe("deal list view", () => {
  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const owner = await createSales({
        role: "owner",
        email: "owner@smile.kz",
        first_name: "Aigerim",
        last_name: "Saparova",
        password: "password",
      });
      await createSales({
        email: "manager@smile.kz",
        first_name: "Dana",
        last_name: "Nurlanova",
        password: "password",
      });
      await disableTaskRules();
      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        sales_id: owner.id,
      });
      await createDeal({
        patient_id: patient.id,
        sales_id: owner.id,
        name: "Implants",
        stage: "В работе",
        plan_amount: 300000,
      });
      await createDeal({
        patient_id: patient.id,
        sales_id: owner.id,
        name: "Braces",
      });
    },
  );

  test("switches to the list and remembers it", async ({ page, login }) => {
    await login("owner@smile.kz");
    await page.goto("/#/deals");
    await page.getByRole("button", { name: "List", exact: true }).click();

    const table = page.getByRole("table", { name: "Deal list" });
    await expect(table.getByRole("link", { name: "Implants" })).toBeVisible();
    await expect(table.getByRole("link", { name: "Braces" })).toBeVisible();
    await expect(table).toContainText("В работе");

    await page.reload();
    await expect(
      page.getByRole("table", { name: "Deal list" }).getByRole("link", {
        name: "Implants",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "List", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("bulk actions report the deals a rule refuses", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/deals");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("link", { name: "Implants" })).toBeVisible();

    await page
      .getByRole("checkbox", { name: "Select all on the page" })
      .click();
    await expect(page.getByText("2 deals selected")).toBeVisible();

    // A refusal without a reason: both deals fail, with the reason
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Change stage" }).click();
    await page.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "Отказ" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("failed: 2");
    await expect(
      dialog.getByText("Укажите причину отказа").first(),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    // A new responsible for both
    await page
      .getByRole("checkbox", { name: "Select all on the page" })
      .click();
    await page.getByRole("button", { name: "Actions" }).click();
    await page.getByRole("menuitem", { name: "Change responsible" }).click();
    await page.getByRole("combobox", { name: "Responsible" }).click();
    await page.getByRole("option", { name: "Dana Nurlanova" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("dialog")).toContainText("Done: 2");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Done" })
      .click();
    await expect(
      page.getByRole("row").filter({ hasText: "Implants" }),
    ).toContainText("Dana Nurlanova");
  });

  test("saves a filter and shows it on the board too", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/deals");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByPlaceholder("Name or phone").fill("Implants");
    await expect(page.getByRole("link", { name: "Braces" })).toBeHidden();

    await page.getByRole("button", { name: "Save filter" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Implant deals");
    await page.getByLabel("For the whole clinic").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByRole("button", { name: "Implant deals" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Presets and saved filters are on the board as well
    await page.getByRole("button", { name: "Pipeline", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Implant deals" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "My deals" })).toBeVisible();
  });

  test("the owner sets the sales plan of the month", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/reports");
    await page.getByRole("tab", { name: "Sales plan" }).click();
    await page.getByRole("button", { name: "Edit plan" }).click();
    await page.getByLabel("Whole clinic: New deals").fill("10");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Plan saved")).toBeVisible();
    // 2 new deals of 10
    await expect(page.getByRole("group", { name: "New deals" })).toContainText(
      "of 10 · 20 %",
    );

    await page.goto("/#/");
    await expect(page.getByText("Month plan")).toBeVisible();
  });
});
