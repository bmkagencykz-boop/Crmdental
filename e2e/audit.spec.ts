import { expect, test } from "./fixtures";

test.describe("audit log", () => {
  let ownerId: number;

  test.beforeEach(async ({ createSales, disableTaskRules }) => {
    const owner = await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    ownerId = owner.id;
    await createSales({
      email: "manager@smile.kz",
      first_name: "Dana",
      last_name: "Nurlanova",
      password: "password",
    });
    await disableTaskRules();
  });

  test("the owner changes a deal's amount and finds it in the log", async ({
    page,
    login,
    createPatient,
    createDeal,
  }) => {
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      sales_id: ownerId,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: ownerId,
      name: "Implants",
      plan_amount: 100000,
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "Treatment plan: Edit" }).click();
    await main.getByLabel("Treatment plan").fill("120000");
    await main.getByLabel("Treatment plan").press("Enter");
    await expect(main).toContainText("120 000");

    // Settings → Audit log
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(
      page.getByRole("heading", { name: "Audit log" }),
    ).toBeVisible();

    const row = page
      .getByTestId("audit-row")
      .filter({ hasText: /Amount: 100\s000\s₸ → 120\s000\s₸/ });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Aigerim Saparova");
    await expect(row).toContainText("Implants");
    await expect(row.getByRole("link", { name: /Implants/ })).toHaveAttribute(
      "href",
      `#/deals/${deal.id}/show`,
    );

    // The search by deal keeps the row
    await page.getByLabel("Deal or patient").fill("implants");
    await expect(row).toHaveCount(1);
    await page.getByLabel("Deal or patient").fill("nobody");
    await expect(page.getByTestId("audit-row")).toHaveCount(0);
  });

  test("a manager cannot open the log", async ({ page, login }) => {
    await login("manager@smile.kz");
    await expect(page.getByRole("link", { name: "Deals" })).toBeVisible();
    await page.goto("/#/audit");
    await expect(
      page.getByText("The audit log is available to the owner and the head"),
    ).toBeVisible();
    await expect(page.getByTestId("audit-row")).toHaveCount(0);
  });
});
