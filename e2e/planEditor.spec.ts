import { expect, test } from "./fixtures";

/**
 * The treatment plan editor as a full page (stage 34): header, stages as
 * tabs, the dental chart (one line per tooth), stage discount and extra
 * discount in the totals, stage templates.
 */
test.describe("plan editor", () => {
  test("stages, teeth from the chart, discounts and a stage template", async ({
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
      name: "Кариес",
    });

    await login("owner@smile.kz");

    // A priced service in the price list
    await page.goto("/#/price-list");
    await page.getByLabel("New service").fill("Лечение кариеса");
    await page.getByLabel("Price, ₸").last().fill("25000");
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(
      page.getByLabel("Price: Лечение кариеса", { exact: true }),
    ).toHaveValue("25 000");

    // The patient card opens a new plan page
    await page.goto(`/#/patients/${patient.id}/show`);
    await page
      .getByRole("link", { name: "New treatment plan" })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`#/patients/${patient.id}/plans/new`),
    );
    const editor = page.getByTestId("plan-page");
    await expect(
      editor.getByRole("navigation", { name: "Breadcrumbs" }),
    ).toContainText("Patients");
    await expect(editor.getByLabel("Treatment plan name")).toHaveValue(
      /Treatment plan, \d\d\.\d\d\.\d{4}/,
    );
    await expect(editor.getByLabel("Deal")).toHaveValue(String(deal.id));
    await page.getByRole("button", { name: "Create the plan" }).click();
    await expect(page.getByText("The plan is created")).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`#/patients/${patient.id}/plans/\\d+$`),
    );

    // Stage 1 exists: two teeth ticked on the chart → one line per tooth
    await expect(
      editor.getByRole("tab", { name: /Stage 1/ }).first(),
    ).toHaveAttribute("aria-selected", "true");
    await editor.getByLabel("Tooth 16", { exact: true }).check();
    await editor.getByLabel("Tooth 17", { exact: true }).check();
    await expect(editor.getByTestId("chart-selection")).toContainText(
      "Selected: 17, 16",
    );
    await editor
      .getByRole("combobox", { name: "Add from the price list" })
      .fill("кариес");
    await editor.getByRole("option", { name: /Лечение кариеса/ }).click();
    await expect(page.getByText("2 lines added")).toBeVisible();
    const lines = editor.getByTestId("stage-items");
    await expect(
      lines.getByLabel("Tooth: Лечение кариеса").first(),
    ).toHaveValue("17");
    await expect(lines.getByLabel("Tooth: Лечение кариеса").last()).toHaveValue(
      "16",
    );
    // The teeth of the stage are highlighted on the chart
    await expect(
      editor.locator('[data-tooth="16"][data-marked="true"]'),
    ).toBeVisible();
    await expect(editor.getByTestId("plan-total")).toContainText(/50\s000/);

    // The stage: name and discount 10 %, the extra discount 5 000 ₸
    await editor.getByLabel("Stage name").fill("Терапия");
    const stageDiscount = editor.getByLabel("Stage discount, %");
    await stageDiscount.fill("10");
    await stageDiscount.press("Tab");
    await editor.getByRole("radio", { name: "₸" }).click();
    const extra = editor.getByLabel("Extra discount");
    await extra.fill("5000");
    await extra.press("Tab");
    await expect(editor.getByTestId("plan-totals")).toContainText(/− 5\s000/);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("The plan is saved")).toBeVisible();
    // 50 000 − 10 % − 5 000 ₸
    await expect(editor.getByTestId("plan-total")).toContainText(/40\s000/);
    await expect(editor.getByTestId("stage-totals")).toContainText(/45\s000/);

    // Save the stage as a template, then add a stage from it
    page.once("dialog", (dialog) => dialog.accept("Кариес, два зуба"));
    await page
      .getByRole("button", { name: "Save as a stage template" })
      .click();
    await expect(page.getByText("The stage template is saved")).toBeVisible();
    await editor.getByRole("button", { name: "Add a stage" }).click();
    await page.getByRole("menuitem", { name: /Кариес, два зуба/ }).click();
    await expect(
      page.getByText("The stage is added from the template"),
    ).toBeVisible();
    await expect(
      editor.getByRole("tab", { name: /Stage 2/ }).first(),
    ).toHaveAttribute("aria-selected", "true");
    // The template has no teeth: one line of 2
    await expect(lines.getByLabel("Qty: Лечение кариеса")).toHaveValue("2");
    await expect(lines.getByLabel("Tooth: Лечение кариеса")).toHaveValue("");

    // Delete the stage
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete the stage" }).click();
    await expect(page.getByText("The stage is deleted")).toBeVisible();
    await expect(editor.getByRole("tab", { name: /Stage 2/ })).toHaveCount(0);

    // The deal tab lists the plan and opens its page
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Treatment plan" }).click();
    await main
      .getByTestId("deal-treatment-plans")
      .getByRole("link", { name: /Open the plan/ })
      .first()
      .click();
    await expect(page.getByTestId("plan-page")).toBeVisible();
    await expect(page.getByTestId("plan-total")).toContainText(/40\s000/);
  });
});
