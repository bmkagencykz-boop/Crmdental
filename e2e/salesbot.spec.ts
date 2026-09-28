import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("salesbot", () => {
  test("a bot from the gallery is tested, switched on and greets a new WhatsApp lead", async ({
    page,
    login,
    createSales,
    connectMessenger,
    receiveMessage,
  }) => {
    await createSales({
      role: "owner",
      email: "owner@smile.kz",
      first_name: "Aigerim",
      last_name: "Saparova",
      password: "password",
    });
    const token = await connectMessenger();

    // Settings → Salesbot → From a template → «Первичная консультация»
    await login("owner@smile.kz");
    await page.goto("/#/settings?section=salesbots");
    await page.getByRole("button", { name: "From a template" }).click();
    await page
      .getByTestId("salesbot-template")
      .filter({ hasText: "Первичная консультация" })
      .getByRole("button", { name: "Create" })
      .click();
    const editor = page.getByTestId("salesbot-editor");
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("textbox", { name: "Bot name" })).toHaveValue(
      "Первичная консультация",
    );
    await expect(page.getByTestId("salesbot-validation")).toContainText(
      "No errors",
    );
    await expect(page.getByTestId("salesbot-step").first()).toContainText(
      "Message",
    );

    // Test mode: the patient answers «2», the bot sets the tag and offers
    // to book; nothing is sent
    await page.getByRole("tab", { name: "Test" }).click();
    const chat = page.getByTestId("salesbot-test");
    await expect(chat).toContainText("Здравствуйте, Асель!");
    await expect(chat).toContainText("2 — Имплантация");
    await chat.getByRole("textbox", { name: "Patient message" }).fill("2");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat).toContainText("+ tag Имплантация");
    await expect(chat).toContainText("Записать вас?");

    // Switch it on
    await editor.getByRole("switch", { name: "On" }).click();
    await expect(page.getByText("Bot saved")).toBeVisible();
    const { data: bots } = await adminSupabase
      .from("salesbots")
      .select("id, is_active, trigger_new_lead, trigger_transports")
      .eq("name", "Первичная консультация");
    expect(bots).toEqual([
      expect.objectContaining({
        is_active: true,
        trigger_new_lead: true,
        trigger_transports: ["whatsapp"],
      }),
    ]);

    // A new WhatsApp lead: the greeting is queued (auto-message queue)
    const { deal_id } = await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77015550101",
      external_id: "wz-bot-1",
      direction: "in",
      text: "Здравствуйте, сколько стоит имплант?",
      contact: { name: "Daulet" },
    });
    const { data: queued } = await adminSupabase
      .from("automessages")
      .select("status, text, salesbot_session_id")
      .eq("deal_id", deal_id);
    expect(queued).toHaveLength(1);
    expect(queued![0].status).toBe("pending");
    expect(queued![0].salesbot_session_id).not.toBeNull();
    expect(queued![0].text).toContain("Здравствуйте, Daulet!");
    const { data: sessions } = await adminSupabase
      .from("salesbot_sessions")
      .select("status, trigger, current_step")
      .eq("deal_id", deal_id);
    expect(sessions).toEqual([
      { status: "waiting", trigger: "new_lead", current_step: "wait_need" },
    ]);

    // The deal page: the bot indicator, the queue and the feed
    await page.goto(`/#/deals/${deal_id}/show`);
    await expect(page.getByTestId("deal-bot-indicator")).toContainText(
      "The bot is talking",
    );
    const queue = page.getByTestId("deal-automessages");
    await expect(queue).toContainText("Salesbot");
    await expect(queue).toContainText("Scheduled");
    const feed = page
      .getByRole("main")
      .getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Bot «Первичная консультация» started");
    await expect(feed).toContainText("Bot: sent «Здравствуйте, Daulet!");
    await expect(feed).toContainText("Bot: waits for a reply until");

    // «Stop the bot»: the queued greeting is cancelled
    await page
      .getByTestId("deal-bot-indicator")
      .getByRole("button", { name: "Stop the bot" })
      .click();
    await expect(page.getByTestId("deal-bot-indicator")).toBeHidden();
    await expect(feed).toContainText("Bot stopped");
    await expect(queue).toContainText("Cancelled");
  });
});
