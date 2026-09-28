import { expect, test } from "./fixtures";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The full patient card (stage 37): the IIN in the form fills the birth
 * date, the header shows it with «1В»; the dental chart (a tooth state
 * with a note and its history), a visit record with an ICD-10 code, the
 * questionnaire, a consent from a template, an X-ray in the gallery, and
 * the history of it all.
 */
test.describe("patient card", () => {
  test("IIN, chart, visit record, questionnaire, consent, X-ray, history", async ({
    page,
    login,
    createSales,
    createPatient,
    createDeal,
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
      last_name: "Нурланова",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Кариес",
    });
    await login("owner@smile.kz");

    // The IIN: a wrong one is refused, a valid one fills the birth date
    await page.goto(`/#/patients/${patient.id}`);
    const iin = page.getByLabel("IIN");
    await iin.fill("900515400124");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Wrong IIN check digit")).toBeVisible();
    await iin.fill("900515400123");
    await expect(page.getByTestId("iin-hint")).toContainText("15.05.1990");
    await page.getByLabel("Card number").fill("1024");
    await page.getByRole("button", { name: "Save" }).click();

    await page.goto(`/#/patients/${patient.id}/show`);
    const header = page.getByTestId("patient-header");
    await expect(header).toContainText("Нурланова Асель");
    await expect(header).toContainText("born 15.05.1990");
    await expect(page.getByTestId("patient-iin")).toContainText(
      "900515 400123",
    );
    await expect(page.getByTestId("patient-card-number")).toContainText("1024");
    // Never came: «1В» (New)
    await expect(page.getByTestId("first-visit")).toBeVisible();

    // The dental chart: tooth 36 — caries with a note
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Dental chart" }).click();
    await main.getByRole("button", { name: "Tooth 36", exact: true }).click();
    const panel = page.getByTestId("tooth-panel");
    await panel.getByRole("radio", { name: "Caries" }).click();
    await panel.getByLabel("Note").fill("глубокий");
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Tooth 36: saved").first()).toBeVisible();
    await expect(page.getByTestId("tooth-history")).toContainText("Caries");
    await expect(
      page.locator('[data-tooth="36"][data-marked="true"]'),
    ).toHaveCount(1);
    await panel.getByRole("radio", { name: "Filling" }).click();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByTestId("tooth-history").getByRole("listitem"),
    ).toHaveCount(2);

    // A visit record without a visit, with an ICD-10 code
    await main.getByRole("tab", { name: "Visits" }).click();
    await main.getByRole("button", { name: "Record without a visit" }).click();
    const record = page.getByTestId("visit-record-dialog");
    await record.getByLabel("Complaints").fill("Боль от холодного");
    await record
      .getByLabel("Code or name: K02.1, pulpitis")
      .fill("кариес дент");
    await record.getByRole("option", { name: /K02\.1/ }).click();
    await expect(record.getByTestId("record-codes")).toContainText("K02.1");
    await record.getByLabel("Treatment done").fill("Пломба");
    await record.getByRole("button", { name: "Save the record" }).click();
    await expect(page.getByText("Record saved").first()).toBeVisible();
    await expect(page.getByTestId("patient-visits-tab")).toContainText("K02.1");

    // The questionnaire: diabetes — yes, signed
    await main.getByRole("tab", { name: "Questionnaire" }).click();
    const questionnaire = page.getByTestId("patient-questionnaire");
    await questionnaire
      .getByRole("radiogroup", { name: "Diabetes" })
      .getByRole("radio", { name: "Yes" })
      .click();
    await questionnaire.getByLabel("Diabetes: Comment").fill("2 тип");
    await questionnaire
      .getByRole("button", { name: "Save the questionnaire" })
      .click();
    await expect(page.getByText("Questionnaire saved").first()).toBeVisible();

    // A consent from the clinic's template, signed today
    const consents = page.getByTestId("patient-consents");
    await consents
      .getByLabel("Consent template")
      .selectOption({ label: "Согласие на местную анестезию" });
    await expect(consents).toContainText("Я, Нурланова Асель");
    await consents.getByRole("button", { name: "Create" }).click();
    const row = consents.getByTestId("consent-row").first();
    await expect(row).toContainText("Not signed");
    await row.getByRole("button", { name: "Signed today" }).click();
    await expect(row).toContainText("Signed on");

    // An X-ray in the gallery, opened in the lightbox
    await main.getByRole("tab", { name: "Files and X-rays" }).click();
    const files = page.getByTestId("patient-files-tab");
    await files.getByLabel("Type").selectOption("periapical");
    await files.getByTestId("patient-file-input").setInputFiles({
      name: "36.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await expect(files.getByTestId("xray-thumb")).toHaveCount(1);
    await files.getByRole("button", { name: "Open: 36.png" }).click();
    await expect(page.getByTestId("xray-lightbox")).toContainText(
      "Periapical X-ray",
    );
    await page.keyboard.press("Escape");

    // The history of everything
    await main.getByRole("tab", { name: "History" }).click();
    const history = page.getByTestId("patient-history");
    await expect(history).toContainText("Tooth 36");
    await expect(history).toContainText("Visit record: K02.1");
    await expect(history).toContainText("Periapical X-ray: 36.png");

    // The medical changes are in the audit log
    await page.goto("/#/audit");
    await expect(page.getByRole("main")).toContainText("Tooth");
  });
});
