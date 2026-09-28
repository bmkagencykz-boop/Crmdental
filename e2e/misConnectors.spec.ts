import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// What the MIS edge functions do (service role): the vendor payload is
// already mapped to the neutral shape of public.mis_upsert_*
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const connectionId = async (kind: "dentist_plus" | "macdent") => {
  const { data, error } = await adminSupabase
    .from("integrations")
    .select("id")
    .eq("kind", kind)
    .single();
  if (error) throw new Error(`No ${kind} connection: ${error.message}`);
  return data.id as number;
};

const misCall = async (
  fn: "mis_upsert_appointment" | "mis_upsert_payment" | "mis_visit_completed",
  args: Record<string, unknown>,
) => {
  const { data, error } = await adminSupabase.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as { result: string; deal_id: number; patient_id: number };
};

test.describe("MIS connectors", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
  });

  test("the owner connects Dentist Plus, a synced visit shows on the deal", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/settings?section=mis");
    const dentistPlus = page.getByRole("listitem").filter({
      hasText: "Dentist Plus",
    });
    await dentistPlus
      .first()
      .getByRole("button", { name: "Connect: Dentist Plus" })
      .click();
    const settings = page.getByTestId("mis-settings-dentist_plus");
    await expect(
      settings.getByText("To confirm with the vendor's documentation"),
    ).toBeVisible();
    await settings.getByLabel("API key").fill("dp-test-key");
    await settings
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(page.getByText("MIS settings saved")).toBeVisible();
    await expect(settings.getByTestId("mis-status")).toContainText("Connected");
    // The default mapping points at the stages of the clinic template
    await expect(
      settings.getByLabel("What to do with the deal: Booked"),
    ).toContainText("Записан");
    await expect(settings.getByLabel("Address for the MIS")).toHaveValue(
      /mis_webhook\?kind=dentist_plus&token=/,
    );

    // A booking arrives from the MIS: new patient, deal «Записан»
    const connection = await connectionId("dentist_plus");
    const booked = await misCall("mis_upsert_appointment", {
      connection,
      appt: {
        external_id: "5501",
        patient: {
          external_id: "1042",
          full_name: "Ахметова Асель",
          phones: ["+77011112233"],
        },
        status: "scheduled",
        status_label: "Записан",
        starts_at: "2026-11-15T10:30:00+05:00",
        doctor: { external_id: "D1", name: "Иванов Иван" },
        service: "Имплантация",
      },
    });
    expect(booked.result).toBe("ok");
    await misCall("mis_upsert_payment", {
      connection,
      payment: {
        external_id: "PAY-1",
        amount: 15000,
        appointment_external_id: "5501",
      },
    });

    await page.goto(`/#/deals/${booked.deal_id}/show`);
    const deal = page.getByRole("main");
    await expect(deal.getByTestId("mis-badge")).toHaveText("MIS");
    const visits = deal.getByTestId("mis-visits");
    await expect(visits).toContainText("Visits from the MIS");
    await expect(visits).toContainText("Имплантация");
    // The visit moved the deal to «Записан» (the stage select of the header)
    await expect(
      deal.getByRole("combobox", { name: "Stage" }).locator("option:checked"),
    ).toHaveText("Записан");

    // The visit took place: the deal moves by the mapping
    await misCall("mis_visit_completed", {
      connection,
      visit: { appointment_external_id: "5501" },
    });
    await page.reload();
    await expect(
      page
        .getByRole("main")
        .getByRole("combobox", { name: "Stage" })
        .locator("option:checked"),
    ).toHaveText("Пришёл на консультацию");

    // The sync log of the settings
    await page.goto("/#/settings?section=mis");
    const log = page.getByTestId("mis-sync-log");
    await expect(log).toContainText("Booking");
    await expect(log).toContainText("Payment");
    await expect(log).toContainText("Visit");
  });

  test("the MIS section keeps the planned systems as requests", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/settings?section=mis");
    await page.getByRole("button", { name: "Leave a request: IDENT" }).click();
    await expect(page.getByText("Request sent").first()).toBeVisible();
  });

  test("Sipuni is a telephony provider and its missed call opens a task", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto("/#/settings?section=telephony");
    await page.getByRole("radio", { name: "Sipuni" }).click();
    await expect(
      page.getByText("Sipuni does not sign its events").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Telephony connected: Sipuni")).toBeVisible();
    await expect(page.getByLabel("Address for the PBX")).toHaveValue(
      /provider=sipuni&token=/,
    );

    const { data: status } = await adminSupabase
      .from("telephony_integrations")
      .select("webhook_token")
      .single();
    const { data, error } = await adminSupabase.rpc("ingest_call", {
      webhook_token: status!.webhook_token,
      provider: "sipuni",
      call: {
        call_id: "1760003400.2081",
        direction: "in",
        phone: "77015550001",
        status: "missed",
      },
    });
    expect(error).toBeNull();
    await page.goto(`/#/deals/${data.deal_id}/show`);
    await expect(page.getByRole("main").getByLabel("Next steps")).toContainText(
      "Перезвонить",
    );
  });
});
