import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const salesByEmail = async (email: string) =>
  (
    await adminSupabase
      .from("sales")
      .select("id, organization_id")
      .eq("email", email)
      .single()
  ).data!;

test.describe("branches", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    await createSales({
      email: "dostyk@smile.kz",
      first_name: "Dana",
      last_name: "Nurlanova",
      password: "password",
    });
  });

  test("a clinic with one address looks as before; the second branch brings the switcher", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/deals");
    await expect(
      page.getByRole("combobox", { name: "Branch", exact: true }),
    ).toHaveCount(0);

    await page.goto("/#/settings?section=branches");
    await page.getByLabel("New branch").fill("Dostyk");
    await page.getByRole("button", { name: "Add a branch" }).click();
    await expect(page.locator("[data-branch-id]")).toHaveCount(1);
    // One branch: still no switcher
    await expect(
      page.getByRole("combobox", { name: "Branch", exact: true }),
    ).toHaveCount(0);

    await page.getByLabel("New branch").fill("Abaya");
    await page.getByRole("button", { name: "Add a branch" }).click();
    await expect(page.locator("[data-branch-id]")).toHaveCount(2);
    const switcher = page
      .getByRole("combobox", { name: "Branch", exact: true })
      .first();
    await expect(switcher).toBeVisible();
    await expect(switcher).toContainText("All branches");
  });

  test("the switcher filters the board, the deal shows its branch, «My branch» limits a manager", async ({
    page,
    browser,
    login,
    createPatient,
    createDeal,
  }) => {
    const owner = await salesByEmail("owner@smile.kz");
    const manager = await salesByEmail("dostyk@smile.kz");
    const org = owner.organization_id;
    const { data: branches } = await adminSupabase
      .from("branches")
      .insert([
        { organization_id: org, name: "Dostyk", position: 0 },
        { organization_id: org, name: "Abaya", position: 1 },
      ])
      .select("id, name");
    const dostyk = branches!.find((b) => b.name === "Dostyk")!;
    const abaya = branches!.find((b) => b.name === "Abaya")!;
    await adminSupabase.from("sales_branches").insert({
      organization_id: org,
      sales_id: manager.id,
      branch_id: dostyk.id,
    });

    const daulet = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    const onDostyk = await createDeal({
      patient_id: daulet.id,
      sales_id: owner.id,
      name: "Implants",
    });
    const madina = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      phone: "+77075550000",
      sales_id: owner.id,
    });
    const onAbaya = await createDeal({
      patient_id: madina.id,
      sales_id: owner.id,
      name: "Braces",
    });
    await adminSupabase
      .from("deals")
      .update({ branch_id: dostyk.id })
      .eq("id", onDostyk.id);
    await adminSupabase
      .from("deals")
      .update({ branch_id: abaya.id })
      .eq("id", onAbaya.id);

    // The owner chooses a branch in the top bar
    await login("owner@smile.kz");
    await page.goto("/#/deals");
    await expect(page.getByText("Akhmetov Daulet").first()).toBeVisible();
    await expect(page.getByText("Karimova Madina").first()).toBeVisible();
    await page
      .getByRole("combobox", { name: "Branch", exact: true })
      .first()
      .selectOption({ label: "Abaya" });
    await expect(page.getByText("Karimova Madina").first()).toBeVisible();
    await expect(page.getByText("Akhmetov Daulet")).toHaveCount(0);

    // The deal page shows the branch
    await page.goto(`/#/deals/${onAbaya.id}/show`);
    await expect(
      page.getByRole("main").getByText("Abaya").first(),
    ).toBeVisible();

    // «My branch»: the manager of Dostyk sees the deals of Dostyk only
    await adminSupabase.from("access_rights").insert({
      organization_id: org,
      sales_id: manager.id,
      rights: { deals: { view: "branch", edit: "branch" } },
    });
    const managerPage = await (await browser.newContext()).newPage();
    await managerPage.goto("/");
    await managerPage.getByLabel("Email").fill("dostyk@smile.kz");
    await managerPage.getByLabel("Password").fill("password");
    await managerPage.getByRole("button", { name: "Sign in" }).click();
    await managerPage.getByRole("link", { name: "Deals", exact: true }).click();
    await expect(
      managerPage.getByText("Akhmetov Daulet").first(),
    ).toBeVisible();
    await expect(managerPage.getByText("Karimova Madina")).toHaveCount(0);
  });
});
