import { createClient } from "@supabase/supabase-js";
import { test, expect } from "./fixtures";

// Tags and queue rows are prepared / checked with the service role, like the
// fixtures do
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test("the owner queues a mailing to the patients of a tag", async ({
  page,
  createSales,
  createPatient,
  login,
  dismissToast,
}) => {
  const owner = await createSales({
    email: "owner@smile.kz",
    first_name: "Aigerim",
    last_name: "Saparova",
    password: "password",
  });
  const vipPatient = await createPatient({
    first_name: "Daulet",
    last_name: "Akhmetov",
    phone: "+7 701 555 12 34",
    sales_id: owner.id,
  });
  await createPatient({
    first_name: "Madina",
    last_name: "Karimova",
    phone: "+7 701 555 56 78",
    sales_id: owner.id,
  });
  const { data: tag, error } = await adminSupabase
    .from("tags")
    .insert({
      organization_id: owner.organization_id,
      name: "VIP",
      color: "#ffe7c2",
    })
    .select("id")
    .single();
  if (error) throw error;
  await adminSupabase
    .from("patients")
    .update({ tags: [tag.id] })
    .eq("id", vipPatient.id);

  await login("owner@smile.kz");
  await page.getByRole("link", { name: "Mailings" }).click();
  await page.getByRole("button", { name: "New mailing" }).click();

  const form = page.getByTestId("mailing-create");
  await form.getByLabel("Name").fill("VIP hygiene");
  // Everybody first, then only the VIP tag
  await expect(form.getByTestId("segment-count")).toHaveText("2");
  await form
    .getByTestId("segment-tags")
    .getByRole("button", { name: "VIP" })
    .click();
  await expect(form.getByTestId("segment-count")).toHaveText("1");
  await expect(form.getByTestId("segment-patients")).toContainText(
    "Akhmetov Daulet",
  );

  await form.getByLabel("Text").fill("Hello, {имя}! Time for a hygiene visit.");
  await form.getByRole("combobox", { name: "Start" }).click();
  await page.getByRole("option", { name: "At a date and time" }).click();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(
    tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
  await form.getByLabel("Date and time").fill(local);
  await form.getByRole("button", { name: "Queue for 1 patient" }).click();
  await dismissToast("Mailing queued: 1 recipient");

  const card = page
    .getByTestId("mailing-card")
    .filter({ hasText: "VIP hygiene" });
  await expect(card.getByTestId("mailing-status")).toHaveText("Scheduled");
  await expect(card.getByTestId("mailing-queued")).toHaveText("1");

  const { data: rows } = await adminSupabase
    .from("mailing_messages")
    .select("patient_id, status, send_at")
    .eq("organization_id", owner.organization_id);
  expect(rows).toHaveLength(1);
  expect(rows![0]).toMatchObject({
    patient_id: vipPatient.id,
    status: "pending",
  });
});
