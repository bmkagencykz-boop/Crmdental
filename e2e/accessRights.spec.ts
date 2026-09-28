import { expect, test } from "./fixtures";

test.describe("access rights", () => {
  test.beforeEach(async ({ createSales, createPatient, createDeal }) => {
    const owner = await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    await createSales({
      role: "head",
      email: "head@smile.kz",
      first_name: "Nurlan",
      last_name: "Beketov",
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

  test("the owner keeps a manager to their own deals and takes the export", async ({
    page,
    browser,
    login,
  }) => {
    // By default a manager sees and exports every deal
    const managerPage = await (await browser.newContext()).newPage();
    await managerPage.goto("/");
    await managerPage.getByLabel("Email").fill("manager@smile.kz");
    await managerPage.getByLabel("Password").fill("password");
    await managerPage.getByRole("button", { name: "Sign in" }).click();
    await managerPage.getByRole("link", { name: "Deals", exact: true }).click();
    await expect(
      managerPage.getByText("Akhmetov Daulet").first(),
    ).toBeVisible();
    await expect(
      managerPage.getByText("Karimova Madina").first(),
    ).toBeVisible();

    // The owner opens Settings → Access rights and changes the matrix
    await login("owner@smile.kz");
    await page.goto("/#/settings?section=access_rights");
    await page.getByRole("button", { name: /Dana Nurlanova/ }).click();
    await page
      .getByRole("combobox", { name: "Deals · View" })
      .selectOption({ label: "Own only" });
    await page
      .getByRole("combobox", { name: "Deals · Edit" })
      .selectOption({ label: "Own only" });
    await page
      .getByRole("combobox", { name: "Deals · Export" })
      .selectOption({ label: "Denied" });
    await page.getByRole("button", { name: "Save rights" }).click();
    await expect(page.getByText("Rights saved")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Dana Nurlanova.*Custom rights/ }),
    ).toBeVisible();

    // The manager now only sees their own deal, without the export button
    // (a new session: the rights are read at sign-in)
    const restricted = await (await browser.newContext()).newPage();
    await restricted.goto("/");
    await restricted.getByLabel("Email").fill("manager@smile.kz");
    await restricted.getByLabel("Password").fill("password");
    await restricted.getByRole("button", { name: "Sign in" }).click();
    await restricted.getByRole("link", { name: "Deals", exact: true }).click();
    await expect(restricted.getByText("Karimova Madina").first()).toBeVisible();
    await expect(restricted.getByText("Akhmetov Daulet")).toBeHidden();
    await expect(
      restricted.getByRole("button", { name: "Export" }),
    ).toBeHidden();

    // The change is in the audit log
    await page.goto("/#/audit");
    await expect(page.getByText("Access rights").first()).toBeVisible();
  });

  test("the head reads the rights but cannot change them", async ({
    page,
    login,
  }) => {
    await login("head@smile.kz");
    await page.goto("/#/settings?section=access_rights");
    await expect(
      page.getByText("Only the owner changes rights").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /Dana Nurlanova/ }).click();
    await expect(
      page.getByRole("combobox", { name: "Deals · View" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save rights" }),
    ).toBeHidden();
  });

  test("a manager has no access rights section", async ({ page, login }) => {
    await login("manager@smile.kz");
    await page.goto("/#/settings?section=access_rights");
    await expect(page.getByText("Access rights")).toBeHidden();
  });
});
