import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// Same service-role client as the fixtures: restricts the deal visibility
const admin = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("global search", () => {
  let ownerId: number;
  let organizationId: number;
  let patientId: number;
  let dealId: number;

  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const owner = await createSales({
        first_name: "Aigerim",
        last_name: "Saparova",
        email: "owner@smile.kz",
        password: "password",
      });
      ownerId = owner.id;
      organizationId = owner.organization_id;
      await disableTaskRules();
      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        phone: "+77015551234",
        sales_id: ownerId,
      });
      patientId = patient.id;
      const deal = await createDeal({
        patient_id: patient.id,
        sales_id: ownerId,
        name: "Implants",
        plan_amount: 450000,
      });
      dealId = deal.id;
    },
  );

  test("finds a patient by a phone written differently and opens it with the keyboard", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    const search = page.getByRole("combobox", { name: "Global search" });
    await expect(search).toHaveAttribute(
      "placeholder",
      "Search a patient, phone, deal…",
    );

    // «/» puts the cursor in the search field
    await page.locator("body").click();
    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await search.fill("8 701 555 12 34");

    const results = page.getByRole("listbox");
    await expect(results.getByText("Patients")).toBeVisible();
    await expect(
      results
        .getByRole("option")
        .filter({ hasText: "Akhmetov Daulet" })
        .first(),
    ).toContainText("+7 701 555 12 34");
    // The deal of the patient is found by the phone too
    await expect(
      results.getByRole("option").filter({ hasText: "Implants" }),
    ).toContainText("450");

    // Enter opens the best match: the patient with this exact number
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}/show`));
    await expect(
      page.getByRole("heading", { name: "Akhmetov Daulet" }),
    ).toBeVisible();
  });

  test("finds a deal by its name and a part of the patient's name, arrows choose", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    const search = page.getByRole("combobox", { name: "Global search" });
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    await search.fill("akhm impl");
    const deal = page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: "Implants" });
    await expect(deal).toBeVisible();
    await search.press("ArrowDown");
    await expect(deal).toHaveAttribute("aria-selected", "true");
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/deals/${dealId}/show`));

    // «Недавние»: the empty field lists what was opened
    await search.click();
    await expect(page.getByRole("listbox").getByText("Recent")).toBeVisible();
    await expect(
      page
        .getByRole("listbox")
        .getByRole("option")
        .filter({ hasText: "Implants" }),
    ).toBeVisible();
    await search.press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
  });

  test("«Show all» opens the results page", async ({ page, login }) => {
    await login("owner@smile.kz");
    const search = page.getByRole("combobox", { name: "Global search" });
    await search.fill("akhmetov");
    await page.getByRole("listbox").getByText("Show all").click();
    await expect(page).toHaveURL(/#\/search\?q=akhmetov/);
    const main = page.getByRole("main");
    await expect(main.getByText("Akhmetov Daulet").first()).toBeVisible();
    await expect(main.getByText("Implants").first()).toBeVisible();
  });

  test("an unknown number offers a new patient with this number", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    const search = page.getByRole("combobox", { name: "Global search" });
    await search.fill("87079990011");
    await page
      .getByRole("listbox")
      .getByText("+ New patient with the number +7 707 999 00 11")
      .click();
    await expect(page).toHaveURL(/#\/patients\/create/);
    await expect(page.getByPlaceholder("+7 7__ ___ __ __").first()).toHaveValue(
      /707/,
    );
  });

  test("shortcuts: ? lists them, g d opens the deals", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.locator("body").click();
    await page.keyboard.press("Shift+Slash");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("New deal");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();

    await page.keyboard.press("g");
    await page.keyboard.press("d");
    await expect(page).toHaveURL(/#\/deals/);
  });

  test("a manager who only sees own deals does not find a colleague's deal", async ({
    page,
    login,
    createSales,
  }) => {
    await createSales({
      first_name: "Madina",
      last_name: "Nurlanova",
      email: "manager@smile.kz",
      password: "password",
      role: "manager",
    });
    const { error } = await admin
      .from("organization_settings")
      .update({ manager_deal_visibility: "own" })
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    await login("manager@smile.kz");
    const search = page.getByRole("combobox", { name: "Global search" });
    await search.fill("akhmetov");
    const results = page.getByRole("listbox");
    // The patient is shared by the clinic, the deal is not
    await expect(
      results.getByRole("option").filter({ hasText: "Akhmetov Daulet" }),
    ).toBeVisible();
    await expect(results.getByText("Deals", { exact: true })).toBeHidden();
    await expect(
      results.getByRole("option").filter({ hasText: "Implants" }),
    ).toHaveCount(0);
  });
});
