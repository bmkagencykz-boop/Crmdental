import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// Doctors and the cancelled visit of another patient: the service role
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const CLINIC_TIME_ZONE = "Asia/Almaty";

/** A moment of the clinic's wall clock, some days from today at hh:00 */
const clinicMoment = (days: number, hour: number) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CLINIC_TIME_ZONE,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, Number(part.value)]),
  );
  // Asia/Almaty is UTC+5
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days, hour - 5),
  );
};

test.describe("waiting list", () => {
  let dealId: number;
  let organizationId: number;
  let doctorId: number;
  let otherPatientId: number;

  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const sales = await createSales({
        first_name: "Aigerim",
        last_name: "Saparova",
        email: "owner@smile.kz",
        password: "password",
      });
      await disableTaskRules();
      const { data: owner } = await adminSupabase
        .from("sales")
        .select("organization_id")
        .eq("id", sales.id)
        .single();
      organizationId = owner!.organization_id;
      const { data: doctor, error } = await adminSupabase
        .from("doctors")
        .insert({
          organization_id: organizationId,
          name: "Ivanov Ivan",
          specialty: "Therapist",
        })
        .select("id")
        .single();
      if (error) throw new Error(`Failed to add a doctor: ${error.message}`);
      doctorId = doctor.id;
      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        phone: "+77015551234",
        sales_id: sales.id,
      });
      const deal = await createDeal({
        patient_id: patient.id,
        sales_id: sales.id,
        name: "Caries",
        stage: "В работе",
      });
      dealId = deal.id;
      const other = await createPatient({
        first_name: "Aruzhan",
        last_name: "Serikova",
        phone: "+77017770000",
        sales_id: sales.id,
      });
      otherPatientId = other.id;
    },
  );

  test("add from the deal, see the free slots, a freed slot, offer and book", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");

    // The deal page: «Лист ожидания» → «В лист ожидания»
    await page.goto(`/#/deals/${dealId}/show`);
    const block = page.getByTestId("deal-waiting-list");
    await expect(block).toContainText("The patient is not on the waiting list");
    await block.getByTestId("add-to-waiting-list").click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("New waiting list entry").first(),
    ).toBeVisible();
    await expect(dialog).toContainText("Akhmetov Daulet");
    await dialog.getByRole("combobox", { name: "Doctor" }).click();
    await page.getByRole("option", { name: "Ivanov Ivan" }).click();
    await dialog
      .getByTestId("waiting-priority")
      .getByRole("radio", { name: "Urgent" })
      .click();
    await dialog.getByTestId("waiting-entry-save").click();
    await expect(
      page.getByText("The patient is on the waiting list").first(),
    ).toBeVisible();
    await expect(block.getByTestId("deal-waiting-entry")).toHaveCount(1);
    await expect(block.getByTestId("deal-waiting-entry")).toContainText(
      "Waiting",
    );

    // The page: the entry in «Срочно» with the nearest free slots
    await page.goto("/#/waiting-list");
    await expect(page.getByTestId("waiting-list-page")).toBeVisible();
    await expect(page.getByTestId("waiting-count")).toHaveText("1");
    const entry = page
      .getByTestId("waiting-group-urgent")
      .getByTestId("waiting-entry")
      .filter({ hasText: "Akhmetov Daulet" });
    await expect(entry).toBeVisible();
    await expect(entry.getByTestId("waiting-slot").first()).toContainText(
      "Ivanov Ivan",
    );

    // Another patient's visit is cancelled: the slot lights up on the entry
    const starts = clinicMoment(2, 10);
    const { data: visit, error } = await adminSupabase
      .from("visits")
      .insert({
        organization_id: organizationId,
        patient_id: otherPatientId,
        doctor_id: doctorId,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 30 * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to book: ${error.message}`);
    await adminSupabase
      .from("visits")
      .update({ status: "cancelled" })
      .eq("id", visit.id);
    await page.reload();
    await expect(entry).toHaveAttribute("data-freed", "true");
    await expect(entry.getByTestId("waiting-freed-slot")).toContainText(
      "Freed",
    );

    // «Предложить время»: the text of the offer, marked without a message
    await entry
      .getByTestId("waiting-freed-slot")
      .getByRole("button", { name: "Offer the time" })
      .click();
    const offer = page.getByRole("dialog");
    await expect(offer.getByTestId("waiting-offer-text")).toHaveValue(
      /Hello, Daulet!/,
    );
    await offer.getByRole("button", { name: "Mark without a message" }).click();
    await expect(
      page.getByText("The time is marked as offered").first(),
    ).toBeVisible();
    await expect(entry.getByTestId("waiting-status")).toHaveText("Offered");

    // «Записать» the freed slot: the visit dialog, prefilled
    await entry
      .getByTestId("waiting-freed-slot")
      .getByRole("button", { name: "Book" })
      .click();
    const booking = page.getByRole("dialog");
    await expect(booking.getByText("New visit").first()).toBeVisible();
    await expect(booking).toContainText("Akhmetov Daulet");
    await booking.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByText("Visit booked").first()).toBeVisible();
    await expect(
      page.getByText("The patient is booked, the entry is closed").first(),
    ).toBeVisible();
    await expect(page.getByTestId("waiting-count")).toHaveText("0");

    // Closed entries are shown on demand
    await page.getByRole("button", { name: "Show closed" }).click();
    await expect(
      page
        .getByTestId("waiting-group-closed")
        .getByTestId("waiting-entry")
        .first(),
    ).toHaveAttribute("data-status", "booked");

    // The audit log names the entry
    await page.goto("/#/audit");
    await expect(page.getByText("Waiting list").first()).toBeVisible();
  });

  test("the patient card adds a patient to the waiting list", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.goto(`/#/patients/${otherPatientId}/show`);
    await page.getByTestId("add-to-waiting-list").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Serikova Aruzhan");
    await dialog
      .getByTestId("waiting-day_parts")
      .getByRole("checkbox", { name: /Evening/ })
      .click();
    await dialog.getByTestId("waiting-entry-save").click();
    await expect(
      page.getByText("The patient is on the waiting list").first(),
    ).toBeVisible();
    await page.goto("/#/schedule");
    await expect(page.getByTestId("schedule-waiting-list")).toHaveText(
      "Waiting list (1)",
    );
  });
});
