import { expect, test } from "./fixtures";

// The calendar shows the clinic's wall clock (Asia/Almaty for a new clinic)
const CLINIC_TIME_ZONE = "Asia/Almaty";

/** Wednesday of next week in the clinic, as the slot labels print it */
const nextWednesdayLabel = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CLINIC_TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, Number(part.value)]),
  );
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = (today.getUTCDay() + 6) % 7; // 0 = Monday
  const wednesday = new Date(today);
  wednesday.setUTCDate(today.getUTCDate() - weekday + 7 + 2);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(wednesday);
};

test.describe("task calendar", () => {
  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const sales = await createSales({
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
        sales_id: sales.id,
      });
      await createDeal({
        patient_id: patient.id,
        sales_id: sales.id,
        name: "Implants",
        plan_amount: 450000,
      });
    },
  );

  test("create a task in a slot, reschedule it and complete it with a result", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");

    // The dashboard widget leads to the calendar (week view)
    await page.getByRole("link", { name: "Calendar" }).click();
    await expect(page).toHaveURL(/#\/tasks/);
    const views = page.getByRole("group", { name: "Tasks view" });
    await expect(views.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("Drag a task to another time")).toBeVisible();

    // Next week, so that the new task is never overdue
    await page.getByRole("button", { name: "Next" }).click();
    const day = nextWednesdayLabel();
    await page.getByRole("button", { name: `New task: ${day} 10:00` }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Create task").first()).toBeVisible();
    await dialog.getByLabel("Description").fill("Confirm the implant visit");
    await dialog.getByRole("combobox", { name: "Deal" }).click();
    await page.getByPlaceholder("Search...").fill("Akhmetov");
    await page.getByRole("option", { name: /Akhmetov Daulet/ }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Task added")).toBeVisible();

    const block = page
      .locator("[data-task-id]")
      .filter({ hasText: "Confirm the implant visit" });
    await expect(block).toContainText("10:00");
    await expect(block).toHaveAttribute("data-status", "open");

    // The popover: details and quick rescheduling
    await block.click();
    const popover = page.getByRole("dialog");
    await expect(popover).toContainText("Akhmetov Daulet · Implants");
    await expect(popover).toContainText("Aigerim Saparova");
    await expect(popover).toContainText("30 min");
    await popover.getByRole("button", { name: "+1 hour" }).click();
    await expect(page.getByText(/Task moved/)).toBeVisible();
    await expect(block).toContainText("11:00");

    // Done, with the result
    await page.keyboard.press("Escape");
    await block.click();
    await popover.getByLabel("Result").fill("Booked for Friday 12:00");
    await popover.getByRole("button", { name: "Complete" }).click();
    await expect(page.getByText("Task completed")).toBeVisible();
    await expect(block).toHaveAttribute("data-status", "done");

    // The month shows it too, and the deal feed shows the result
    await views.getByRole("button", { name: "Month" }).click();
    await expect(
      page.locator("[data-task-id]").filter({ hasText: "Confirm the implant" }),
    ).toBeVisible();
    await block.click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: "Akhmetov Daulet · Implants" })
      .click();
    await expect(page.getByRole("list", { name: "Deal feed" })).toContainText(
      "Booked for Friday 12:00",
    );
  });
});
