import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("reports", () => {
  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const owner = await createSales({
        role: "owner",
        email: "owner@smile.kz",
        first_name: "Aigerim",
        last_name: "Saparova",
        password: "password",
      });
      await createSales({
        email: "manager@smile.kz",
        first_name: "Dana",
        last_name: "Nurlanova",
        password: "password",
      });
      await disableTaskRules();

      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        sales_id: owner.id,
      });
      // A new lead, a booked patient and an agreed plan with a payment
      await createDeal({
        patient_id: patient.id,
        sales_id: owner.id,
        name: "Lead",
      });
      await createDeal({
        patient_id: patient.id,
        sales_id: owner.id,
        name: "Booked",
        stage: "Записан",
      });
      const plan = await createDeal({
        patient_id: patient.id,
        sales_id: owner.id,
        name: "Implants",
        stage: "План согласован",
        plan_amount: 300000,
      });
      const { data: deal } = await adminSupabase
        .from("deals")
        .select("organization_id")
        .eq("id", plan.id)
        .single();
      const { error } = await adminSupabase.from("deal_payments").insert({
        organization_id: deal!.organization_id,
        deal_id: plan.id,
        amount: 100000,
      });
      if (error) throw new Error(error.message);
    },
  );

  test("the owner sees the conversion and the money of the new deals", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

    // Conversion: 3 leads, 2 reached the appointment, 1 the plan and paid
    const leadToAppointment = page
      .getByText("Lead → appointment")
      .first()
      .locator("..");
    await expect(leadToAppointment).toContainText("67 %");
    await expect(leadToAppointment).toContainText("2 / 3");
    await expect(
      page.getByText("Plan → payment").first().locator(".."),
    ).toContainText("100 %");
    const funnel = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Funnel by stage" }) });
    await expect(
      funnel.getByRole("row").filter({ hasText: "Новый лид" }),
    ).toContainText("3");
    await expect(
      funnel.getByRole("row").filter({ hasText: "План согласован" }),
    ).toContainText("1");
    await expect(
      funnel.getByRole("button", { name: "Export CSV" }),
    ).toBeEnabled();

    // Money: the agreed plan and the payment
    await page.getByRole("tab", { name: "Money" }).click();
    await expect(
      page.getByText("Plans agreed").first().locator(".."),
    ).toContainText("300");
    await expect(
      page.getByText("Paid", { exact: true }).first().locator(".."),
    ).toContainText("100");
  });

  test("a manager has no reports", async ({ page, login }) => {
    await login("manager@smile.kz");
    await expect(
      page.getByRole("link", { name: "Deals", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Reports", exact: true }),
    ).toHaveCount(0);
    await page.goto("/#/reports");
    await expect(
      page.getByText("Reports are for the owner and the head"),
    ).toBeVisible();
  });
});
