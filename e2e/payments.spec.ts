import { expect, test } from "./fixtures";

test.describe("payments and the cash desk", () => {
  test("a shift, a cash payment with change, a deposit, a payment from it, a refund", async ({
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
      name: "Implants",
      stage: "В лечении",
    });

    await login("owner@smile.kz");

    // «Касса» from the left rail: open the shift with 10 000 in the till
    await page.goto("/#/");
    await page.getByRole("link", { name: "Cash desk" }).first().click();
    await expect(page.getByTestId("cash-desk")).toBeVisible();
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const opening = page.getByRole("dialog");
    await opening.getByLabel("Cash at start").fill("10000");
    await opening.getByRole("button", { name: "Open shift" }).click();
    await expect(page.getByTestId("shift-open")).toBeVisible();

    // The patient card: «Счёт», a cash payment of 30 000 with 50 000 given
    await page.goto(`/#/patients/${patient.id}/show?tab=account`);
    const account = page.getByTestId("patient-account");
    await account.getByRole("button", { name: "Accept payment" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Deal").selectOption({ label: "Implants" });
    await dialog.getByLabel("Amount", { exact: true }).fill("30000");
    await dialog.getByLabel("Cash received").fill("50000");
    await expect(dialog.getByTestId("payment-change")).toContainText("20 000");
    await dialog.getByRole("button", { name: /^Accept 30/ }).click();
    await expect(dialog.getByText("Change 20 000 ₸")).toBeVisible();
    await dialog.getByRole("button", { name: "Done" }).click();

    // A deposit by Kaspi QR, then 40 000 paid from it
    await account.getByRole("button", { name: "Top up deposit" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount", { exact: true }).fill("100000");
    await dialog.getByRole("radio", { name: "Kaspi QR" }).click();
    await dialog.getByRole("button", { name: /^Top up 100/ }).click();
    await dialog.getByRole("button", { name: "Done" }).click();

    await account.getByRole("button", { name: "Accept payment" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Deal").selectOption({ label: "Implants" });
    await dialog.getByLabel("Amount", { exact: true }).fill("40000");
    await dialog.getByRole("radio", { name: /^From deposit/ }).click();
    await dialog.getByRole("button", { name: /^Accept 40/ }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(account).toContainText("60 000");
    await expect(account.getByTestId("operations-list")).toContainText(
      "Paid from deposit",
    );

    // The deal is paid 70 000: cash and the deposit
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Payments" }).click();
    await expect(main).toContainText("70 000");

    // A refund of 5 000 in cash (owner)
    await main.getByRole("button", { name: "Refund" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount", { exact: true }).fill("5000");
    await dialog.getByRole("button", { name: /^Refund 5/ }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(main).toContainText("65 000");

    // The cash desk: 30 000 in, 5 000 out in cash; the Kaspi deposit
    await page.goto("/#/cash");
    await expect(page.getByTestId("cash-by-method")).toContainText("30 000");
    await expect(page.getByTestId("cash-by-method")).toContainText("100 000");
    await expect(page.getByTestId("cash-net")).toContainText("125 000");

    // Close the shift: expected 10 000 + 30 000 − 5 000, counted 34 500
    await page
      .getByTestId("shift-open")
      .getByRole("button", { name: "Close shift" })
      .click();
    const closing = page.getByRole("dialog");
    await expect(closing).toContainText("35 000");
    await closing.getByLabel("Counted").fill("34500");
    await expect(closing.getByTestId("shift-discrepancy")).toContainText("500");
    await closing.getByRole("button", { name: "Close shift" }).click();
    await page.getByRole("tab", { name: "Shifts" }).click();
    await expect(page.getByTestId("shifts-table")).toContainText("34 500");
  });
});
