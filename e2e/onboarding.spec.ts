import { test, expect } from "./fixtures";

test("a clinic signs up and records its first request", async ({
  page,
  menu,
  dismissToast,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Dental CRM/);

  // Any visitor can register a new clinic from the login page
  await page.getByRole("link", { name: "Register a new clinic" }).click();
  await expect(page.getByText("Welcome to Dental CRM")).toBeVisible();

  await page.getByLabel("Clinic name").fill("Smile Clinic");
  await page.getByLabel("First name").fill("Aigerim");
  await page.getByLabel("Last name").fill("Saparova");
  await page.getByLabel("Email").fill("owner@smile.kz");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Create account" }).click();

  // A new clinic lands on the setup wizard (e2e/onboardingWizard.spec.ts)
  await expect(
    page.getByRole("heading", { name: "Setup wizard" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Set up later" }).click();

  await expect(page.getByText("Open deals")).toBeVisible();

  // The new clinic starts with the default pipeline
  await menu.goToDeals();
  await expect(page.getByText("Новый лид", { exact: true })).toBeVisible();
  await expect(page.getByText("Лечение завершено")).toBeVisible();

  await menu.goToPatients();
  await page.getByRole("link", { name: "New Patient" }).click();
  await page.getByLabel("Last name").fill("Akhmetov");
  await page.getByLabel("First name").fill("Daulet");
  await page
    .getByPlaceholder("+7 7__ ___ __ __")
    .first()
    .fill("8 701 555 12 34");
  await page.getByRole("button", { name: "Save" }).click();
  await dismissToast("Element created");

  await expect(
    page.getByRole("heading", { name: "Akhmetov Daulet" }),
  ).toBeVisible();
  await expect(page.getByText("+7 701 555 12 34").first()).toBeVisible();

  // A request (deal) is opened from the patient card
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByLabel("Title").fill("Implants");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("main")).toContainText("Akhmetov Daulet");
  await expect(page.getByRole("main")).toContainText("Новый лид");
  await expect(page.getByRole("main")).toContainText(
    "Deal created at stage «Новый лид»",
  );

  await menu.goToDashboard();
  await expect(
    page.getByText(/You\s+added patient\s+Akhmetov Daulet/),
  ).toBeVisible();
  await expect(page.getByText(/You\s+opened deal\s+Implants/)).toBeVisible();
});
