import { expect, test } from "./fixtures";

test("a refused deal needs a reason and can't go back to work", async ({
  page,
  login,
  createSales,
  createPatient,
  createDeal,
}) => {
  const sales = await createSales({
    first_name: "Aigerim",
    last_name: "Saparova",
    email: "owner@smile.kz",
    password: "password",
  });
  const patient = await createPatient({
    first_name: "Daulet",
    last_name: "Akhmetov",
    sales_id: sales.id,
  });
  const deal = await createDeal({
    patient_id: patient.id,
    sales_id: sales.id,
    name: "Implants",
    stage: "В работе",
  });

  await login("owner@smile.kz");
  await page.goto(`/#/deals/${deal.id}`);

  // The form may render again while its dictionaries load, closing the
  // list: open it until the option shows
  await expect(async () => {
    await page.getByRole("combobox", { name: "Stage" }).click();
    await expect(page.getByRole("option", { name: "Отказ" })).toBeVisible({
      timeout: 1000,
    });
  }).toPass();
  await page.getByRole("option", { name: "Отказ" }).click();

  // The reason is required as soon as a lost stage is picked: the form
  // stays open
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("combobox", { name: /Lost reason/ }),
  ).toBeVisible();
  await expect(page.getByText("Edit deal")).toBeVisible();
  await expect(page.getByText("Deal updated")).toBeHidden();

  await page.getByRole("combobox", { name: /Lost reason/ }).click();
  await page.getByRole("option", { name: "Дорого" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Deal updated")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Отказ");
  await expect(page.getByRole("main")).toContainText("Дорого");

  // The database refuses to reopen it: a new request is a new deal
  await page.goto(`/#/deals/${deal.id}`);
  await page.getByRole("combobox", { name: "Stage" }).click();
  await page.getByRole("option", { name: "В работе" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText("Сделка в отказе не возвращается в работу", {
      exact: false,
    }),
  ).toBeVisible();
});
