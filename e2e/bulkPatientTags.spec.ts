import { test, expect } from "./fixtures";

test("user adds a tag to several patients", async ({
  page,
  createPatient,
  createSales,
  login,
  menu,
  dismissToast,
}) => {
  const sales = await createSales({
    email: "owner@smile.kz",
    first_name: "Aigerim",
    last_name: "Saparova",
    password: "password",
  });

  await createPatient({
    first_name: "Daulet",
    last_name: "Akhmetov",
    sales_id: sales.id,
  });
  await createPatient({
    first_name: "Madina",
    last_name: "Karimova",
    sales_id: sales.id,
  });

  await login("owner@smile.kz");

  await expect(page).toHaveTitle(/Dental CRM/);
  await expect(page.getByRole("link", { name: "Patients" })).toBeVisible();

  await menu.goToPatients();
  await expect(page.getByText("Akhmetov Daulet")).toBeVisible();
  await expect(page.getByText("Karimova Madina")).toBeVisible();

  // The header checkbox selects every patient of the page
  await page.getByRole("checkbox").first().click();

  await page.getByRole("button", { name: /^Tag$/ }).click();
  await page.getByRole("button", { name: "Create new tag" }).click();
  await page.getByLabel("Tag name").fill("VIP");
  await page.getByRole("button", { name: "Save" }).click();

  await dismissToast("Tag added to 2 patients");

  await expect(
    page.getByRole("row").filter({ hasText: "Karimova Madina" }),
  ).toContainText("VIP");
  await expect(
    page.getByRole("row").filter({ hasText: "Akhmetov Daulet" }),
  ).toContainText("VIP");
});
