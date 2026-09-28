import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const organizationOf = async (email: string) =>
  (
    await adminSupabase
      .from("sales")
      .select("organization_id")
      .eq("email", email)
      .single()
  ).data!.organization_id as number;

test.describe("price list", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    await createSales({
      email: "admin@smile.kz",
      first_name: "Dana",
      last_name: "Nurlanova",
      password: "password",
    });
  });

  test("the owner loads the starter price list, changes prices in bulk and sees the history", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/price-list");
    await expect(
      page.getByRole("heading", { name: "Price list", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The clinic's price list is empty"),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Load the typical price list/ })
      .click();

    // The tree: sections and subsections
    const tree = page.getByRole("navigation", { name: "Price list sections" });
    await expect(tree.getByRole("button", { name: /^Терапия/ })).toBeVisible();
    await expect(
      page.getByLabel("Price: Лечение поверхностного кариеса", { exact: true }),
    ).toHaveValue("25 000");

    // A subsection: its services only
    await tree.getByRole("button", { name: /^Лечение кариеса/ }).click();
    await expect(page.getByTestId("price-row")).toHaveCount(5);

    // +10 % on the three caries treatments, rounded to 100 ₸
    for (const name of [
      "Лечение поверхностного кариеса",
      "Лечение среднего кариеса",
      "Лечение глубокого кариеса",
    ]) {
      await page.getByLabel(`Select: ${name}`).check();
    }
    const bulk = page.getByRole("toolbar", {
      name: "Actions on the selected services",
    });
    await expect(bulk.getByText("Selected: 3")).toBeVisible();
    await bulk.getByLabel("Change the price by").fill("+10");
    await bulk.getByRole("button", { name: "Change price" }).click();
    await expect(
      page.getByLabel("Price: Лечение поверхностного кариеса", { exact: true }),
    ).toHaveValue("27 500");
    await expect(
      page.getByLabel("Price: Лечение среднего кариеса", { exact: true }),
    ).toHaveValue("35 200");

    // The cost price (owner) and the history of the price
    const cost = page.getByLabel("Cost price: Лечение поверхностного кариеса");
    await cost.fill("6000");
    await cost.press("Enter");
    await expect(cost).toHaveValue("6 000");
    await page
      .getByRole("button", { name: "Details: Лечение поверхностного кариеса" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Price history")).toBeVisible();
    await expect(dialog.getByTestId("price-history").locator("li")).toHaveCount(
      2,
    );
    await expect(dialog.getByText("27 500 ₸")).toBeVisible();
    await page.keyboard.press("Escape");

    // A new section, a service added to it
    await page.getByRole("button", { name: "Add a section" }).click();
    await page.getByLabel("New section").fill("Эстетика");
    await page.getByLabel("New section").press("Enter");
    await tree.getByRole("button", { name: /^Эстетика/ }).click();
    await page.getByLabel("New service").fill("Микропротезирование");
    await page.getByLabel("Price, ₸").last().fill("70000");
    await page.getByRole("button", { name: "Add service" }).click();
    await expect(
      page.getByLabel("Price: Микропротезирование", { exact: true }),
    ).toHaveValue("70 000");

    // An unused service is deleted
    await page.getByLabel("Select: Микропротезирование").check();
    await bulk.getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(
      page.getByLabel("Price: Микропротезирование", { exact: true }),
    ).toHaveCount(0);

    // Settings → Price list: the discount limit and the link
    await page.goto("/#/settings?section=services");
    await page.getByRole("link", { name: "Open the price list" }).click();
    await expect(page).toHaveURL(/#\/price-list/);
  });

  test("a manager reads the prices but not the cost price, and changes nothing", async ({
    page,
    login,
  }) => {
    const organization_id = await organizationOf("owner@smile.kz");
    const { data: service } = await adminSupabase
      .from("services")
      .insert({
        organization_id,
        name: "Имплант Osstem",
        code: "IM-01",
        category: "Имплантация / Импланты",
        price: 180000,
        position: 100,
      })
      .select("id")
      .single();
    await adminSupabase.from("service_costs").insert({
      organization_id,
      service_id: service!.id,
      cost_price: 72000,
    });

    await login("admin@smile.kz");
    await page.goto("/#/price-list");
    await expect(
      page.getByRole("heading", { name: "Price list", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Имплант Osstem")).toBeVisible();
    await expect(page.getByText("180 000").first()).toBeVisible();
    await expect(page.getByText("72 000")).toHaveCount(0);
    await expect(page.getByText("Cost, ₸")).toHaveCount(0);
    await expect(
      page.getByLabel("Price: Имплант Osstem", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add service" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Add a section" }),
    ).toHaveCount(0);
  });
});
