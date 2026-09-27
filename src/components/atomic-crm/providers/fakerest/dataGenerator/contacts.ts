import { random } from "faker/locale/en_US";

import { defaultNoteStatuses } from "../../../root/defaultConfiguration";
import { contactGender } from "../../../contacts/contactModel";
import type { Company, Contact } from "../../../types";
import type { Db } from "./types";
import { kzEmail, kzPerson, kzPhone, noteTexts } from "./kz";
import { randomDate, weightedBoolean } from "./utils";

const maxContacts = {
  1: 1,
  10: 4,
  50: 12,
  250: 25,
  500: 50,
};

const getRandomContactDetailsType = () =>
  random.arrayElement(["Work", "Home", "Other"]) as "Work" | "Home" | "Other";

export const generateContacts = (db: Db, size = 500): Required<Contact>[] => {
  return Array.from(Array(size).keys()).map((id) => {
    const { first_name, last_name, gender } = kzPerson(
      random.arrayElement(contactGender).value,
    );
    const email_jsonb = [
      {
        email: kzEmail(first_name, last_name),
        type: getRandomContactDetailsType(),
      },
    ];
    const phone_jsonb = [
      {
        number: kzPhone(),
        type: getRandomContactDetailsType(),
      },
    ];
    // No photos in the demo: initials avatars only
    const avatar = { src: undefined };
    // choose company with people left to know
    let company: Company;
    do {
      company = random.arrayElement(db.companies);
    } while ((company.nb_contacts ?? 0) >= maxContacts[company.size]);
    company.nb_contacts = (company.nb_contacts ?? 0) + 1;

    const first_seen = randomDate(new Date(company.created_at)).toISOString();
    const last_seen = first_seen;

    return {
      id,
      first_name,
      last_name,
      gender,
      title: "",
      company_id: company.id,
      company_name: company.name,
      email_jsonb,
      phone_jsonb,
      background: random.arrayElement(noteTexts),
      acquisition: random.arrayElement(["inbound", "outbound"]),
      avatar,
      first_seen: first_seen,
      last_seen: last_seen,
      has_newsletter: weightedBoolean(30),
      status: random.arrayElement(defaultNoteStatuses).value,
      tags: random
        .arrayElements(db.tags, random.arrayElement([0, 0, 0, 1, 1, 2]))
        .map((tag) => tag.id), // finalize
      sales_id: company.sales_id!,
      nb_tasks: 0,
      linkedin_url: null,
    };
  });
};
