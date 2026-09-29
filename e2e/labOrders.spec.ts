import { expect, test } from "./fixtures";

/**
 * Lab work orders (stage 40): the dictionaries (a lab, its technician),
 * a work order with teeth, a work and its due date, the board with the
 * status chip and the overdue chip, «Close the order», the lab settlement,
 * the couriers and the patient card.
 */
test.describe("lab work orders", () => {
  test("an order from the dictionaries to the settlement", async ({
    page,
    login,
    createSales,
    createPatient,
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
    await login("owner@smile.kz");

    // «Lab» from the left rail; the dictionaries: a lab and its technician
    await page.goto("/#/");
    await page.getByRole("link", { name: "Lab" }).first().click();
    await expect(page.getByTestId("lab-page")).toBeVisible();
    await page.getByRole("tab", { name: "Dictionaries" }).click();
    const dictionaries = page.getByTestId("lab-dictionaries");
    await dictionaries.getByLabel("New lab").fill("Dental Art");
    await dictionaries.getByRole("button", { name: "Add" }).first().click();
    await expect(
      dictionaries.getByTestId("lab-dict-labs").getByLabel("Name").first(),
    ).toHaveValue("Dental Art");
    await dictionaries.getByLabel("Technician's name").fill("Serik Abenov");
    await dictionaries.getByRole("button", { name: "Add" }).nth(1).click();
    await expect(
      dictionaries
        .getByTestId("lab-dict-technicians")
        .getByLabel("Name")
        .first(),
    ).toHaveValue("Serik Abenov");
    // The seeded work types come with their lab prices
    await expect(
      dictionaries.getByLabel("Price: Временная коронка", { exact: true }),
    ).toHaveValue("5000");

    // A new work order: patient, lab, technician, teeth, work, due date
    await page.getByRole("tab", { name: "Work orders" }).click();
    await page.getByTestId("lab-new-order").click();
    const dialog = page.getByTestId("lab-order-dialog");
    await dialog.getByTestId("lab-patient-search").fill("Akhmetov");
    await dialog
      .getByRole("option", { name: /Akhmetov/ })
      .first()
      .click();
    await dialog.getByLabel("Lab", { exact: true }).selectOption({
      label: "Dental Art",
    });
    await dialog.getByLabel("Technician", { exact: true }).selectOption({
      label: "Serik Abenov",
    });
    await dialog.getByLabel("Tooth 11", { exact: true }).check();
    await dialog.getByLabel("Tooth 21", { exact: true }).check();
    await dialog.getByLabel("Work", { exact: true }).first().selectOption({
      label: "Временная коронка",
    });
    await dialog.getByLabel("Qty", { exact: true }).first().fill("2");
    await dialog.getByRole("radio", { name: "A2", exact: true }).click();
    await expect(dialog.getByText("Lab cost: 10 000 ₸")).toBeVisible();
    const due = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await dialog.getByLabel("Due", { exact: true }).fill(due);
    await dialog.getByTestId("lab-order-save").click();
    await expect(dialog).toBeHidden();

    // The board: the card of №1 in the clinic; to the lab
    const card = page.getByTestId("lab-order-card").first();
    await expect(card).toContainText("Akhmetov");
    await expect(card).toContainText("No. 1");
    await expect(card).toContainText("Временная коронка × 2");
    await expect(page.getByTestId("lab-kpi-in-work")).toHaveText("1");
    await card.getByRole("button", { name: "Change the status" }).click();
    await page.getByRole("menuitem", { name: "At the lab" }).click();
    await expect(card.getByTestId("lab-status")).toHaveText("At the lab");

    // Overdue: the due date moved to the day before yesterday
    // The board refetches after the status: open the details once it settled
    await expect(async () => {
      const toggle = card.getByRole("button", { name: /^(Details|Collapse)$/ });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await toggle.click();
      }
      await card.getByRole("button", { name: "Edit" }).click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    const past = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await dialog.getByLabel("Due", { exact: true }).fill(past);
    await dialog.getByTestId("lab-order-save").click();
    await expect(dialog).toBeHidden();
    await expect(card.getByTestId("lab-overdue")).toBeVisible();
    await expect(page.getByTestId("lab-kpi-overdue")).toHaveText("1");

    // Couriers: the work went to the lab today
    await page.getByRole("tab", { name: "Couriers" }).click();
    await expect(page.getByTestId("lab-couriers-dropoff")).toContainText(
      "Akhmetov",
    );

    // «Close the order»: given to the patient, ready this month
    await page.getByRole("tab", { name: "Work orders" }).click();
    await page.getByTestId("lab-close-order").first().click();
    await page.getByRole("tab", { name: "Ready" }).click();
    await expect(
      page.getByTestId("lab-order-card").first().getByTestId("lab-status"),
    ).toHaveText("Given to the patient");

    // The lab settlement of the month: 2 × 5 000
    await page.getByRole("tab", { name: "Lab settlement" }).click();
    await expect(page.getByTestId("lab-settlement-total")).toContainText(
      "10 000",
    );
    await expect(page.getByTestId("lab-settlement-labs")).toContainText(
      "Dental Art",
    );

    // The patient card lists the order
    await page.goto(`/#/patients/${patient.id}/show`);
    await expect(page.getByTestId("patient-lab-orders")).toContainText("No. 1");
  });
});
