import { generateAutomessages } from "./automessages";
import { generateAuditLog } from "./audit";
import { generateClinic } from "./clinic";
import { generateDictionaries } from "./dictionaries";
import { generateNotifications } from "./notifications";
import { generateOnboarding } from "./onboarding";
import { generateMailings } from "./mailings";
import { generateListsPlans } from "./plans";
import { generateDoctors } from "./doctors";
import { generateDealFiles } from "./files";
import { generateCustomFields } from "./customFields";
import { generateDigitalPipeline } from "./digitalPipeline";
import { generateSales } from "./sales";
import { generateSalesbot } from "./salesbot";
import { generateTags } from "./tags";
import { generateUnsorted } from "./unsorted";
import { generateMisConnectors } from "./misConnectors";
import { generateMarketplace } from "./marketplace";
import type { Db } from "./types";

export default (): Db => {
  const db = {} as Db;
  db.sales = generateSales(db);
  db.tags = generateTags(db);
  generateDictionaries(db);
  generateDoctors(db);
  generateClinic(db);
  generateDealFiles(db);
  generateCustomFields(db);
  generateAutomessages(db);
  generateAuditLog(db);
  db.external_refs = [];
  db.integrations = [];
  generateNotifications(db);
  generateMailings(db);
  generateUnsorted(db);
  generateListsPlans(db);
  generateDigitalPipeline(db);
  generateMisConnectors(db);
  generateSalesbot(db);
  generateOnboarding(db);
  generateMarketplace(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  return db;
};
