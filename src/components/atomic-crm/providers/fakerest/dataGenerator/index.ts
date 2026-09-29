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
import { generateSchedule } from "./schedule";
import { generateTreatmentPlans } from "./treatmentPlans";
import { generateMarketing } from "./marketing";
import { generateAccessRights } from "./accessRights";
import { generateBranches } from "./branches";
import { generatePriceList } from "./priceList";
import { generatePayments } from "./payments";
import { generatePatientCard } from "./patientCard";
import { generateLabOrders } from "./labOrders";
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
  generateAccessRights(db);
  generateSchedule(db);
  // UTM tags, a «Google» source and the ad spend (stage 32)
  generateMarketing(db);
  // Last: the price list is appended to the services the other data uses
  generateTreatmentPlans(db);
  // The price list page (stage 35): categories, units, cost prices, history
  generatePriceList(db);
  // Branches (stage 33): after the deals, the tasks and the visits
  generateBranches(db);
  // Payments, deposits and the cash desk (stage 36): after the branches
  generatePayments(db);
  // The full patient card (stage 37): after the plans and the visits
  generatePatientCard(db);
  // Lab work orders (stage 40): after the plans, the patient files and the
  // notifications
  generateLabOrders(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  return db;
};
