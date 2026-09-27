import { expect, test } from "./fixtures";

test("a quick reply is inserted with «/» and filled from the deal", async ({
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

  // The chat composer: "/адр" lists the address reply of the new clinic
  const input = main.getByRole("textbox", { name: "Write to the patient…" });
  await input.click();
  await input.pressSequentially("/адр");
  const list = main.getByRole("listbox", { name: "Quick replies" });
  await expect(list).toBeVisible();
  const option = list.getByRole("option", { name: /Адрес и парковка/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    (await option.getAttribute("id"))!,
  );

  // Enter inserts the reply in place of "/адр", the list closes
  await input.press("Enter");
  await expect(list).toBeHidden();
  await expect(input).toHaveValue(/^Наш адрес: \[укажите адрес клиники\]/);

  // The greeting, picked with the mouse, gets the patient's name
  await input.fill("");
  await input.pressSequentially("/привет");
  await list.getByRole("option", { name: /Приветствие/ }).click();
  await expect(input).toHaveValue(/^Здравствуйте, Daulet! Меня зовут Aigerim/);

  // The text stays editable before sending; Esc closes the list
  await input.press("End");
  await input.pressSequentially(" /");
  await expect(list).toBeVisible();
  await input.press("Escape");
  await expect(list).toBeHidden();
  await expect(input).toHaveValue(/Чем могу помочь\? \/$/);

  // The lightning button opens the list too
  await main.getByRole("button", { name: "Quick replies" }).click();
  await expect(list.getByRole("option")).toHaveCount(5);
});
