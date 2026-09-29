import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// A payment of the cash desk: written as the service role
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * Finance (stage 44): the ДДС shows the cash desk and a bank payment with
 * its drill-down, an accrual makes P&L revenue, a new financial model
 * gives a plan with break-even; an administrator has no «Finance».
 */
test.describe("finance", () => {
  test("cash flow, P&L and a model", async ({
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
    await createSales({
      first_name: "Madina",
      last_name: "Ermekova",
      email: "admin@smile.kz",
      password: "password",
      role: "manager",
    });
    await disableTaskRules();
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    const { data: row } = await adminSupabase
      .from("sales")
      .select("organization_id")
      .eq("id", owner.id)
      .single();
    const { error } = await adminSupabase.from("account_operations").insert({
      organization_id: row!.organization_id,
      patient_id: patient.id,
      kind: "payment",
      amount: 50000,
      method: "cash",
      comment: "e2e payment",
    });
    if (error) throw new Error(error.message);

    await login("owner@smile.kz");
    await page.goto("/#/finance");
    await expect(page.getByTestId("finance-page")).toBeVisible();
    await expect(page.getByTestId("finance-inflow")).toContainText("50");

    // Rent paid by bank: a movement outside the cash desk
    await page.getByTestId("finance-add-transaction").click();
    const dialog = page.getByTestId("finance-transaction-dialog");
    await dialog.getByRole("radio", { name: "Payment" }).click();
    await dialog.getByLabel("Amount, ₸").fill("20000");
    await dialog
      .getByLabel("Account", { exact: true })
      .selectOption({ label: "Банк" });
    await dialog
      .getByLabel("Article", { exact: true })
      .selectOption({ label: "Аренда" });
    await dialog.getByLabel("Counterparty").fill("Dostyk Plaza");
    await dialog.getByTestId("finance-transaction-save").click();
    const table = page.getByTestId("finance-cash-table");
    await expect(table).toContainText("Аренда");
    await expect(table).toContainText("Оплата услуг");
    await expect(page.getByTestId("finance-transactions")).toContainText(
      "Dostyk Plaza",
    );

    // The drill-down of «Оплата услуг»
    await table
      .locator('tr[data-row^="article-"]', { hasText: "Оплата услуг" })
      .getByRole("button", { name: "50 000" })
      .first()
      .click();
    await expect(page.getByTestId("finance-movements")).toContainText(
      "Akhmetov",
    );
    await page.keyboard.press("Escape");

    // An accrual of revenue: the P&L
    await page.getByTestId("finance-add-transaction").click();
    await dialog.getByRole("radio", { name: "Accrual" }).click();
    await dialog.getByLabel("Amount, ₸").fill("300000");
    await dialog
      .getByLabel("Article", { exact: true })
      .selectOption({ label: "Оплата услуг" });
    await dialog.getByTestId("finance-transaction-save").click();
    await page.getByRole("tab", { name: "P&L" }).click();
    await expect(page.getByTestId("finance-revenue")).toContainText("300");
    await expect(page.getByTestId("finance-pnl-table")).toContainText(
      "Revenue accruals",
    );

    // A financial model
    await page.getByRole("tab", { name: "Model" }).click();
    await page.getByTestId("finance-model-new").click();
    await expect(page.getByTestId("finance-model-revenue")).toBeVisible();
    await expect(page.getByTestId("finance-model-break-even")).toBeVisible();
    await expect(page.getByTestId("finance-model-table")).toContainText(
      "Break-even revenue",
    );

    // The setup: accounts and articles
    await page.getByRole("tab", { name: "Articles" }).click();
    await expect(page.getByTestId("finance-accounts")).toBeVisible();
    await expect(page.getByTestId("finance-articles-out")).toBeVisible();

    // An administrator without «Reports» has no Finance
    await login("admin@smile.kz");
    await page.goto("/#/");
    await expect(page.getByRole("link", { name: "Finance" })).toHaveCount(0);
  });
});
