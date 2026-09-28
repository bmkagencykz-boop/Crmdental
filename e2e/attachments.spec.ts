import { expect, test } from "./fixtures";

// A 1×1 PNG and a tiny PDF, built here: nothing is fetched from outside
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Kids [] /Count 0>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF",
);

test.describe("attachments", () => {
  test("files of a deal: upload, preview, feed, patient card, delete", async ({
    page,
    login,
    createSales,
    createPatient,
    createDeal,
  }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Implants",
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    const main = page.getByRole("main");
    await main.getByRole("tab", { name: "Files" }).click();
    await expect(main.getByText("No files yet")).toBeVisible();

    // Two files picked at once
    await main
      .getByTestId("deal-files-dropzone")
      .locator('input[type="file"]')
      .setInputFiles([
        { name: "xray.png", mimeType: "image/png", buffer: PNG },
        { name: "План лечения.pdf", mimeType: "application/pdf", buffer: PDF },
      ]);
    const files = main.getByRole("list", { name: "Files" });
    await expect(files.getByRole("listitem")).toHaveCount(2);
    await expect(files).toContainText("xray.png");
    await expect(files).toContainText("План лечения.pdf");

    // An image opens in a lightbox
    await files.getByRole("button", { name: "Open: xray.png" }).click();
    const lightbox = page.getByRole("dialog");
    await expect(lightbox.getByRole("img", { name: "xray.png" })).toBeVisible();
    await expect(
      lightbox.getByRole("button", { name: "Download" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // The feed shows the uploads
    const feed = main.getByRole("list", { name: "Deal feed" });
    await expect(feed.getByText("File uploaded").first()).toBeVisible();
    await expect(feed).toContainText("План лечения.pdf");

    // Unsupported files are refused before the upload
    await main
      .getByTestId("deal-files-dropzone")
      .locator('input[type="file"]')
      .setInputFiles({
        name: "setup.exe",
        mimeType: "application/x-msdownload",
        buffer: Buffer.from("MZ"),
      });
    await expect(page.getByText(/This file cannot be uploaded/)).toBeVisible();
    await expect(files.getByRole("listitem")).toHaveCount(2);

    // The patient card lists the files of the patient's deals
    await page.goto(`/#/patients/${patient.id}/show?tab=files`);
    await expect(page.getByRole("main")).toContainText("План лечения.pdf");
    await expect(page.getByRole("main")).toContainText("Implants");

    // The owner deletes a file
    await page.goto(`/#/deals/${deal.id}/show`);
    await page.getByRole("main").getByRole("tab", { name: "Files" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("main")
      .getByRole("button", { name: "Delete: xray.png" })
      .click();
    await expect(page.getByText("File deleted").first()).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("list", { name: "Files" }),
    ).not.toContainText("xray.png");
  });

  test("a manager cannot delete a colleague's file", async ({
    page,
    login,
    createSales,
    createPatient,
    createDeal,
  }) => {
    const owner = await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    await createSales({
      first_name: "Madina",
      last_name: "Nurlanova",
      email: "manager@smile.kz",
      password: "password",
      role: "manager",
    });
    const patient = await createPatient({
      first_name: "Daulet",
      last_name: "Akhmetov",
      phone: "+77015551234",
      sales_id: owner.id,
    });
    const deal = await createDeal({
      patient_id: patient.id,
      sales_id: owner.id,
      name: "Implants",
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    await page.getByRole("main").getByRole("tab", { name: "Files" }).click();
    await page
      .getByRole("main")
      .getByTestId("deal-files-dropzone")
      .locator('input[type="file"]')
      .setInputFiles({
        name: "plan.pdf",
        mimeType: "application/pdf",
        buffer: PDF,
      });
    await expect(
      page.getByRole("main").getByRole("list", { name: "Files" }),
    ).toContainText("plan.pdf");

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login("manager@smile.kz");
    await page.goto(`/#/deals/${deal.id}/show`);
    await page.getByRole("main").getByRole("tab", { name: "Files" }).click();
    const files = page.getByRole("main").getByRole("list", { name: "Files" });
    await expect(files).toContainText("plan.pdf");
    await expect(
      files.getByRole("button", { name: "Download: plan.pdf" }),
    ).toBeVisible();
    await expect(
      files.getByRole("button", { name: "Delete: plan.pdf" }),
    ).toHaveCount(0);
  });

  test("received media shows in the chat, a file can be attached to a reply", async ({
    page,
    login,
    createSales,
    connectMessenger,
    receiveMessage,
  }) => {
    await createSales({
      first_name: "Aigerim",
      last_name: "Saparova",
      email: "owner@smile.kz",
      password: "password",
    });
    const token = await connectMessenger();
    const { deal_id } = await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77015551234",
      external_id: "wz-photo-1",
      direction: "in",
      text: null,
      content_type: "image",
      content_uri: "http://127.0.0.1:1/media/tooth.jpg",
      contact: { name: "Daulet" },
    });
    await receiveMessage(token, {
      channel_id: "wa-1",
      transport: "whatsapp",
      chat_id: "77015551234",
      external_id: "wz-voice-1",
      direction: "in",
      text: null,
      content_type: "audio",
      content_uri: "http://127.0.0.1:1/media/voice.ogg",
      contact: { name: "Daulet" },
    });

    await login("owner@smile.kz");
    await page.goto(`/#/deals/${deal_id}/show`);
    const feed = page
      .getByRole("main")
      .getByRole("list", { name: "Deal feed" });
    await expect(
      feed.getByRole("button", { name: "Open: tooth.jpg" }),
    ).toBeVisible();
    await expect(feed.locator('audio[aria-label="voice.ogg"]')).toHaveCount(1);

    // The paperclip attaches a file to the reply, which can be removed
    await page.getByTestId("message-file-input").setInputFiles({
      name: "plan.pdf",
      mimeType: "application/pdf",
      buffer: PDF,
    });
    await expect(page.getByPlaceholder("Caption (optional)")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("plan.pdf");
    await page.getByRole("button", { name: "Remove the file" }).click();
    await expect(page.getByPlaceholder("Caption (optional)")).toHaveCount(0);
  });
});
