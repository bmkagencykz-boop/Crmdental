import { expect, test } from "./fixtures";

/**
 * The lab module strengthened (stage 43): a lab's own price in «Lab prices
 * and terms», a new order that proposes its dates from the standard terms,
 * a remake with its reason and fault (paid: the clinic's fault), the
 * history of the order, «Ready» (the remade work billed again), the
 * quality tab and the reconciliation act with the lab.
 */
test.describe("lab module: prices, terms, remakes, quality, act", () => {
  test("a remake from the board to the reconciliation act", async ({
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
    await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    await login("owner@smile.kz");

    // A lab and its own price of a metal-ceramic crown
    await page.goto("/#/lab");
    await expect(page.getByTestId("lab-page")).toBeVisible();
    await page.getByRole("tab", { name: "Dictionaries" }).click();
    const dictionaries = page.getByTestId("lab-dictionaries");
    await dictionaries.getByLabel("New lab").fill("Dental Art");
    await dictionaries.getByRole("button", { name: "Add" }).first().click();
    await expect(dictionaries.getByTestId("lab-prices")).toBeVisible();
    const price = dictionaries.getByLabel(
      "Lab price: Коронка металлокерамическая",
      { exact: true },
    );
    await price.fill("20000");
    await price.blur();
    await expect(dictionaries.getByTestId("lab-prices")).toContainText(
      "20 000 ₸",
    );
    // The reasons of a remake of a new clinic
    await expect(dictionaries.getByTestId("lab-dict-reasons")).toBeVisible();

    // A new order: the lab, a crown — the dates proposed by the terms
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
    await dialog.getByLabel("Work", { exact: true }).first().selectOption({
      label: "Коронка металлокерамическая",
    });
    await expect(dialog.getByTestId("lab-proposed-dates")).toBeVisible();
    await expect(dialog.getByLabel("Due", { exact: true })).not.toHaveValue("");
    await expect(dialog.getByText("Lab cost: 20 000 ₸")).toBeVisible();
    await dialog.getByTestId("lab-order-save").click();
    await expect(dialog).toBeHidden();

    // «Remake» from the status menu: the reason and the clinic's fault
    const card = page.getByTestId("lab-order-card").first();
    await expect(card).toContainText("Akhmetov");
    await card.getByRole("button", { name: "Change the status" }).click();
    await page.getByRole("menuitem", { name: "Remake" }).click();
    const remake = page.getByTestId("lab-remake-dialog");
    await remake.getByRole("radio", { name: "Не сел" }).click();
    await remake.getByRole("radio", { name: "Clinic" }).click();
    await expect(remake.getByTestId("lab-remake-money")).toContainText("Paid");
    await remake.getByTestId("lab-remake-save").click();
    await expect(remake).toBeHidden();
    await expect(card.getByTestId("lab-status")).toHaveText("Remake");

    // The order: the remake and the history
    await expect(async () => {
      const toggle = card.getByRole("button", { name: /^(Details|Collapse)$/ });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") {
        await toggle.click();
      }
      await card.getByRole("button", { name: "Edit" }).click({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(dialog.getByTestId("lab-remake-row")).toContainText("Не сел");
    await expect(dialog.getByTestId("lab-remake-paid")).toHaveText("Paid");
    await expect(dialog.getByTestId("lab-order-history")).toContainText(
      "Remake",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Ready: the work and the paid remake are billed this month
    await card.getByRole("button", { name: "Change the status" }).click();
    await page.getByRole("menuitem", { name: "Ready" }).click();
    // A ready order leaves «In work» for «Ready»
    await expect(
      page.getByText(/Work order No\. \d+: Ready/).first(),
    ).toBeVisible();
    await page
      .getByRole("tablist", { name: "In work" })
      .getByRole("tab", { name: "Ready", exact: true })
      .click();
    await expect(
      page.getByTestId("lab-order-card").first().getByTestId("lab-status"),
    ).toHaveText("Ready");
    await page.getByRole("tab", { name: "Lab settlement" }).click();
    await expect(page.getByTestId("lab-settlement-total")).toContainText(
      "40 000",
    );

    // The reconciliation act of the month
    await page.getByTestId("lab-act-open").first().click();
    const act = page.getByTestId("lab-act-dialog");
    await expect(act.getByTestId("lab-act-closing")).toContainText("40 000");
    await expect(act.getByTestId("lab-act-lines")).toContainText(
      "Remake No. 1",
    );
    await act.getByRole("button", { name: "Close" }).first().click();

    // Quality: the remake at the clinic's fault
    await page.getByRole("tab", { name: "Quality" }).click();
    await expect(page.getByTestId("lab-quality")).toBeVisible();
    await expect(page.getByTestId("lab-quality-labs")).toContainText(
      "Dental Art",
    );
    await expect(page.getByTestId("lab-quality-reasons")).toContainText(
      "Не сел",
    );
  });
});
