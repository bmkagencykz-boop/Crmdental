import { expect, test } from "./fixtures";

test.describe("telephony", () => {
  let token: string;

  test.beforeEach(async ({ createSales, connectTelephony }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    token = await connectTelephony("zadarma");
  });

  test("a missed call from a new number opens a deal with a call-back task", async ({
    page,
    login,
    receiveCall,
  }) => {
    const started = await receiveCall(
      token,
      { call_id: "zd-1", direction: "in", phone: "8 701 555 12 34" },
      "zadarma",
    );
    const ended = await receiveCall(
      token,
      {
        call_id: "zd-1",
        direction: "in",
        phone: "+77015551234",
        status: "missed",
      },
      "zadarma",
    );
    // Start and end of one call are one row
    expect(ended.call_id).toBe(started.call_id);

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${started.deal_id}/show`);
    const deal = page.getByRole("main");
    const feed = deal.getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Incoming");
    await expect(feed.getByText("Missed", { exact: true })).toBeVisible();
    await expect(deal.getByLabel("Next steps")).toContainText("Перезвонить");
    await expect(deal).toContainText("+77015551234");
  });

  test("an answered call shows the employee of the internal number and the recording", async ({
    page,
    login,
    receiveCall,
  }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Telephony" }).click();
    const extension = page.getByLabel("Internal number: Aigerim Saparova");
    await extension.fill("101");
    await extension.press("Enter");
    await expect(page.getByText("Internal number saved")).toBeVisible();

    const { deal_id } = await receiveCall(
      token,
      {
        call_id: "zd-2",
        direction: "in",
        phone: "+77075550000",
        extension: "101",
        status: "answered",
        duration: 95,
      },
      "zadarma",
    );
    // The recording comes with a later event
    await receiveCall(
      token,
      { call_id: "zd-2", record_url: "https://example.com/zd-2.mp3" },
      "zadarma",
    );

    await page.goto(`/#/deals/${deal_id}/show`);
    const feed = page
      .getByRole("main")
      .getByRole("list", { name: "Deal feed" });
    await expect(feed).toContainText("Answered · 1:35");
    await expect(feed).toContainText("Aigerim Saparova");
    await expect(feed.getByLabel("Call recording")).toHaveAttribute(
      "src",
      "https://example.com/zd-2.mp3",
    );
  });

  test("settings show the webhook address and simulate a call", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Telephony" }).click();
    await expect(page.getByText("Telephony connected: Zadarma")).toBeVisible();
    await expect(page.getByLabel("Address for the PBX")).toHaveValue(
      new RegExp(`telephony_webhook\\?provider=zadarma&token=${token}$`),
    );

    await page.getByRole("button", { name: "Test call" }).click();
    await expect(page.getByText(/Test call received/)).toBeVisible();
    await page.getByRole("link", { name: "Open deal" }).click();
    const feed = page
      .getByRole("main")
      .getByRole("list", { name: "Deal feed" });
    await expect(feed.getByText("Missed", { exact: true })).toBeVisible();

    // Switching to Mango Office changes the address form
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Telephony" }).click();
    await page.getByRole("radio", { name: "Mango Office" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByLabel("Address for the PBX")).toHaveValue(
      new RegExp(`telephony_webhook/mango/${token}$`),
    );
  });
});
