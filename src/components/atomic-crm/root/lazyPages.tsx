import { lazy, Suspense, type ComponentType } from "react";

import { Loading } from "@/components/admin/loading";

/**
 * The pages a clinic opens now and then (МИС, reports, settings) load on
 * first visit, so the first screen of the app downloads less.
 */
const page = (load: () => Promise<ComponentType>) => {
  const Page = lazy(async () => ({ default: await load() }));
  const Lazy = () => (
    <Suspense fallback={<Loading />}>
      <Page />
    </Suspense>
  );
  return Lazy;
};

export const LazySettingsPage = page(
  async () => (await import("../settings/SettingsPage")).SettingsPage,
);
export const LazyChangelogPage = page(
  async () => (await import("../misc/ChangelogPage")).ChangelogPage,
);
export const LazyWaitingListPage = page(
  async () => (await import("../waiting-list/WaitingListPage")).WaitingListPage,
);
export const LazyReportsPage = page(
  async () => (await import("../reports/ReportsPage")).ReportsPage,
);
export const LazyPriceListPage = page(
  async () => (await import("../price-list/PriceListPage")).PriceListPage,
);
export const LazyCashDeskPage = page(
  async () => (await import("../payments/CashDeskPage")).CashDeskPage,
);
export const LazyPayrollPage = page(
  async () => (await import("../payroll/PayrollPage")).PayrollPage,
);
export const LazyPayrollSchemesPage = page(
  async () =>
    (await import("../payroll/PayrollSchemesPage")).PayrollSchemesPage,
);
export const LazyPayrollEmployeePage = page(
  async () =>
    (await import("../payroll/PayrollEmployeePage")).PayrollEmployeePage,
);
export const LazyLabPage = page(
  async () => (await import("../lab/LabPage")).LabPage,
);
export const LazyAuditPage = page(
  async () => (await import("../audit/AuditPage")).AuditPage,
);
export const LazyImportPage = page(
  async () => (await import("../import/ImportPage")).ImportPage,
);
export const LazyMailingsPage = page(
  async () => (await import("../mailings/MailingsPage")).MailingsPage,
);
export const LazyApiDocsPage = page(
  async () => (await import("../pipeline-automation/ApiDocsPage")).ApiDocsPage,
);
export const LazySalesbotEditorPage = page(
  async () =>
    (await import("../salesbot/SalesbotEditorPage")).SalesbotEditorPage,
);
export const LazyIntegrationsPage = page(
  async () =>
    (await import("../integrations/IntegrationsPage")).IntegrationsPage,
);
export const LazyPlanPage = page(
  async () => (await import("../treatment/PlanPage")).PlanPage,
);
