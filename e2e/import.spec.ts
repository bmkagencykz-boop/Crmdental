import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const adminSupabase = createClient(
  process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54341",
  process.env.SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// A clinic's own file: two patients with deals, one row with a bad phone
const csv = [
  "ФИО;Телефон;Услуга;Этап;Бюджет;Оплачено;Теги",
  "Нурланова Асель;8 701 111 22 33;Имплантация;Записан;450 000;150000;VIP",
  "Ахметов Ерлан;+7 (702) 222-33-44;Ортодонтия;Новый лид;900000;;",
  "Садыкова Дана;123;Гигиена;Новый лид;25000;;",
].join("\n");

const uploadFile = async (page: Page) => {
  await page.getByLabel("File to import").setInputFiles({
    name: "clinic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });
  await expect(page.getByText("clinic.csv")).toBeVisible();
};

const stat = (page: Page, label: string) =>
  page.locator("dl > div").filter({ hasText: label }).locator("dd");

test.describe("import", () => {
  test.beforeEach(async ({ createSales }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
  });

  test("imports patients and deals from a CSV file once", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Data import" }).click();

    await uploadFile(page);
    // Columns are recognised from their Russian names
    await expect(
      page.getByRole("combobox", { name: "Field in the CRM: Телефон" }),
    ).toContainText("Phone");
    await expect(page.getByLabel("Patients and deals")).toBeChecked();
    await page.getByRole("button", { name: "Next" }).click();

    // The bad phone is shown and the row will be skipped
    await expect(page.getByText("Invalid phone «123»")).toBeVisible();
    await expect(page.getByText("2 rows ready to import")).toBeVisible();
    await page.getByRole("button", { name: "Import", exact: true }).click();

    await expect(page.getByText("Import finished")).toBeVisible();
    await expect(stat(page, "Created")).toHaveText("2");
    await expect(stat(page, "Not imported")).toHaveText("1");
    await expect(
      page.getByRole("button", { name: "Download rows with errors" }),
    ).toBeVisible();

    // Imported deals fire no task rules
    const { count: tasks } = await adminSupabase
      .from("tasks")
      .select("id", { count: "exact", head: true });
    expect(tasks).toBe(0);
    const { data: deal } = await adminSupabase
      .from("deals")
      .select("plan_amount, paid_amount, sales_id")
      .eq("name", "Имплантация")
      .single();
    expect(deal).toEqual({
      plan_amount: 450000,
      paid_amount: 150000,
      sales_id: null,
    });

    // The same file again: nothing new
    await page.getByRole("button", { name: "Import another file" }).click();
    await uploadFile(page);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Import finished")).toBeVisible();
    await expect(stat(page, "Created")).toHaveText("0");
    await expect(stat(page, "Already in the CRM")).toHaveText("2");

    const { count: patients } = await adminSupabase
      .from("patients")
      .select("id", { count: "exact", head: true });
    expect(patients).toBe(2);
  });

  test("the patients list opens the import wizard", async ({ page, login }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Patients", exact: true }).click();
    await page.getByRole("link", { name: "Import" }).click();
    await expect(page.getByLabel("File to import")).toBeAttached();
    await expect(
      page.getByRole("button", { name: "Download a sample" }),
    ).toBeVisible();
  });

  test("the MIS section lists the planned connectors", async ({
    page,
    login,
  }) => {
    await login("owner@smile.kz");
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "MIS integration" }).click();
    await expect(page.getByText("IDENT")).toBeVisible();
    await page.getByRole("button", { name: "Leave a request: IDENT" }).click();
    await expect(page.getByText("Request sent").first()).toBeVisible();
  });
});
