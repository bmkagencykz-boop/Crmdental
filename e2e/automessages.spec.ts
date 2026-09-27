import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ownerId = async () =>
  (
    await adminSupabase
      .from("sales")
      .select("id")
      .eq("email", "owner@smile.kz")
      .single()
  ).data!.id as number;

test.describe("automatic messages", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
  });

  test("a rule set in the settings queues a message when the deal moves", async ({
    page,
    login,
    createPatient,
    createDeal,
  }) => {
    const sales_id = await ownerId();
    const patient = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      sales_id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id,
      name: "Implants",
    });

    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Auto messages" }).click();
    // The default templates are there, with a live preview
    await expect(page.getByTestId("template-preview").first()).toContainText(
      "Асель",
    );
    await page.getByRole("button", { name: "Add a rule" }).click();
    const rule = page.getByTestId("automessage-rule").last();
    await rule.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "At «В работе»" }).click();
    await expect(rule.getByRole("combobox", { name: "Stage" })).toContainText(
      "В работе",
    );

    await page.goto(`/#/deals/${deal.id}`);
    await page.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "В работе" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Deal updated")).toBeVisible();

    await page.goto(`/#/deals/${deal.id}/show`);
    const queue = page.getByTestId("deal-automessages");
    await expect(queue).toContainText("Напоминание о визите");
    await expect(queue).toContainText("Scheduled");

    // Cancelled from the deal page
    await queue.getByRole("button", { name: "Cancel" }).click();
    await expect(queue).toContainText("Cancelled");
  });

  test("a message shown to the employee first is sent from its task", async ({
    page,
    login,
    createPatient,
    createDeal,
    connectMessenger,
  }) => {
    const sales_id = await ownerId();
    await connectMessenger();
    // The greeting of new leads, shown to the employee first
    const { data: organization } = await adminSupabase
      .from("sales")
      .select("organization_id")
      .eq("id", sales_id)
      .single();
    await adminSupabase
      .from("automessage_rules")
      .update({ is_active: true })
      .eq("organization_id", organization!.organization_id)
      .eq("mode", "confirm")
      .eq("offset_minutes", 0);
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      sales_id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id,
      name: "Braces",
    });
    // What the dispatcher does when the message is due
    await adminSupabase
      .from("automessages")
      .update({ send_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("deal_id", deal.id);
    const { error } = await adminSupabase.rpc("claim_automessages");
    expect(error).toBeNull();

    // messenger_send without Wazzup24: store the message as the function does
    await page.route("**/functions/v1/messenger_send", async (route) => {
      const body = route.request().postDataJSON();
      const { data: message } = await adminSupabase
        .from("messages")
        .insert({
          organization_id: organization!.organization_id,
          patient_id: patient.id,
          deal_id: body.deal_id,
          transport: "whatsapp",
          chat_id: "77010000009",
          direction: "out",
          sales_id,
          text: body.text,
          status: "sent",
          automessage_id: body.automessage_id,
        })
        .select()
        .single();
      await route.fulfill({ json: { data: message } });
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    await expect(page.getByRole("main")).toContainText(
      "Здравствуйте, Daulet! Спасибо за обращение",
    );
    await page.getByTestId("automessage-send").click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Message text")
      .fill("Здравствуйте, Daulet! Когда вам удобно прийти?");
    await dialog.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("The message is sent")).toBeVisible();

    await expect(page.getByRole("main")).toContainText(
      "Когда вам удобно прийти?",
    );
    const { data: rows } = await adminSupabase
      .from("automessages")
      .select("status")
      .eq("deal_id", deal.id);
    expect(rows?.map((row) => row.status)).toEqual(["sent"]);
    const { data: tasks } = await adminSupabase
      .from("tasks")
      .select("done_date")
      .eq("deal_id", deal.id)
      .not("automessage_id", "is", null);
    expect(tasks?.every((task) => task.done_date != null)).toBe(true);
  });
});
