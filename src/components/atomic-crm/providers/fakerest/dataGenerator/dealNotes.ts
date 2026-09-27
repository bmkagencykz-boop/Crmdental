import { random } from "faker/locale/en_US";

import type { Db } from "./types";
import { noteTexts } from "./kz";
import { randomDate } from "./utils";

export const generateDealNotes = (db: Db) => {
  return Array.from(Array(300).keys()).map((id) => {
    const deal = random.arrayElement(db.deals);
    return {
      id,
      deal_id: deal.id,
      text: random.arrayElement(noteTexts),
      date: randomDate(
        new Date(db.deals[deal.id as number].created_at),
      ).toISOString(),
      sales_id: deal.sales_id,
    };
  });
};
