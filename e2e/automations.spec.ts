import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

test.describe("automations", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
  });

  test("a new deal gets its first task on its own", async ({
    page,
    login,
    createPatient,
  }) => {
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      sales_id: (
        await adminSupabase
          .from("sales")
          .select("id")
          .eq("email", "owner@smile.kz")
          .single()
      ).data!.id,
    });
    await login("owner@smile.kz");
    await page.goto(`/#/patients/${patient.id}/show`);
    await page.getByRole("link", { name: "New request" }).click();
    await page.getByLabel("Title").fill("Implants");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("main")).toContainText(
      "Связаться с пациентом по новому обращению",
    );
  });

  test("a stage checklist blocks the deal until it is done", async ({
    page,
    login,
    createPatient,
    createDeal,
  }) => {
    const { data: owner } = await adminSupabase
      .from("sales")
      .select("id")
      .eq("email", "owner@smile.kz")
      .single();
    const patient = await createPatient({
      first_name: "Madina",
      last_name: "Karimova",
      sales_id: owner!.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner!.id,
      name: "Braces",
    });

    await login("owner@smile.kz");
    // Settings → Pipelines: a checklist on the first stage
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Checklist: Новый лид" }).click();
    await page.getByLabel("New item").fill("Уточнить жалобу");
    await page.getByLabel("New item").press("Enter");
    await expect(page.getByRole("dialog")).toContainText("Уточнить жалобу");
    await page.keyboard.press("Escape");

    // Moving the deal forward is refused
    await page.goto(`/#/deals/${deal.id}`);
    await page.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "В работе" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText("Выполните чек-лист этапа «Новый лид»"),
    ).toBeVisible();

    // Checked in the deal card, then it moves
    await page.goto(`/#/deals/${deal.id}/show`);
    await page.getByRole("checkbox", { name: "Уточнить жалобу" }).click();
    await expect(page.getByRole("main")).toContainText("1 of 1");
    await page.goto(`/#/deals/${deal.id}`);
    await page.getByRole("combobox", { name: "Stage" }).click();
    await page.getByRole("option", { name: "В работе" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Deal updated")).toBeVisible();
  });

  test("new leads from messengers are shared in turn", async ({
    page,
    login,
    createSales,
    connectMessenger,
    receiveMessage,
  }) => {
    await createSales({
      first_name: "Dana",
      last_name: "Nurlanova",
      email: "dana@smile.kz",
      password: "password",
    });
    await createSales({
      first_name: "Arman",
      last_name: "Tulegenov",
      email: "arman@smile.kz",
      password: "password",
    });
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Lead distribution" }).click();
    await page.getByRole("radio", { name: "In turn" }).click();
    await expect(page.getByText("Configuration saved").first()).toBeVisible();
    await page.getByRole("checkbox", { name: "Dana Nurlanova" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Dana Nurlanova" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("checkbox", { name: "Arman Tulegenov" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Arman Tulegenov" }),
    ).toHaveAttribute("aria-checked", "true");

    const token = await connectMessenger();
    const deals = [];
    for (const [index, chat] of [
      "77010000001",
      "77010000002",
      "77010000003",
    ].entries()) {
      deals.push(
        await receiveMessage(token, {
          transport: "whatsapp",
          chat_id: chat,
          external_id: `rr-${index}`,
          text: "Здравствуйте",
        }),
      );
    }
    const { data } = await adminSupabase
      .from("deals")
      .select("id, sales_id")
      .in(
        "id",
        deals.map((deal) => deal.deal_id),
      )
      .order("id");
    const { data: staff } = await adminSupabase
      .from("sales")
      .select("id, first_name");
    const name = (id: number) =>
      staff?.find((sale) => sale.id === id)?.first_name;
    expect((data ?? []).map((deal) => name(deal.sales_id))).toEqual([
      "Dana",
      "Arman",
      "Dana",
    ]);
  });
});
