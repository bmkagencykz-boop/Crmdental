import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Supabase Auth creates the user, then writes app_metadata with a second
// statement: the invited employee must still join the owner's clinic.
test("an employee invited through Supabase Auth joins the clinic", async ({
  page,
  login,
  menu,
  createSales,
}) => {
  const owner = await createSales({
    first_name: "Aigerim",
    last_name: "Saparova",
    email: "owner@smile.kz",
    password: "password",
  });

  // Same call as the users edge function
  const { error } = await adminSupabase.auth.admin.createUser({
    email: "dana@smile.kz",
    password: "password",
    email_confirm: true,
    user_metadata: { first_name: "Dana", last_name: "Nurlanova" },
    app_metadata: { organization_id: owner.organization_id, role: "head" },
  });
  expect(error).toBeNull();

  const { data: sale } = await adminSupabase
    .from("sales")
    .select("organization_id, role")
    .eq("email", "dana@smile.kz")
    .single();
  expect(sale).toEqual({
    organization_id: owner.organization_id,
    role: "head",
  });
  const { count } = await adminSupabase
    .from("organizations")
    .select("*", { count: "exact", head: true });
  expect(count).toBe(1);

  // The owner sees the new colleague
  await login("owner@smile.kz");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(
    page.getByRole("row", { name: "Dana Nurlanova dana@smile.kz Head" }),
  ).toBeVisible();

  // And the employee works in the owner's clinic
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await login("dana@smile.kz");
  await menu.goToDeals();
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByText("Новый лид", { exact: true })).toBeVisible();
});
