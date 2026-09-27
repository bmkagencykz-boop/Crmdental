import { expect, test } from "./fixtures";

test("the deal page edits fields in place and moves the stage", async ({
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
  await expect(main.getByRole("heading", { name: "Implants" })).toBeVisible();
  await expect(main).toContainText("+77015551234");

  // A field is edited in place and saved
  await main.getByRole("button", { name: "Treatment plan: Edit" }).click();
  await main.getByLabel("Treatment plan").fill("450000");
  await main.getByLabel("Treatment plan").press("Enter");
  await expect(main).toContainText("450 000");
  await page.reload();
  await expect(page.getByRole("main")).toContainText("450 000");

  // The stage picker moves the deal and the feed shows it
  await page.getByRole("main").getByLabel("Stage").selectOption("В работе");
  await expect(
    page.getByRole("main").getByRole("list", { name: "Deal feed" }),
  ).toContainText("В работе");

  // A refusal asks for its reason
  await page.getByRole("main").getByLabel("Stage").selectOption("Отказ");
  await page.getByRole("dialog").getByText("Дорого").click();
  await page.getByRole("button", { name: "Close as lost" }).click();
  await expect(page.getByRole("main")).toContainText("Дорого");
});
