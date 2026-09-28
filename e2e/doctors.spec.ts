import { expect, test } from "./fixtures";

test.describe("doctors", () => {
  test("the owner adds a doctor, sets it on a deal and sees it in the reports", async ({
    page,
    login,
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
      stage: "План согласован",
      plan_amount: 300000,
    });

    await login("owner@smile.kz");

    // Settings → Doctors: a new doctor with a specialty
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Doctors" }).click();
    await page
      .getByRole("textbox", { name: "New doctor" })
      .fill("Ахметова Айгуль");
    await page
      .getByRole("textbox", { name: "Specialty" })
      .last()
      .fill("хирург-имплантолог");
    await page.getByRole("button", { name: "Add doctor" }).click();
    await expect(
      page.getByRole("textbox", { name: "Doctor's name" }),
    ).toHaveValue("Ахметова Айгуль");

    // The deal page: doctor, consultation price, a prepayment
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Implants" })).toBeVisible();
    await main.getByRole("button", { name: "Doctor: Edit" }).click();
    await main.getByLabel("Doctor").selectOption("Ахметова Айгуль");
    await expect(main).toContainText("Ахметова Айгуль");
    await main.getByRole("button", { name: "Consultation: Edit" }).click();
    await main.getByLabel("Consultation").fill("5000");
    await main.getByLabel("Consultation").press("Enter");
    await expect(main).toContainText("5 000");

    await main.getByRole("tab", { name: "Payments" }).click();
    // The payment dialog of the cash desk (stage 36)
    await main.getByRole("button", { name: "Accept payment" }).click();
    const payment = page.getByRole("dialog");
    await payment.getByLabel("Amount", { exact: true }).fill("20000");
    await payment.getByRole("checkbox", { name: "Prepayment" }).click();
    await payment.getByRole("button", { name: /^Accept 20/ }).click();
    await payment.getByRole("button", { name: "Done" }).click();
    await expect(
      main
        .getByRole("listitem")
        .filter({ hasText: "20 000" })
        .filter({ hasText: "Prepayment" }),
    ).toContainText("Prepayment");

    // Reports: the doctor has a row in the conversion and in the money
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    const conversionByDoctor = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "By doctor" }) });
    await expect(
      conversionByDoctor
        .getByRole("row")
        .filter({ hasText: "Ахметова Айгуль" }),
    ).toContainText("100 %");

    await page.getByRole("tab", { name: "Money" }).click();
    const moneyByDoctor = page
      .getByRole("tabpanel")
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "By doctor" }) });
    await expect(
      moneyByDoctor.getByRole("row").filter({ hasText: "Ахметова Айгуль" }),
    ).toContainText("20 000");

    // The doctor filter keeps the doctor's deals only
    await page.getByRole("combobox", { name: "Doctor" }).click();
    await page.getByRole("option", { name: "Ахметова Айгуль" }).click();
    await expect(
      moneyByDoctor.getByRole("row").filter({ hasText: "Ахметова Айгуль" }),
    ).toBeVisible();
  });
});
