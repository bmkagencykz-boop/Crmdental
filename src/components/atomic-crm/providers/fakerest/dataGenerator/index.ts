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
import { generatePayroll } from "./payroll";
import { generateWaitingList } from "./waitingList";
import { generateLabOrders } from "./labOrders";
import { generateCashOutflows } from "./cashOutflows";
import { generateFinance } from "./finance";
import { generateDataSafety } from "./dataSafety";
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
  // Payroll (stage 39): after the plans, the visits and the payments
  generatePayroll(db);
  // The waiting list (stage 38): after the visits and the notifications
  generateWaitingList(db);
  // Lab work orders (stage 40): after the plans, the patient files and the
  // notifications
  generateLabOrders(db);
  // Expenses, the advance from the cash desk, lab payments (stage 42):
  // after the payments, the payroll and the lab orders
  generateCashOutflows(db);
  // Finance (stage 44): accounts, articles, a year of history, the models
  generateFinance(db);
  // Data safety (stage 41): card numbers, the archive — last
  generateDataSafety(db);
  db.configuration = [
    {
      id: 1,
      config: {} as Db["configuration"][number]["config"],
    },
  ];
  return db;
};
