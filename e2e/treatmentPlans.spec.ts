import { expect, test } from "./fixtures";

test.describe("treatment plans", () => {
  test("a plan from the price list: tooth, quantity, agreed — the deal amount follows", async ({
    page,
    login,
    createSales,
    createPatient,
    createDeal,
    disableTaskRules,
  }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await disableTaskRules();
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Implants",
      stage: "Пришёл на консультацию",
    });

    await login("owner@smile.kz");

    // Settings → Price list: a priced service
    await page.goto("/#/settings?section=services");
    await expect(
      page.getByRole("heading", { name: "Price list" }),
    ).toBeVisible();
    await page.getByLabel("New service").fill("Имплант Osstem");
    await page.getByLabel("Price, ₸").last().fill("180000");
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(page.getByLabel("Price: Имплант Osstem")).toHaveValue(
      "180 000",
    );

    // The deal: tab «Treatment plan», a new plan
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Treatment plan" }).click();
    await expect(main.getByText(/No treatment plans yet/)).toBeVisible();
    await main.getByRole("button", { name: "New plan" }).click();
    const editor = page.getByRole("dialog");
    await expect(editor.getByTestId("treatment-plan-editor")).toBeVisible();

    // Added from the price list with the search
    await editor
      .getByRole("combobox", { name: "Add from the price list" })
      .fill("osstem");
    await editor.getByRole("option", { name: /Имплант Osstem/ }).click();
    const tooth = editor.getByLabel("Tooth: Имплант Osstem");
    await expect(tooth).toBeVisible();
    await tooth.fill("36, 46");
    await tooth.press("Enter");
    const quantity = editor.getByLabel("Qty: Имплант Osstem");
    await quantity.fill("2");
    await quantity.press("Enter");
    await expect(editor.getByLabel("Total")).toContainText(/360\s000/);
    await expect(editor.getByLabel("Tooth: Имплант Osstem")).toHaveValue(
      "36, 46",
    );

    // Agreed: the deal amount is the plan total
    await editor.getByRole("button", { name: "Agreed", exact: true }).click();
    await expect(page.getByText(/Plan agreed\. Deal amount/)).toBeVisible();
    await expect(editor.getByText("Main", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    const plans = main.getByTestId("deal-treatment-plans");
    await expect(plans).toContainText("Agreed");
    await expect(plans).toContainText(/Deal amount\s*360\s000/);

    // The payments tab shows the same plan amount
    await main.getByRole("tab", { name: "Payments" }).click();
    await expect(main).toContainText(/360\s000/);
  });

  test("the estimate PDF is saved to the files of the deal", async ({
    page,
    login,
    createSales,
    createPatient,
    createDeal,
    disableTaskRules,
  }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await disableTaskRules();
    const patient = await createPatient({
      first_name: "Асель",
      last_name: "Нурланова",
      sales_id: owner.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Коронки",
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Treatment plan" }).click();
    await main.getByRole("button", { name: "New plan" }).click();
    const editor = page.getByRole("dialog");

    // A custom item (not in the price list) with a price
    await editor
      .getByRole("combobox", { name: "Add from the price list" })
      .fill("Коронка циркониевая");
    await editor
      .getByRole("option", { name: /Custom item: «Коронка циркониевая»/ })
      .click();
    const price = editor.getByLabel("Price: Коронка циркониевая");
    await price.fill("120000");
    await price.press("Enter");
    await expect(editor.getByLabel("Total")).toContainText(/120\s000/);

    // «Смета PDF» → «Сохранить в файлы сделки»
    await editor.getByRole("button", { name: "Estimate PDF" }).click();
    await editor.getByRole("button", { name: "Save to deal files" }).click();
    await expect(
      page.getByText("The estimate is saved to the deal files"),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await main.getByRole("tab", { name: "Files" }).click();
    const files = main.getByRole("list", { name: "Files" });
    await expect(files.getByRole("listitem")).toHaveCount(1);
    await expect(files).toContainText(
      /Estimate — Treatment plan — Нурланова Асель\.pdf/,
    );
  });
});
