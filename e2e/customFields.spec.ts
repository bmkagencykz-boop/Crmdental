import { expect, test } from "./fixtures";

test.describe("custom fields", () => {
  test("the owner adds fields, fills them on a deal, sees them on the card and filters by them", async ({
    page,
    login,
    menu,
    createSales,
    createPatient,
    createDeal,
    disableTaskRules,
  }) => {
    const owner = await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    await disableTaskRules();
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      sales_id: owner.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Implants",
    });
    const other = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Hygiene",
    });

    await login("owner@smile.kz");

    // Settings → Fields: a list shown on the card, a required long text
    await page.goto("/#/settings?section=custom_fields");
    await expect(page.getByRole("tab", { name: "Deal fields" })).toBeVisible();
    await page
      .getByRole("textbox", { name: "New field name" })
      .fill("Откуда узнал");
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "List", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Options" })
      .fill("Инстаграм\n2GIS\nРекомендация");
    await page.getByRole("button", { name: "Add field" }).click();
    await expect(
      page.getByRole("textbox", { name: "Field name" }).first(),
    ).toHaveValue("Откуда узнал");
    await page
      .getByRole("switch", { name: "Откуда узнал: On the card" })
      .click();
    await expect(
      page.getByRole("switch", { name: "Откуда узнал: On the card" }),
    ).toBeChecked();

    await page.getByRole("textbox", { name: "New field name" }).fill("Жалоба");
    await page.getByRole("combobox", { name: "Type" }).click();
    await page.getByRole("option", { name: "Long text" }).click();
    await page.getByRole("button", { name: "Add field" }).click();
    await page.getByRole("switch", { name: "Жалоба: Required" }).click();
    await expect(
      page.getByRole("switch", { name: "Жалоба: Required" }),
    ).toBeChecked();

    // The deal page: the fields under the standard ones, edited in place
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Implants" })).toBeVisible();
    await main.getByRole("button", { name: "Откуда узнал: Edit" }).click();
    await main.getByLabel("Откуда узнал").selectOption("Инстаграм");
    await expect(
      main.getByRole("button", { name: "Откуда узнал: Edit" }),
    ).toContainText("Инстаграм");
    await main.getByRole("button", { name: "Жалоба *: Edit" }).click();
    await main.getByLabel("Жалоба *").fill("Нет двух зубов");
    await main.getByLabel("Жалоба *").blur();
    await expect(main).toContainText("Нет двух зубов");

    // The kanban card shows the chosen field
    await menu.goToDeals();
    await expect(page.locator(`[data-deal-id="${deal.id}"]`)).toContainText(
      "Откуда узнал: Инстаграм",
    );
    await expect(page.locator(`[data-deal-id="${other.id}"]`)).toBeVisible();

    // The filter by a list field keeps the matching deals
    await page.getByRole("button", { name: "Add filter" }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "Additional fields" })
      .click();
    await page
      .getByRole("combobox", { name: "Откуда узнал" })
      .selectOption("Инстаграм");
    await expect(page.locator(`[data-deal-id="${deal.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-deal-id="${other.id}"]`)).toBeHidden();
  });

  test("a patient field is filled in the patient form and shown on the card", async ({
    page,
    login,
    createSales,
    createPatient,
  }) => {
    const owner = await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    const patient = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      sales_id: owner.id,
    });

    await login("owner@smile.kz");
    await page.goto("/#/settings?section=custom_fields");
    await page.getByRole("tab", { name: "Patient fields" }).click();
    await page
      .getByRole("textbox", { name: "New field name" })
      .fill("Полис ДМС");
    await page.getByRole("button", { name: "Add field" }).click();
    await expect(
      page.getByRole("textbox", { name: "Field name" }).first(),
    ).toHaveValue("Полис ДМС");

    await page.goto(`/#/patients/${patient.id}`);
    // The form resets when the record arrives: wait for it before typing
    await expect(page.getByLabel("First name")).toHaveValue("Madina");
    await page.getByLabel("Полис ДМС").fill("ДМС-000123");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("ДМС-000123").first()).toBeVisible();
  });
});
