import { expect, test } from "./fixtures";

test.describe("deal card and tasks screen", () => {
  let dealId: number;
  let otherDealId: number;

  test.beforeEach(async ({ createSales, createPatient, createDeal }) => {
    const sales = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
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
  });

  test("notes, calls and finished tasks share one feed", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto(`/#/deals/${dealId}/show`);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Deal created at stage «Новый лид»");

    // Note (the composer opens on messages)
    await dialog.getByRole("tab", { name: "Note" }).click();
    await dialog.getByPlaceholder("Add a note").fill("Wants a quote by Friday");
    await dialog.getByRole("button", { name: "Add this note" }).click();
    const feed = dialog.getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Wants a quote by Friday");

    // Call
    await dialog.getByRole("tab", { name: "Call" }).click();
    const composer = dialog
      .locator("section")
      .filter({ has: page.getByRole("tab", { name: "Call" }) });
    await composer.getByRole("radio", { name: "Incoming" }).click();
    await composer.getByLabel("Duration, m:ss").fill("2:30");
    await composer.getByLabel("Comment").fill("Asked about prices");
    await composer.getByRole("button", { name: "Log call" }).click();
    await expect(feed).toContainText("Incoming · 2:30 — Asked about prices");

    // Task: open on top, then in the feed once done
    await dialog.getByRole("button", { name: "Create task" }).click();
    await page.getByLabel("Description *").fill("Send the treatment plan");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Send the treatment plan")).toBeVisible();
    await dialog
      .getByText("Send the treatment plan")
      .locator("xpath=ancestor::div[contains(@class,'items-start')][1]")
      .getByRole("checkbox")
      .click();
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
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Create task" })
      .click();
    await page.getByLabel("Description *").fill("Call back yesterday");
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page
      .getByLabel("Due date")
      .fill(
        `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}T10:00`,
      );
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Task added")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click();

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
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add tag" }).click();
    await page.getByRole("menuitem", { name: "Create new tag" }).click();
    await page.getByLabel("Tag name").fill("VIP");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toContainText("VIP");
    await dialog.getByRole("button", { name: "Close" }).click();

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
