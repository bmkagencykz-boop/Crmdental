import { expect, test } from "./fixtures";

test.describe("messengers", () => {
  let token: string;
  let ownerId: number;

  test.beforeEach(async ({ createSales, connectMessenger }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    ownerId = owner.id;
    token = await connectMessenger();
  });

  test("a WhatsApp message from a new number lands in the inbox and on the board", async ({
    page,
    login,
    menu,
    receiveMessage,
  }) => {
    const { deal_id } = await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77015551234",
      external_id: "wz-1",
      direction: "in",
      text: "Сколько стоит имплант?",
      contact: { name: "Daulet" },
    });

    await login("owner@smile.kz");
    await expect(
      page.getByRole("link", { name: "Inbox" }).getByTestId("nav-badge"),
    ).toHaveText("1");

    // The board shows the new deal with its unread message
    await menu.goToDeals();
    const card = page.locator(`[data-deal-id="${deal_id}"]`);
    await expect(card).toContainText("Daulet");
    await expect(card.getByLabel("1 unread message")).toBeVisible();

    // The inbox opens the conversation and marks it read
    await menu.goToInbox();
    const conversations = page.getByRole("list", { name: "Conversations" });
    await expect(conversations).toContainText("Сколько стоит имплант?");
    await conversations.getByRole("button", { name: /Daulet/ }).click();
    await expect(page.getByText("Сколько стоит имплант?").last()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Inbox" }).getByTestId("nav-badge"),
    ).toBeHidden();

    // The deal card shows the conversation in its feed
    await page.getByRole("link", { name: "Open deal" }).click();
    const feed = page
      .getByRole("dialog")
      .getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Сколько стоит имплант?");
    await expect(feed).toContainText("WhatsApp");
  });

  test("the next message of the patient goes to the same deal", async ({
    page,
    login,
    receiveMessage,
    createPatient,
    createDeal,
  }) => {
    // A patient registered by hand is recognised by the WhatsApp number
    const patient = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      phone: "+77075550000",
      sales_id: ownerId,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      name: "Braces",
    });
    const first = await receiveMessage(token, {
      transport: "whatsapp",
      chat_id: "77075550000",
      external_id: "wz-2",
      text: "Здравствуйте, это Мадина",
    });
    expect(first.deal_id).toBe(deal.id);

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    await expect(
      page.getByRole("dialog").getByRole("list", { name: "Deal feed" }),
    ).toContainText("Здравствуйте, это Мадина");
  });

  test("settings show the Wazzup24 connection", async ({ page, login }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Messengers" }).click();
    await expect(page.getByText("Connected to Wazzup24")).toBeVisible();
    await expect(page.getByLabel("Wazzup24 API key")).toBeVisible();
  });
});
