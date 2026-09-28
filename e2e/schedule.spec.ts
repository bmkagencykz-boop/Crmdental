import { createClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";

// Doctors and chairs are settings: written as the service role
const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// The schedule shows the clinic's wall clock (Asia/Almaty for a new clinic)
const CLINIC_TIME_ZONE = "Asia/Almaty";

/** YYYY-MM-DD of the clinic, some days from today */
const clinicDay = (days: number) => {
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
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return date.toISOString().slice(0, 10);
};

test.describe("schedule", () => {
  let dealId: number;
  let doctorId: number;
  let salesId: number;

  test.beforeEach(
    async ({ createSales, createPatient, createDeal, disableTaskRules }) => {
      const sales = await createSales({
        first_name: "Aigerim",
        last_name: "Saparova",
        email: "owner@smile.kz",
        password: "password",
      });
      await disableTaskRules();
      salesId = sales.id;
      const { data: owner } = await adminSupabase
        .from("sales")
        .select("organization_id")
        .eq("id", sales.id)
        .single();
      const organization_id = owner!.organization_id;
      const { data: doctor, error } = await adminSupabase
        .from("doctors")
        .insert({ organization_id, name: "Ivanov Ivan", specialty: "Surgeon" })
        .select("id")
        .single();
      if (error) throw new Error(`Failed to add a doctor: ${error.message}`);
      doctorId = doctor.id;
      await adminSupabase
        .from("chairs")
        .insert({ organization_id, name: "Chair 1", position: 0 });
      const patient = await createPatient({
        first_name: "Daulet",
        last_name: "Akhmetov",
        phone: "+77015551234",
        sales_id: sales.id,
      });
      const deal = await createDeal({
        patient_id: patient.id,
        sales_id: sales.id,
        name: "Implants",
        stage: "В работе",
      });
      dealId = deal.id;
    },
  );

  test("book a visit from the deal, see it in the grid, move it and mark the arrival", async ({
    page,
    login,
  }) => {
    const day = clinicDay(3);
    await login("owner@smile.kz");

    // The deal page: «Записи» → «Записать» opens the dialog prefilled
    await page.goto(`/#/deals/${dealId}/show`);
    const visits = page.getByTestId("deal-visits");
    await expect(visits).toContainText("No visits yet");
    await visits.getByRole("button", { name: "Book" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("New visit").first()).toBeVisible();
    await expect(dialog).toContainText("Akhmetov Daulet");
    await dialog.getByRole("combobox", { name: "Doctor" }).click();
    await page.getByRole("option", { name: "Ivanov Ivan" }).click();
    await dialog.getByRole("combobox", { name: "Chair" }).click();
    await page.getByRole("option", { name: "Chair 1" }).click();
    await dialog.getByLabel("Date").fill(day);
    await dialog.getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "10:00", exact: true }).click();
    // The doctor works the clinic hours: free times are offered
    await expect(dialog).toContainText("The doctor works 09:00–21:00");
    await dialog.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByText("Visit booked")).toBeVisible();

    // The deal shows the visit and moved to «Записан»
    await expect(visits.getByTestId("visit-row")).toHaveCount(1);
    await expect(visits.getByTestId("visit-row").first()).toHaveAttribute(
      "data-status",
      "scheduled",
    );
    await expect(
      page
        .getByRole("main")
        .getByRole("combobox", { name: "Stage" })
        .locator("option:checked"),
    ).toHaveText("Записан");

    // The grid of that day, a column per doctor
    await page.goto(`/#/schedule?day=${day}`);
    await expect(page.getByTestId("schedule-grid")).toBeVisible();
    const block = page
      .getByTestId("visit-block")
      .filter({ hasText: "Akhmetov Daulet" });
    await expect(block).toContainText("10:00");
    // Pointing at it shows the patient's phone and the doctor
    await block.hover();
    const hover = page.getByTestId("visit-hover");
    await expect(hover).toContainText("+77015551234");
    await expect(hover).toContainText("Ivanov Ivan");

    // Drag it to 11:00 of the same doctor
    await block.dragTo(
      page.locator(`[data-column="${doctorId}"] [data-slot="11:00"]`),
    );
    await expect(page.getByText(/Visit moved/).first()).toBeVisible();
    await expect(block).toContainText("11:00");

    // The popover: «Пришёл»
    await block.click();
    const details = page.getByTestId("visit-details");
    await expect(details).toContainText("Ivanov Ivan");
    await details.getByRole("button", { name: "Arrived" }).click();
    await expect(page.getByText("Status: Arrived").first()).toBeVisible();
    await expect(block).toHaveAttribute("data-status", "arrived");

    // The deal moved on
    await details.getByRole("link", { name: "Open the deal" }).click();
    await expect(
      page
        .getByRole("main")
        .getByRole("combobox", { name: "Stage" })
        .locator("option:checked"),
    ).toHaveText("Пришёл на консультацию");
    await expect(
      page.getByTestId("deal-visits").getByTestId("visit-row").first(),
    ).toHaveAttribute("data-status", "arrived");
  });

  test("a click on an empty slot books a visit, the busy doctor is refused", async ({
    page,
    login,
    createPatient,
  }) => {
    const day = clinicDay(4);
    await createPatient({
      first_name: "Aruzhan",
      last_name: "Serikova",
      phone: "+77017770000",
      sales_id: salesId,
    });
    await login("owner@smile.kz");
    await page.goto(`/#/schedule?day=${day}`);
    await page
      .locator(`[data-column="${doctorId}"] [data-slot="12:00"]`)
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("New visit").first()).toBeVisible();
    await dialog.getByRole("combobox", { name: "Patient" }).click();
    await page.getByPlaceholder("Search...").fill("Serikova");
    await page.getByRole("option", { name: /Serikova Aruzhan/ }).click();
    // A patient without an open deal gets a new one
    await expect(dialog.getByRole("combobox", { name: "Deal" })).toContainText(
      "New deal",
    );
    await dialog.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByText("Visit booked")).toBeVisible();
    await expect(
      page.getByTestId("visit-block").filter({ hasText: "Serikova" }),
    ).toContainText("12:00");

    // The same doctor at the same time: the dialog warns
    await page
      .locator(`[data-column="${doctorId}"] [data-slot="14:00"]`)
      .click();
    const next = page.getByRole("dialog");
    await next.getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "12:15", exact: true }).click();
    await expect(
      next.getByText("The doctor is busy at that time"),
    ).toBeVisible();
  });
});
