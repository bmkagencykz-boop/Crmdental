import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// Doctors, the price list and the plan items: written as the service role
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("payroll", () => {
  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const owner = await createSales({
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
      await disableTaskRules();
      const { data: row } = await adminSupabase
        .from("sales")
        .select("organization_id")
        .eq("id", owner.id)
        .single();
      const organization_id = row!.organization_id;
      const { data: doctor, error } = await adminSupabase
        .from("doctors")
        .insert({
          organization_id,
          name: "Ivanova Daria",
          specialty: "Therapist",
        })
        .select("id")
        .single();
      if (error) throw new Error(`Failed to add a doctor: ${error.message}`);
      const { data: service } = await adminSupabase
        .from("services")
        .insert({ organization_id, name: "Filling", price: 50000 })
        .select("id")
        .single();
      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        phone: "+77015551234",
        sales_id: owner.id,
      });
      const deal = await createDeal({
        patient_id: patient.id,
        sales_id: owner.id,
        name: "Fillings",
        stage: "В лечении",
      });
      // A plan of the doctor with one item done today: 50 000 ₸
      const { data: plan, error: planError } = await adminSupabase
        .from("treatment_plans")
        .insert({
          organization_id,
          deal_id: deal.id,
          name: "Therapy",
          doctor_id: doctor.id,
        })
        .select("id")
        .single();
      if (planError)
        throw new Error(`Failed to add a plan: ${planError.message}`);
      const { error: itemError } = await adminSupabase
        .from("treatment_plan_items")
        .insert({
          organization_id,
          plan_id: plan.id,
          stage_no: 1,
          service_id: service!.id,
          name: "Filling",
          tooth: "36",
          quantity: 1,
          unit_price: 50000,
          done: true,
        });
      if (itemError)
        throw new Error(`Failed to add an item: ${itemError.message}`);
    },
  );

  test("set up a scheme, see the doctor's card, add a bonus and a payout, close the month", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");

    // «Зарплаты» from the left rail: the doctor's card, no scheme yet
    await page.goto("/#/");
    await page
      .getByRole("link", { name: "Payroll", exact: true })
      .first()
      .click();
    await expect(page.getByTestId("payroll-page")).toBeVisible();
    const card = page
      .getByTestId("payroll-card")
      .filter({ hasText: "Ivanova Daria" });
    await expect(card.getByTestId("payroll-works")).toHaveText("1");
    await expect(card).toContainText("No pay scheme");
    await expect(card.getByTestId("payroll-calendar")).toBeVisible();

    // «Настроить зарплаты»: 30 % of the work
    await page.getByRole("link", { name: "Set up pay" }).first().click();
    await expect(page.getByTestId("payroll-schemes")).toBeVisible();
    const person = page
      .getByTestId("payroll-person")
      .filter({ hasText: "Ivanova Daria" });
    await person.getByRole("button", { name: "Set up" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Applies from").fill("2020-01-01");
    await dialog.getByLabel("Percent of the work").fill("30");
    await dialog.getByTestId("payroll-scheme-save").click();
    await expect(person).toContainText("30 % of the price of the work");

    // Back on the page: 15 000 ₸ accrued for the filling
    await page
      .getByRole("link", { name: "Payroll", exact: true })
      .first()
      .click();
    await expect(card.getByTestId("payroll-accrued")).toContainText("15 000");
    await expect(card).toContainText("Filling");

    // The doctor's page: every line, a bonus, a payout
    await card.getByRole("link", { name: "All accruals" }).first().click();
    await expect(page.getByTestId("payroll-employee")).toBeVisible();
    await expect(page.getByTestId("payroll-lines")).toContainText(
      "Akhmetov Daulet",
    );
    await page.getByRole("button", { name: "Bonus" }).click();
    let adjustment = page.getByRole("dialog");
    await adjustment.getByLabel("Amount, ₸").fill("5000");
    await adjustment.getByLabel("Comment").fill("Reviews");
    await adjustment.getByTestId("payroll-adjustment-save").click();
    await expect(page.getByTestId("payroll-employee-accrued")).toContainText(
      "20 000",
    );
    await page.getByRole("button", { name: "Payout" }).click();
    adjustment = page.getByRole("dialog");
    await expect(adjustment.getByLabel("Amount, ₸")).toHaveValue("20000");
    await adjustment.getByTestId("payroll-adjustment-save").click();
    await expect(page.getByTestId("payroll-employee-balance")).toContainText(
      "0 ₸",
    );
    await expect(page.getByTestId("payroll-adjustments")).toContainText(
      "Reviews",
    );

    // Close the month: the chip says so, no more bonuses
    await page
      .getByRole("link", { name: "Payroll", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Close the month" }).click();
    await page.getByTestId("payroll-confirm").click();
    await expect(page.getByTestId("payroll-month")).toContainText("Closed");
    await card.getByRole("link", { name: "All accruals" }).first().click();
    await expect(page.getByRole("button", { name: "Bonus" })).toBeDisabled();
  });

  test("an administrator has no payroll", async ({ page, login }) => {
    await login("admin@smile.kz");
    await page.goto("/#/");
    await expect(
      page.getByRole("link", { name: "Payroll", exact: true }),
    ).toHaveCount(0);
    await page.goto("/#/payroll");
    await expect(page.getByTestId("payroll-page")).toHaveCount(0);
  });
});
