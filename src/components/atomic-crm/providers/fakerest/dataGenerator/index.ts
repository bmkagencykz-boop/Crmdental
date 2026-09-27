import { generateAutomessages } from "./automessages";
import { generateAuditLog } from "./audit";
import { generateClinic } from "./clinic";
import { generateDictionaries } from "./dictionaries";
import { generateNotifications } from "./notifications";
import { generateSales } from "./sales";
import { generateTags } from "./tags";
import type { Db } from "./types";

export default (): Db => {
  const db = {} as Db;
  db.sales = generateSales(db);
  db.tags = generateTags(db);
  generateDictionaries(db);
  generateClinic(db);
  generateAutomessages(db);
  generateAuditLog(db);
  db.external_refs = [];
  db.integrations = [];
  generateNotifications(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  return db;
};
