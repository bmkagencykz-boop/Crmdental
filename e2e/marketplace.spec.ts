import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const MANIFEST = {
  manifest_version: 1,
  id: "roistat-like-analytics",
  name: "Сквозная аналитика Roistat-like",
  description: "Источники заявок и выручка по каналам",
  developer: { name: "Digital Agency", contact: "hello@agency.kz" },
  settings_url: "https://agency.kz/analytics",
  scopes: ["deals:read", "patients:read", "webhooks"],
  webhook: {
    url: "https://agency.kz/hooks/dentalcrm",
    events: ["deal.created", "payment.added"],
  },
};

test.describe("integrations marketplace", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
  });

  test("the catalog shows what is connected, available and coming", async ({
    page,
    login,
    connectMessenger,
  }) => {
    await connectMessenger();
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Integrations", exact: true }).click();
    await expect(page.getByTestId("integrations-page")).toBeVisible();

    // Wazzup24 is connected, Sipuni can be connected
    const wazzup = page.getByRole("button", { name: "Wazzup24" });
    await expect(wazzup.getByTestId("integration-badge")).toHaveText(
      "Connected",
    );
    await page.getByRole("button", { name: /^Telephony/ }).click();
    await expect(
      page
        .getByRole("button", { name: "Sipuni" })
        .getByTestId("integration-badge"),
    ).toHaveText("Available");
    await expect(page.getByRole("button", { name: "Wazzup24" })).toBeHidden();

    // Search across the categories: Dentist Plus is a live connector (beta),
    // IDENT is coming and takes a request
    await page.getByRole("button", { name: /^All/ }).click();
    const search = page.getByLabel("Search: WhatsApp, Sipuni, MIS…");
    await search.fill("dentist");
    await expect(
      page
        .getByRole("button", { name: "Dentist Plus" })
        .getByTestId("integration-badge"),
    ).toHaveText("Beta");
    await search.fill("ident");
    const ident = page.getByRole("button", { name: "IDENT" });
    await expect(ident.getByTestId("integration-badge")).toHaveText("Soon");
    await ident.click();
    const detail = page.getByTestId("integration-detail");
    await expect(detail.getByText("What it does")).toBeVisible();
    await detail.getByRole("button", { name: "Request" }).click();
    await expect(detail.getByText("Request sent")).toBeVisible();
    await page.keyboard.press("Escape");

    // Settings link to the marketplace
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("link", { name: "Integrations marketplace", exact: true })
      .click();
    await expect(page.getByTestId("integrations-page")).toBeVisible();
  });

  test("a developer app is registered, installed, exported and uninstalled", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/integrations");
    await page.getByRole("button", { name: "Register an app" }).click();
    const form = page.getByTestId("app-form");
    await form.getByLabel("Name").fill("Сквозная аналитика");
    await form.getByLabel("Developer", { exact: true }).fill("Digital Agency");
    await form.getByRole("button", { name: "Patients: read" }).click();
    await form.getByLabel("Webhook address").fill("https://agency.kz/hooks");
    await form.getByRole("button", { name: "Webhooks" }).click();
    await form.getByRole("button", { name: "Deal created" }).click();
    await form.getByRole("button", { name: "Register" }).click();
    await expect(form).toBeHidden();

    // Developer apps: the new app, not installed yet
    await page.getByRole("button", { name: /^Developer apps/ }).click();
    const card = page.getByRole("button", { name: "Сквозная аналитика" });
    await expect(card.getByTestId("integration-badge")).toHaveText("Available");
    await card.click();
    const detail = page.getByTestId("integration-detail");
    await expect(detail.getByTestId("app-scopes")).toContainText(
      "patients:read",
    );
    await detail.getByRole("button", { name: "Install" }).click();
    const installed = page.getByTestId("installed-app");
    await expect(installed.getByTestId("installed-app-key")).toContainText(
      "dcrm_",
    );
    await expect(installed.getByTestId("installed-app-secret")).not.toBeEmpty();
    await installed.getByRole("button", { name: "Done" }).click();
    await expect(detail.getByTestId("integration-badge").first()).toHaveText(
      "Connected",
    );

    // The manifest carries the app to another clinic
    await detail.getByRole("button", { name: "Export the manifest" }).click();
    await expect(page.getByTestId("app-manifest")).toContainText(
      '"id": "skvoznaya-analitika"',
    );
    await page.keyboard.press("Escape");

    // Uninstall: the key of the app is revoked
    await detail.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("button", { name: "Disconnect" }).last().click();
    await expect(detail.getByTestId("integration-badge").first()).toHaveText(
      "Available",
    );
    const { data: keys } = await adminSupabase
      .from("api_keys")
      .select("revoked_at, app_id")
      .not("app_id", "is", null);
    expect(keys?.length).toBe(1);
    expect(keys?.[0].revoked_at).not.toBeNull();
  });

  test("an app is installed from a manifest after reviewing its scopes", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/integrations");
    await page.getByRole("button", { name: "Install from a manifest" }).click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", {
      name: "Install from a manifest",
    });
    await input.fill('{"id": "x"}');
    await dialog.getByRole("button", { name: "Check" }).click();
    await expect(dialog.getByRole("alert")).toContainText("No name");

    await input.fill(JSON.stringify(MANIFEST));
    await dialog.getByRole("button", { name: "Check" }).click();
    const review = dialog.getByTestId("manifest-review");
    await expect(review).toContainText("Сквозная аналитика Roistat-like");
    await expect(review).toContainText("Deals: read");
    await expect(review).toContainText("Webhooks");
    await dialog.getByRole("button", { name: "Install" }).click();
    await expect(page.getByTestId("installed-app-key")).toContainText("dcrm_");
    await page.getByRole("button", { name: "Done" }).click();

    await expect(page).toHaveURL(/category=apps/);
    await expect(
      page
        .getByRole("button", { name: "Сквозная аналитика Roistat-like" })
        .getByTestId("integration-badge"),
    ).toHaveText("Connected");
    const { data: hooks } = await adminSupabase
      .from("webhooks")
      .select("url, app_id")
      .not("app_id", "is", null);
    expect(hooks).toEqual([
      expect.objectContaining({ url: "https://agency.kz/hooks/dentalcrm" }),
    ]);
  });

  test("the integrator sets the clinic up but only reads the deals", async ({
    page,
    createSales,
    createPatient,
    createDeal,
  }) => {
    const owner = await adminSupabase
      .from("sales")
      .select("id")
      .eq("email", "owner@smile.kz")
      .single();
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      sales_id: owner.data!.id,
    });
    await createDeal({
      patient_id: patient.id,
      sales_id: owner.data!.id,
      name: "Implants",
    });
    const integrator = await createSales({
      role: "integrator",
      email: "dev@agency.kz",
      first_name: "Timur",
      last_name: "Agency",
      password: "password",
    });
    const expires = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await adminSupabase
      .from("sales")
      .update({ access_expires_at: expires.toISOString() })
      .eq("id", integrator.id);

    // The integrator has no dashboard: the app opens the deals
    await page.goto("/");
    await page.getByLabel("Email").fill("dev@agency.kz");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("integrator-banner")).toContainText(
      `Technical integrator access until ${expires.toLocaleDateString("ru-RU")}`,
    );
    await expect(
      page.getByRole("link", { name: "Deals", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Integrations", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Dashboard", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Patients", exact: true }),
    ).toBeHidden();
    await expect(page.getByText("Implants").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "New deal" })).toBeHidden();

    // Settings: pipelines and the digital pipeline yes, import no
    await page.goto("/#/settings");
    await expect(
      page.getByRole("button", { name: "Pipelines", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Data import", exact: true }),
    ).toBeHidden();

    // After the expiry the account is closed
    await adminSupabase
      .from("sales")
      .update({
        access_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", integrator.id);
    await page.evaluate(() => localStorage.clear());
    await page.goto("/");
    await page.getByLabel("Email").fill("dev@agency.kz");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText(/the technical access expired/).first(),
    ).toBeVisible();
  });
});
