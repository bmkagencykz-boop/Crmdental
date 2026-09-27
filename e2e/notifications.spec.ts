import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// Same service-role client as the fixtures: backdates messages, sets the
// response limit of the test clinic
const admin = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("notifications", () => {
  let token: string;
  let ownerId: number;
  let organizationId: number;

  test.beforeEach(async ({ createSales, connectMessenger }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    ownerId = owner.id;
    organizationId = owner.organization_id;
    token = await connectMessenger();
  });

  test("a patient message on my deal rings the bell and opens the deal", async ({
    page,
    login,
    createPatient,
    createDeal,
    receiveMessage,
  }) => {
    const patient = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      phone: "+77075550101",
      sales_id: ownerId,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: ownerId,
      name: "Implant",
    });
    // The deal was assigned by the system: that notification is not the point
    await admin.from("notifications").delete().eq("sales_id", ownerId);

    await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77075550101",
      external_id: "wz-notify-1",
      direction: "in",
      text: "Когда можно прийти?",
    });

    await login("owner@smile.kz");
    const badge = page.getByTestId("notifications-badge");
    await expect(badge).toHaveText("1", { timeout: 25_000 });

    await page.getByRole("button", { name: /^Notifications/ }).click();
    const list = page.getByRole("list", { name: "Notifications list" });
    await expect(list).toContainText("New message");
    await expect(list).toContainText("Karimova Madina: Когда можно прийти?");
    await list.getByRole("button", { name: /New message/ }).click();

    await expect(page).toHaveURL(new RegExp(`/deals/${deal.id}/show$`));
    await expect(badge).toBeHidden();
  });

  test("a deal waiting past the limit is marked red on the board and listed on the dashboard", async ({
    page,
    login,
    menu,
    receiveMessage,
  }) => {
    // Limit of 1 minute, round the clock so that the test does not depend on the time
    const { error } = await admin
      .from("organization_settings")
      .update({
        response_limit_minutes: 1,
        response_hours_start: 0,
        response_hours_end: 24,
      })
      .eq("organization_id", organizationId);
    if (error) throw new Error(error.message);

    const { deal_id } = await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77015550202",
      external_id: "wz-notify-2",
      direction: "in",
      text: "Здравствуйте, сколько стоит чистка?",
      contact: { name: "Daulet" },
    });
    // The patient wrote 5 minutes ago
    await admin
      .from("messages")
      .update({ sent_at: new Date(Date.now() - 5 * 60_000).toISOString() })
      .eq("deal_id", deal_id);

    await login("owner@smile.kz");
    const widget = page.getByRole("list", { name: "Waiting for an answer" });
    await expect(widget).toContainText("Daulet");

    await menu.goToDeals();
    const card = page.locator(`[data-deal-id="${deal_id}"]`);
    await expect(card.getByTestId("waiting-badge")).toHaveText(
      /Waiting \d+ min/,
    );

    // The quick filter keeps the waiting deals only
    await page.getByLabel("Waiting for an answer").click();
    await expect(card).toBeVisible();
    await expect(page.locator("[data-deal-id]")).toHaveCount(1);
  });

  test("the owner sets the response limit in the settings", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/settings");
    await page.getByRole("button", { name: "Response control" }).click();
    const limit = page.getByLabel("Answer within, minutes");
    await expect(limit).toHaveValue("15");
    await limit.fill("10");
    await limit.press("Enter");
    await expect(
      page.getByText("Configuration saved successfully"),
    ).toBeVisible();

    const { data } = await admin
      .from("organization_settings")
      .select("response_limit_minutes")
      .eq("organization_id", organizationId)
      .single();
    expect(data?.response_limit_minutes).toBe(10);
  });
});
