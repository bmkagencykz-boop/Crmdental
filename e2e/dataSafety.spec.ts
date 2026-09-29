import { expect, test } from "./fixtures";

/**
 * Data safety (stage 41): the owner archives one from the card — the patient leaves the list and
 * comes back with the «Archive» filter, then is restored; a patient created
 * by mistake (no history) is deleted for good by the owner. A manager
 * cannot archive by default.
 */
test.describe("data safety", () => {
  test("archive, restore and delete a patient", async ({
    page,
    login,
    createSales,
    createPatient,
    disableTaskRules,
  }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await disableTaskRules();
    const patient = await createPatient({
      first_name: "Асель",
      last_name: "Архивная",
      phone: "+77015550101",
      sales_id: owner.id,
    });
    const mistake = await createPatient({
      first_name: "Ошибка",
      last_name: "Лишний",
      phone: "+77015550102",
      sales_id: owner.id,
    });

    // The owner archives the patient
    await login("owner@smile.kz");
    await page.goto(`/#/patients/${patient.id}/show`);
    const actions = page.getByTestId("patient-archive");
    await actions.getByRole("button", { name: "Archive" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive" })
      .click();
    await expect(
      page.getByText("The patient is archived").first(),
    ).toBeVisible();
    await expect(page.getByTestId("patient-archived").first()).toBeVisible();

    // Out of the list, back with the «Archive» filter
    await page.goto("/#/patients");
    await expect(page.getByText("Лишний Ошибка").first()).toBeVisible();
    await expect(page.getByText("Архивная Асель")).toHaveCount(0);
    await page.getByTestId("patients-archive-filter").click();
    await expect(page.getByText("Архивная Асель").first()).toBeVisible();
    await expect(page.getByText("Лишний Ошибка")).toHaveCount(0);

    // Restored
    await page.getByText("Архивная Асель").first().click();
    await page
      .getByTestId("patient-archive")
      .getByRole("button", { name: "Restore from the archive" })
      .click();
    await expect(
      page.getByText("The patient is restored").first(),
    ).toBeVisible();
    await expect(page.getByTestId("patient-archived")).toHaveCount(0);

    // A patient without history is deleted for good by the owner
    await page.goto(`/#/patients/${mistake.id}/show`);
    await page
      .getByTestId("patient-archive")
      .getByRole("button", { name: "Delete for good" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete for good" })
      .click();
    await expect(
      page.getByText("The patient is deleted").first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/patients$/);
    await expect(page.getByText("Лишний Ошибка")).toHaveCount(0);
  });

  test("a manager cannot archive a patient by default", async ({
    page,
    login,
    createSales,
    createPatient,
  }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await createSales({
      first_name: "Dana",
      last_name: "Admin",
      email: "manager@smile.kz",
      password: "password",
      role: "manager",
    });
    const patient = await createPatient({
      first_name: "Асель",
      last_name: "Архивная",
      phone: "+77015550101",
      sales_id: owner.id,
    });
    await login("manager@smile.kz");
    await page.goto(`/#/patients/${patient.id}/show`);
    await expect(page.getByTestId("patient-header")).toContainText(
      "Архивная Асель",
    );
    await expect(page.getByTestId("patient-archive")).toHaveCount(0);
  });
});
