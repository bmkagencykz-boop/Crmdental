import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Registers a new clinic through the sign-up form */
const signUp = async (page: Page, clinic: string, email: string) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Register a new clinic" }).click();
  await page.getByLabel("Clinic name").fill(clinic);
  await page.getByLabel("First name").fill("Aigerim");
  await page.getByLabel("Last name").fill("Saparova");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Create account" }).click();
};

const stepTitle = (page: Page, name: string) =>
  page.getByRole("heading", { level: 2, name, exact: true });

test("a new clinic is set up with the setup wizard", async ({ page }) => {
  await signUp(page, "Smile Clinic", "owner@smile.kz");

  // The owner lands on the wizard, at the first step
  await expect(
    page.getByRole("heading", { name: "Setup wizard" }),
  ).toBeVisible();
  await expect(stepTitle(page, "Clinic")).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Setup wizard" });
  await expect(steps).toContainText("0 of 7");

  // 1. Clinic: the name comes from the sign-up form
  await expect(page.getByLabel("Clinic name")).toHaveValue("Smile Clinic");
  await page.getByLabel("City").fill("Almaty");
  await page.getByLabel("Clinic phone").fill("8 727 355 00 00");
  await page.getByLabel("Address").fill("10 Abay Ave, 2nd floor");
  await page.getByRole("button", { name: "Next" }).click();
  // Saving the clinic creates its dictionaries: slower under load
  await expect(page.getByText("Clinic saved")).toBeVisible({ timeout: 15_000 });

  // 2. Services and prices: tick services, with a price each
  await expect(stepTitle(page, "Services and prices")).toBeVisible();
  // The default services of a new clinic are already ticked
  await expect(
    page.getByRole("checkbox", { name: "Имплантация" }),
  ).toBeChecked();
  await page.getByRole("checkbox", { name: "Консультация" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Консультация" }),
  ).toBeChecked();
  const consultationPrice = page.getByLabel("Price: Консультация", {
    exact: true,
  });
  await consultationPrice.fill("5000");
  await consultationPrice.press("Enter");
  await expect(
    page.getByLabel("Price: Консультация", { exact: true }),
  ).toHaveValue("5 000");
  await page.getByRole("checkbox", { name: "Виниры" }).click();
  await expect(page.getByRole("checkbox", { name: "Виниры" })).toBeChecked();
  const veneersPrice = page.getByLabel("Price: Виниры", { exact: true });
  await veneersPrice.fill("90000");
  await veneersPrice.press("Enter");
  await expect(page.getByLabel("Price: Виниры", { exact: true })).toHaveValue(
    "90 000",
  );
  await page.getByRole("button", { name: "Next" }).click();

  // 3. Doctors and 4. Team are skipped
  await expect(stepTitle(page, "Doctors")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(stepTitle(page, "Team")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  // 5. Pipeline: the default stages are kept, the reminder is on
  await expect(stepTitle(page, "Pipeline")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Stage name" }).first(),
  ).toHaveValue("Новый лид");
  await expect(
    page.getByRole("switch", {
      name: "Reminder to the patient a day before the visit",
    }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Next" }).click();

  // 6. Channels are skipped, each with its status
  await expect(stepTitle(page, "Channels")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "WhatsApp, Instagram, Telegram" }),
  ).toContainText("Not connected");
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  // 7. Import is skipped too
  await expect(stepTitle(page, "Import")).toBeVisible();
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  // 8. Done: the summary of the steps
  await expect(stepTitle(page, "Done")).toBeVisible();
  const summary = page.getByRole("list", { name: "Done" });
  await expect(summary.getByRole("listitem").first()).toContainText(
    "ClinicDone",
  );
  await expect(summary.getByRole("listitem").nth(2)).toContainText(
    "DoctorsSkipped",
  );
  await expect(steps).toContainText("7 of 7");
  await page.getByRole("button", { name: "Open the pipeline" }).click();

  // The pipeline opens; the clinic is set up, no more wizard
  await expect(page.getByText("Новый лид", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByText("Open deals")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Continue setup" }),
  ).toBeHidden();

  // The services got their prices (the price list page, stage 35)
  await page.goto("/#/price-list");
  await expect(
    page.getByLabel("Price: Консультация", { exact: true }),
  ).toHaveValue("5 000");
  await expect(page.getByLabel("Price: Виниры", { exact: true })).toHaveValue(
    "90 000",
  );

  // The quick replies got the address and the consultation price
  await page.goto("/#/settings?section=quick_replies");
  const texts = page.getByRole("textbox", { name: "Reply text" });
  await expect(texts.nth(1)).toHaveValue(
    /^Наш адрес: 10 Abay Ave, 2nd floor\. Рядом есть бесплатная парковка/,
  );
  await expect(texts.nth(2)).toHaveValue(/консультация врача стоит 5 000 ₸\./);
});

test("the setup put off shows on the dashboard", async ({ page }) => {
  await signUp(page, "Dent Plus", "owner@dentplus.kz");
  await expect(stepTitle(page, "Clinic")).toBeVisible();

  // «Настроить позже»: the dashboard, with a card to continue
  await page.getByRole("button", { name: "Set up later" }).click();
  await expect(page.getByText("Open deals")).toBeVisible();
  const card = page.getByRole("region", { name: "Continue setup" });
  await expect(card).toContainText("0 of 7 steps are set up");

  // The wizard no longer opens by itself
  await page.reload();
  await expect(page.getByText("Open deals")).toBeVisible();
  await expect(card).toBeVisible();

  // The card leads back to the wizard, where the owner left
  await card.getByRole("link", { name: "Continue setup" }).click();
  await expect(stepTitle(page, "Clinic")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(stepTitle(page, "Services and prices")).toBeVisible();
  await page.getByRole("button", { name: "Set up later" }).click();
  await expect(card).toContainText("1 of 7 steps are set up");

  // It is also in the user menu
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Setup wizard" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Hidden for good
  await card.getByRole("button", { name: "Hide" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByText("Open deals")).toBeVisible();
  await expect(card).toBeHidden();
});
