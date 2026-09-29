import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// The doctor, the lab and a ready work order: written as the service role
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * Money going out of the cash desk (stage 42): «Expense» from the cash
 * desk lowers the expected cash of the shift, a payroll payout «from the
 * cash desk», a lab paid from the cash desk with owed / paid / balance,
 * the expenses tab by category; an administrator records no expense by
 * default.
 */
test.describe("cash desk expenses", () => {
  test("an expense, a payout and a lab payment from the till", async ({
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
    const { data: row } = await adminSupabase
      .from("sales")
      .select("organization_id")
      .eq("id", owner.id)
      .single();
    const organization_id = row!.organization_id;
    const { data: doctor, error: doctorError } = await adminSupabase
      .from("doctors")
      .insert({
        organization_id,
        name: "Ivanova Daria",
        specialty: "Therapist",
      })
      .select("id")
      .single();
    if (doctorError) throw new Error(doctorError.message);
    const { data: lab, error: labError } = await adminSupabase
      .from("labs")
      .insert({ organization_id, name: "Dental Art" })
      .select("id")
      .single();
    if (labError) throw new Error(labError.message);
    // A work order ready today: 2 temporary crowns × 5 000 ₸
    const { data: order, error: orderError } = await adminSupabase
      .from("lab_orders")
      .insert({ organization_id, patient_id: patient.id, lab_id: lab.id })
      .select("id")
      .single();
    if (orderError) throw new Error(orderError.message);
    const { data: workType } = await adminSupabase
      .from("lab_work_types")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("name", "Временная коронка")
      .single();
    const { error: itemError } = await adminSupabase
      .from("lab_order_items")
      .insert({
        organization_id,
        order_id: order.id,
        work_type_id: workType!.id,
        qty: 2,
      });
    if (itemError) throw new Error(itemError.message);
    await adminSupabase
      .from("lab_orders")
      .update({ status: "ready" })
      .eq("id", order.id);

    await login("owner@smile.kz");

    // The cash desk: a shift with 50 000, then «Expense»: 12 000 of materials
    await page.goto("/#/cash");
    await expect(page.getByTestId("cash-desk")).toBeVisible();
    await page.getByRole("button", { name: "Open shift" }).first().click();
    const opening = page.getByRole("dialog");
    await opening.getByLabel("Cash at start").fill("50000");
    await opening.getByRole("button", { name: "Open shift" }).click();
    await expect(page.getByTestId("shift-open")).toBeVisible();

    await page.getByTestId("cash-expense-button").click();
    const expense = page.getByTestId("expense-dialog");
    await expense.getByLabel("Amount", { exact: true }).fill("12000");
    await expense.getByRole("radio", { name: "Cash" }).click();
    await expense
      .getByLabel("Expense category")
      .selectOption({ label: "Материалы" });
    await expense.getByLabel("Comment").fill("Gloves and masks");
    await expect(expense.getByTestId("expense-shift-hint")).toContainText(
      "38 000",
    );
    await expense.getByRole("button", { name: "Record the expense" }).click();
    await expect(page.getByTestId("cash-expenses")).toContainText("12 000");
    await expect(page.getByTestId("operations-list").first()).toContainText(
      "Материалы",
    );
    await expect(page.getByTestId("shift-open")).toContainText("38 000");

    // The payroll: a payout of 20 000 given from the cash desk
    await page.goto(`/#/payroll/d${doctor.id}`);
    await expect(page.getByTestId("payroll-employee")).toBeVisible();
    await page.getByRole("button", { name: "Payout" }).click();
    const payout = page.getByRole("dialog");
    await payout.getByLabel("Amount, ₸").fill("20000");
    await payout.getByRole("radio", { name: "Pay from the cash desk" }).click();
    await payout.getByRole("radio", { name: "Cash" }).click();
    await payout.getByTestId("payroll-adjustment-save").click();
    await expect(page.getByTestId("payroll-adjustments")).toContainText(
      "from the cash desk",
    );

    // The lab settlement: owed 10 000, paid from the cash desk
    await page.goto("/#/lab");
    await page.getByRole("tab", { name: "Lab settlement" }).click();
    const labs = page.getByTestId("lab-settlement-labs");
    await expect(labs).toContainText("Dental Art");
    await expect(labs.getByTestId("lab-settlement-balance")).toContainText(
      "10 000",
    );
    await labs.getByRole("button", { name: "Pay" }).first().click();
    const labPayment = page.getByTestId("lab-payment-dialog");
    await expect(labPayment.getByLabel("Amount", { exact: true })).toHaveValue(
      "10000",
    );
    await labPayment.getByRole("radio", { name: "From the cash desk" }).click();
    await labPayment.getByRole("radio", { name: "Cash" }).click();
    await labPayment.getByTestId("lab-payment-save").click();
    await expect(page.getByTestId("lab-payments")).toContainText("10 000");
    await expect(page.getByTestId("lab-settlement-due")).toContainText("0 ₸");

    // Back in the cash desk: 50 000 − 12 000 − 20 000 − 10 000 expected
    await page.goto("/#/cash");
    await expect(page.getByTestId("shift-open")).toContainText("8 000");
    await page.getByRole("tab", { name: "Expenses" }).click();
    const byCategory = page.getByTestId("expenses-by-category");
    await expect(byCategory).toContainText("Зарплата");
    await expect(byCategory).toContainText("Лаборатория");
    await expect(byCategory).toContainText("Материалы");
    await expect(page.getByTestId("expenses-total")).toContainText("42 000");
  });

  test("an administrator records no expense by default", async ({
    page,
    login,
    createSales,
  }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await createSales({
      first_name: "Dana",
      last_name: "Admin",
      email: "admin@smile.kz",
      password: "password",
      role: "manager",
    });
    await login("admin@smile.kz");
    await page.goto("/#/cash");
    await expect(page.getByTestId("cash-desk")).toBeVisible();
    await expect(page.getByTestId("cash-expense-button")).toHaveCount(0);
  });
});
