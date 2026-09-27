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
  }) => {
    await login("owner@smile.kz");
    await expect(page).toHaveTitle(/Dental CRM/);

    // The kanban card warns that nothing is planned for this deal
    await menu.goToDeals();
    const card = page.locator(`[data-deal-id="${dealId}"]`);
    await expect(card).toContainText("Akhmetov Daulet");
    await expect(card).toContainText("No task");

    // The deal page warns too, and sets the task in place
    await card.click();
    const deal = page.getByRole("main");
    await expect(deal).toContainText("Implants");
    await expect(deal).toContainText("No task planned");
    await deal.getByRole("button", { name: "add", exact: true }).click();
    await deal.getByLabel("What to do").fill("Call back about the plan");
    await deal.getByLabel("Due date").fill("2030-04-11T10:00");
    await deal.getByRole("button", { name: "Set task" }).click();

    await expect(page.getByText("Task added")).toBeVisible();
    await expect(deal.getByLabel("Next steps")).toContainText(
      "Call back about the plan",
    );

    await menu.goToDeals();
    await expect(card).not.toContainText("No task");

    await menu.goToDashboard();
    await expect(page.getByText("Upcoming Tasks")).toBeVisible();
    await expect(page.getByText("Call back about the plan")).toBeVisible();
  });
});
