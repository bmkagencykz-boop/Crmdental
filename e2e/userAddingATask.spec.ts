import { expect, test } from "./fixtures";

test.describe("tasks on a deal", () => {
  let dealId: number;

  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const sales = await createSales({
        first_name: "Aigerim",
        last_name: "Saparova",
        email: "owner@smile.kz",
        password: "password",
      });
      // These scenarios are about deals without any task yet
      await disableTaskRules();

      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        phone: "+77015551234",
        sales_id: sales.id,
        notes: [{ text: "Asked about implants on Instagram." }],
      });

      const deal = await createDeal({
        patient_id: patient.id,
        sales_id: sales.id,
        name: "Implants",
        plan_amount: 450000,
      });
      dealId = deal.id;
    },
  );

  test("a deal without a task is flagged, then gets its next step", async ({
    page,
    login,
    menu,
    closeDialog,
  }) => {
    await login("owner@smile.kz");
    await expect(page).toHaveTitle(/Dental CRM/);

    // The kanban card warns that nothing is planned for this deal
    await menu.goToDeals();
    const card = page.locator(`[data-deal-id="${dealId}"]`);
    await expect(card).toContainText("Akhmetov Daulet");
    await expect(card).toContainText("No task");

    await card.click();
    await expect(page.getByRole("dialog")).toContainText("Implants");

    await page.getByRole("button", { name: "Create task" }).click();
    await page.getByLabel("Description *").fill("Call back about the plan");
    await page.getByLabel("Due date").fill("2030-04-11T10:00");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Task added")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(
      "Call back about the plan",
    );

    await closeDialog();
    await expect(card).not.toContainText("No task");

    await menu.goToDashboard();
    await expect(page.getByText("Upcoming Tasks")).toBeVisible();
    await expect(page.getByText("Call back about the plan")).toBeVisible();
  });
});
