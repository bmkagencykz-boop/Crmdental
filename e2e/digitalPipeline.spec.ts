import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("digital pipeline", () => {
  test("a trigger set in the grid moves a paid deal and shows it in the feed", async ({
    page,
    login,
    createSales,
    createPatient,
    createDeal,
    disableTaskRules,
  }) => {
    const owner = await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    await disableTaskRules();
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      sales_id: owner.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Implants",
      stage: "План согласован",
      plan_amount: 300000,
    });

    await login("owner@smile.kz");
    await page.goto("/#/settings?section=pipeline_automation");
    const grid = page.getByTestId("digital-pipeline");
    const column = grid.getByRole("listitem", { name: "План согласован" });
    await expect(column).toBeVisible();

    // Add → Trigger: payment added → move to «В лечении»
    await column.getByRole("button", { name: "Add" }).click();
    await page.getByRole("menuitem", { name: "Trigger" }).click();
    const dialog = page.getByTestId("stage-trigger-dialog");
    await dialog.getByRole("textbox", { name: "Rule name" }).fill("Оплата");
    await dialog.getByRole("combobox", { name: "When" }).click();
    await page.getByRole("option", { name: "Payment added" }).click();
    await dialog.getByRole("combobox", { name: "To the stage" }).click();
    await page.getByRole("option", { name: "В лечении" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(
      column.getByRole("button", { name: "Trigger: Оплата" }),
    ).toBeVisible();

    // A payment on the deal: the trigger moves it and the feed says why
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Payments" }).click();
    // The payment dialog of the cash desk (stage 36)
    await main.getByRole("button", { name: "Accept payment" }).click();
    const payment = page.getByRole("dialog");
    await payment.getByLabel("Amount", { exact: true }).fill("50000");
    await payment.getByRole("button", { name: /^Accept 50/ }).click();
    await expect(payment.getByText("Payment for services")).toBeVisible();
    await payment.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await expect(page.getByTestId("automation-run").first()).toContainText(
      "Automatically: stage → В лечении (rule «Оплата»)",
    );

    // The kanban header opens the digital pipeline of the board
    await page.goto("/#/deals");
    await page.getByRole("link", { name: "Digital pipeline" }).click();
    await expect(page.getByTestId("digital-pipeline")).toBeVisible();
  });

  test("API keys and webhooks in the settings", async ({
    page,
    login,
    createSales,
  }) => {
    await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    await login("owner@smile.kz");
    await page.goto("/#/settings?section=api");
    const settings = page.getByTestId("api-settings");

    // A key is shown once; the API functions accept it
    await settings
      .getByRole("textbox", { name: "Key name" })
      .fill("Clinic website");
    await settings.getByRole("combobox", { name: "Access" }).click();
    await page.getByRole("option", { name: "Read and write" }).click();
    await settings.getByRole("button", { name: "Create key" }).click();
    const key = (
      await page.getByTestId("created-api-key-value").textContent()
    )?.trim();
    expect(key).toMatch(/^dcrm_[0-9a-f]{64}$/);
    await page.getByRole("button", { name: "Done, I saved the key" }).click();
    const row = settings.getByTestId("api-key").first();
    await expect(row).toContainText("Clinic website");
    await expect(row).toContainText(key!.slice(0, 12));
    await expect(row).not.toContainText(key!);

    const { data: pipelines, error } = await adminSupabase.rpc(
      "api_list_pipelines",
      { api_key: key },
    );
    expect(error).toBeNull();
    expect(pipelines.data[0].stages.length).toBeGreaterThan(2);

    // Revoked: the key stops working
    await row.getByRole("button", { name: "Revoke" }).click();
    await page.getByRole("button", { name: "Revoke" }).last().click();
    await expect(row).toContainText("Revoked");
    const { error: revokedError } = await adminSupabase.rpc(
      "api_list_pipelines",
      { api_key: key },
    );
    expect(revokedError?.code).toBe("PT401");

    // A webhook: private addresses are refused, a public one is added
    await settings
      .getByRole("textbox", { name: "Address (URL)" })
      .last()
      .fill("http://127.0.0.1:8080/hook");
    await settings.getByRole("button", { name: "Add webhook" }).click();
    await expect(
      page.getByText("A public address is needed").first(),
    ).toBeVisible();
    await settings
      .getByRole("textbox", { name: "Address (URL)" })
      .last()
      .fill("https://partner.example/hooks/crm");
    await settings.getByRole("button", { name: "Add webhook" }).click();
    const webhook = settings.getByTestId("webhook").first();
    await expect(webhook.getByTestId("webhook-state")).toContainText("Working");
    await webhook.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText("Test event queued")).toBeVisible();
    await expect(settings.getByTestId("webhook-deliveries")).toContainText(
      "Test",
    );

    // The documentation link
    await settings.getByRole("link", { name: "API documentation" }).click();
    await expect(
      page.getByRole("heading", { name: "API documentation" }),
    ).toBeVisible();
    await expect(page.getByTestId("api-docs")).toContainText("/api/deals");
  });
});
