import { expect, test } from "./fixtures";

test.describe("staff access", () => {
  test.beforeEach(async ({ createSales, createPatient, createDeal }) => {
    const owner = await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });

    const manager = await createSales({
      email: "manager@smile.kz",
      first_name: "Dana",
      last_name: "Nurlanova",
      password: "password",
    });

    const daulet = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    await createDeal({
      patient_id: daulet.id,
      sales_id: owner.id,
      name: "Implants",
    });

    const madina = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      phone: "+77075550000",
      sales_id: manager.id,
    });
    await createDeal({
      patient_id: madina.id,
      sales_id: manager.id,
      name: "Braces",
    });
  });

  test("the owner narrows the patients down to a manager's", async ({
    page,
    login,
    menu,
  }) => {
    await login("owner@smile.kz");

    await menu.goToPatients();
    await expect(page.getByText("Akhmetov Daulet")).toBeVisible();
    await expect(page.getByText("Karimova Madina")).toBeVisible();

    await page.getByRole("combobox", { name: "Responsible" }).click();
    await page.getByRole("option", { name: "Dana Nurlanova" }).click();
    await expect(page.getByText("Karimova Madina")).toBeVisible();
    await expect(page.getByText("Akhmetov Daulet")).toBeHidden();
  });

  test("patients are found by any spelling of their phone", async ({
    page,
    login,
    menu,
  }) => {
    await login("owner@smile.kz");

    await menu.goToPatients();
    await page.getByPlaceholder("Name or phone").fill("8 (707) 555-00-00");
    await expect(page.getByText("Karimova Madina")).toBeVisible();
    await expect(page.getByText("Akhmetov Daulet")).toBeHidden();
  });

  test("the clinic restricts managers to their own deals", async ({
    page,
    browser,
    login,
    menu,
  }) => {
    // By default a manager sees every deal of the clinic
    await login("manager@smile.kz");
    await menu.goToDeals();
    await expect(page.getByText("Akhmetov Daulet")).toBeVisible();
    await expect(page.getByText("Karimova Madina")).toBeVisible();

    // The owner changes it in the settings
    const ownerPage = await (await browser.newContext()).newPage();
    await ownerPage.goto("/");
    await ownerPage.getByLabel("Email").fill("owner@smile.kz");
    await ownerPage.getByLabel("Password").fill("password");
    await ownerPage.getByRole("button", { name: "Sign in" }).click();
    await ownerPage
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await ownerPage
      .getByRole("button", { name: "Access", exact: true })
      .click();
    await ownerPage.getByRole("radio", { name: "Only their own" }).click();
    await expect(ownerPage.getByText("Configuration saved")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Karimova Madina")).toBeVisible();
    await expect(page.getByText("Akhmetov Daulet")).toBeHidden();
  });
});
