import { expect, test } from "./fixtures";

test.describe("deal card and tasks screen", () => {
  let dealId: number;
  let otherDealId: number;

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
      });
      const deal = await createDeal({
        patient_id: patient.id,
        sales_id: sales.id,
        name: "Implants",
      });
      dealId = deal.id;
      const other = await createDeal({
        patient_id: patient.id,
        sales_id: sales.id,
        name: "Cleaning",
      });
      otherDealId = other.id;
    },
  );

  test("notes, calls and finished tasks share one feed", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto(`/#/deals/${dealId}/show`);
    const deal = page.getByRole("main");
    await expect(deal).toContainText("Deal created at stage «Новый лид»");
    await expect(deal).toContainText("No task planned");

    // Note (the composer opens on the chat)
    await deal.getByRole("tab", { name: "Note" }).click();
    await deal.getByLabel("Write a note…").fill("Wants a quote by Friday");
    await deal.getByRole("button", { name: "Add note" }).click();
    const feed = deal.getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Wants a quote by Friday");

    // Call
    await deal.getByRole("tab", { name: "Call" }).click();
    const composer = deal;
    await composer.getByRole("radio", { name: "Incoming" }).click();
    await composer.getByLabel("Duration, m:ss").fill("2:30");
    await composer
      .getByRole("textbox", { name: "Comment" })
      .fill("Asked about prices");
    await composer.getByRole("button", { name: "Log call" }).click();
    await expect(feed).toContainText("Incoming");
    await expect(feed).toContainText("2:30 — Asked about prices");

    // Task: open on top, then in the feed once done
    await deal.getByRole("tab", { name: "Task" }).click();
    await deal.getByLabel("What to do").fill("Send the treatment plan");
    await deal.getByRole("button", { name: "Set task" }).click();
    const nextSteps = deal.getByLabel("Next steps");
    await expect(nextSteps).toContainText("Send the treatment plan");
    await nextSteps
      .getByText("Send the treatment plan")
      .locator("xpath=ancestor::div[contains(@class,'items-start')][1]")
      .getByRole("checkbox")
      .click();
    // Completing asks for the result (optional)
    await page.getByRole("button", { name: "Complete" }).click();
    await expect(feed).toContainText("Task done");
    await expect(feed).toContainText("Send the treatment plan");
  });

  test("the tasks screen lists today's and overdue tasks", async ({
    page,
    login,
    menu,
  }) => {
    await login("owner@smile.kz");
    await page.goto(`/#/deals/${dealId}/show`);
    await page.getByRole("tab", { name: "Task" }).click();
    await page.getByLabel("What to do").fill("Call back yesterday");
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page
      .getByLabel("Due date")
      .fill(
        `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T10:00`,
      );
    await page.getByRole("button", { name: "Set task" }).click();
    await expect(page.getByText("Task added")).toBeVisible();

    await menu.goToTasks();
    await page.getByRole("tab", { name: /Overdue/ }).click();
    await expect(page.getByText("Call back yesterday")).toBeVisible();
    await expect(page.getByText("Akhmetov Daulet")).toBeVisible();
    await page.getByRole("tab", { name: /Today/ }).click();
    await expect(page.getByText("Nothing planned for today.")).toBeVisible();
  });

  test("tags on a deal show on the board and filter it", async ({
    page,
    login,
    menu,
  }) => {
    await login("owner@smile.kz");
    await page.goto(`/#/deals/${dealId}/show`);
    const deal = page.getByRole("main");
    await deal.getByRole("button", { name: "Add tag" }).click();
    await page.getByRole("menuitem", { name: "Create new tag" }).click();
    await page.getByLabel("Tag name").fill("VIP");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(deal).toContainText("VIP");

    await menu.goToDeals();
    await expect(page.locator(`[data-deal-id="${dealId}"]`)).toContainText(
      "VIP",
    );
    await expect(page.locator(`[data-deal-id="${otherDealId}"]`)).toBeVisible();

    await page.getByRole("button", { name: "Add filter" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Tags" }).click();
    await page.getByRole("combobox").filter({ hasText: "Tags" }).click();
    await page.getByRole("option", { name: "VIP" }).click();
    await expect(page.locator(`[data-deal-id="${dealId}"]`)).toBeVisible();
    await expect(page.locator(`[data-deal-id="${otherDealId}"]`)).toBeHidden();
  });
});
