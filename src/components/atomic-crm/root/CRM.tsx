import { InboxPage } from "../messages/InboxPage";
import { TasksPage } from "../tasks/TasksPage";
import { SchedulePage } from "../schedule/SchedulePage";
import type {
  CoreAdminProps,
  AuthProvider,
  DashboardComponent,
  LayoutComponent,
} from "ra-core";
import { CustomRoutes, localStorageStore, Resource } from "ra-core";
import { useEffect, useMemo } from "react";
import { Route } from "react-router";
import { Admin } from "@/components/admin/admin";
import { ForgotPasswordPage } from "@/components/supabase/forgot-password-page";
import { SetPasswordPage } from "@/components/supabase/set-password-page";
import { OAuthConsentPage } from "@/components/supabase/oauth-consent-page";

import patients from "../patients";
import { Dashboard } from "../dashboard/Dashboard";
import deals from "../deals";
import { Layout } from "../layout/Layout";
import { SignupPage } from "../login/SignupPage";
import { ConfirmationRequired } from "../login/ConfirmationRequired";
import {
  getAuthProvider as defaultAuthProviderBuilder,
  getDataProvider as defaultDataProviderBuilder,
} from "../providers/supabase";
import sales from "../sales";
import { ProfilePage } from "../settings/ProfilePage";
import { OnboardingPage } from "../onboarding/OnboardingPage";
import {
  CONFIGURATION_STORE_KEY,
  type ConfigurationContextValue,
} from "./ConfigurationContext";
import type { CrmDataProvider } from "../providers/types";
import {
  defaultCurrency,
  defaultDarkModeLogo,
  defaultLightModeLogo,
  defaultNoteStatuses,
  defaultTitle,
} from "./defaultConfiguration";
import { i18nProvider as defaulti18nProvider } from "../providers/commons/i18nProvider";
import { StartPage } from "../login/StartPage.tsx";
import { SearchPage } from "../search/SearchPage";

import {
  LazyApiDocsPage,
  LazyAuditPage,
  LazyCashDeskPage,
  LazyChangelogPage,
  LazyImportPage,
  LazyIntegrationsPage,
  LazyLabPage,
  LazyMailingsPage,
  LazyPayrollEmployeePage,
  LazyPayrollPage,
  LazyPayrollSchemesPage,
  LazyPlanPage,
  LazyPriceListPage,
  LazyReportsPage,
  LazySalesbotEditorPage,
  LazySettingsPage,
  LazyWaitingListPage,
} from "./lazyPages";

const defaultStore = localStorageStore(undefined, "CRM");

export type CRMProps = {
  dataProvider?: CrmDataProvider;
  authProvider?: AuthProvider;
  i18nProvider?: CoreAdminProps["i18nProvider"];
  store?: CoreAdminProps["store"];
  dashboard?: DashboardComponent;
  layout?: LayoutComponent;
} & Partial<ConfigurationContextValue>;

/**
 * CRM Component
 *
 * This component sets up and renders the main CRM application using `ra-core`. It provides
 * default configurations and themes but allows for customization through props. The component
 * seeds the store with any custom prop values for backwards compatibility.
 *
 * @param {string} currency - The ISO 4217 currency code used to format monetary values (e.g. "USD", "EUR", "GBP").
 * @param {RaThemeOptions} darkTheme - The theme to use when the application is in dark mode.
 * @param {RaThemeOptions} lightTheme - The theme to use when the application is in light mode.
 * @param {string} darkModeLogo - Logo shown in dark mode and on the auth pages. Must be an imported asset, an absolute URL, or a data URI — never a route-relative path like "./logos/x.svg", which breaks on nested routes such as /oauth/consent (issue #291).
 * @param {string} lightModeLogo - Logo shown in light mode. Same rule as darkModeLogo: imported asset, absolute URL, or data URI only.
 * @param {NoteStatus[]} noteStatuses - The statuses of notes used in the application.
 * @param {string} title - The title of the CRM application.
 *
 * @returns {JSX.Element} The rendered CRM application.
 *
 * @example
 * // Basic usage of the CRM component
 * import { CRM } from '@/components/atomic-crm/dashboard/CRM';
 *
 * const App = () => (
 *     <CRM
 *         darkModeLogo="https://example.com/logo-dark.svg"
 *         lightModeLogo="https://example.com/logo-light.svg"
 *         title="My Custom CRM"
 *         lightTheme={{
 *             ...defaultTheme,
 *             palette: {
 *                 primary: { main: '#0000ff' },
 *             },
 *         }}
 *     />
 * );
 *
 * export default App;
 */
export const CRM = ({
  currency = defaultCurrency,
  darkModeLogo = defaultDarkModeLogo,
  lightModeLogo = defaultLightModeLogo,
  noteStatuses = defaultNoteStatuses,
  title = defaultTitle,
  dataProvider = defaultDataProviderBuilder(),
  authProvider = defaultAuthProviderBuilder(),
  i18nProvider = defaulti18nProvider,
  store = defaultStore,
  ...rest
}: CRMProps) => {
  // Seed the store with CRM prop values if not already stored
  // (backwards compatibility for prop-based config)
  useEffect(() => {
    if (!store.getItem(CONFIGURATION_STORE_KEY)) {
      store.setItem(CONFIGURATION_STORE_KEY, {
        currency,
        noteStatuses,
        title,
        darkModeLogo,
        lightModeLogo,
      } satisfies ConfigurationContextValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // on login, pre-fetch the configuration to avoid a flickering
  // when accessing the app for the first time
  const wrappedAuthProvider = useMemo<AuthProvider>(
    () => ({
      ...authProvider,
      login: async (params: any) => {
        const result = await authProvider.login(params);
        try {
          const config = await dataProvider.getConfiguration();
          if (Object.keys(config).length > 0) {
            store.setItem(CONFIGURATION_STORE_KEY, config);
          }
        } catch {
          // Non-critical: config will load via useConfigurationLoader
        }
        return result;
      },
      handleCallback: async (params: any) => {
        if (!authProvider.handleCallback) {
          throw new Error(
            "handleCallback is not implemented in the authProvider",
          );
        }
        const result = await authProvider.handleCallback(params);
        try {
          const config = await dataProvider.getConfiguration();
          if (Object.keys(config).length > 0) {
            store.setItem(CONFIGURATION_STORE_KEY, config);
          }
        } catch {
          // Non-critical: config will load via useConfigurationLoader
        }
        return result;
      },
      logout: async (params: any) => {
        try {
          store.removeItem(CONFIGURATION_STORE_KEY);
        } catch {
          // Ignore
        }
        return authProvider.logout(params);
      },
    }),
    [authProvider, dataProvider, store],
  );

  return (
    <DesktopAdmin
      dataProvider={dataProvider}
      authProvider={wrappedAuthProvider}
      i18nProvider={i18nProvider}
      store={store}
      loginPage={StartPage}
      requireAuth
      disableTelemetry
      {...rest}
    />
  );
};

const DesktopAdmin = (
  props: CoreAdminProps & {
    dashboard?: DashboardComponent;
    layout?: LayoutComponent;
  },
) => {
  return (
    <Admin
      layout={props.layout ?? Layout}
      dashboard={props.dashboard ?? Dashboard}
      {...props}
    >
      <CustomRoutes noLayout>
        <Route path={SignupPage.path} element={<SignupPage />} />
        <Route
          path={ConfirmationRequired.path}
          element={<ConfirmationRequired />}
        />
        <Route path={SetPasswordPage.path} element={<SetPasswordPage />} />
        <Route
          path={ForgotPasswordPage.path}
          element={<ForgotPasswordPage />}
        />
        <Route path={OAuthConsentPage.path} element={<OAuthConsentPage />} />
        <Route path={OnboardingPage.path} element={<OnboardingPage />} />
      </CustomRoutes>

      <CustomRoutes>
        <Route path={ProfilePage.path} element={<ProfilePage />} />
        <Route path="/settings" element={<LazySettingsPage />} />
        <Route path="/changelog" element={<LazyChangelogPage />} />
        <Route path={TasksPage.path} element={<TasksPage />} />
        <Route path={SchedulePage.path} element={<SchedulePage />} />
        <Route path="/waiting-list" element={<LazyWaitingListPage />} />
        <Route path={InboxPage.path} element={<InboxPage />} />
        <Route path="/reports" element={<LazyReportsPage />} />
        <Route path="/price-list" element={<LazyPriceListPage />} />
        <Route path="/cash" element={<LazyCashDeskPage />} />
        <Route path="/payroll" element={<LazyPayrollPage />} />
        <Route path="/payroll/schemes" element={<LazyPayrollSchemesPage />} />
        <Route path="/payroll/:key" element={<LazyPayrollEmployeePage />} />
        <Route path="/lab" element={<LazyLabPage />} />
        <Route path="/audit" element={<LazyAuditPage />} />
        <Route path="/import" element={<LazyImportPage />} />
        <Route path="/mailings" element={<LazyMailingsPage />} />
        <Route path="/api-docs" element={<LazyApiDocsPage />} />
        <Route path="/salesbots/:id" element={<LazySalesbotEditorPage />} />
        <Route path="/integrations" element={<LazyIntegrationsPage />} />
        <Route path={SearchPage.path} element={<SearchPage />} />
        <Route
          path="/patients/:patientId/plans/:planId"
          element={<LazyPlanPage />}
        />
      </CustomRoutes>
      <Resource name="deals" {...deals} />
      <Resource name="patients" {...patients} />
      <Resource name="patient_notes" />
      <Resource name="deal_notes" />
      <Resource name="deal_payments" />
      <Resource name="account_operations" />
      <Resource name="account_operations_summary" />
      <Resource name="patient_accounts" />
      <Resource name="treatment_plan_payments" />
      <Resource name="cash_shifts" />
      <Resource name="cash_expense_categories" />
      <Resource name="lab_payments" />
      <Resource name="lab_payments_summary" />
      <Resource name="deal_events" />
      <Resource name="tasks" />
      <Resource name="calls" />
      <Resource name="messages" />
      <Resource name="messenger_channels" />
      <Resource name="task_rules" />
      <Resource name="quick_replies" />
      <Resource name="stage_checklist_items" />
      <Resource name="deal_checklist_checks" />
      <Resource name="message_templates" />
      <Resource name="automessage_rules" />
      <Resource name="automessages" />
      <Resource name="pipelines" />
      <Resource name="stages" />
      <Resource name="services" />
      <Resource name="lead_sources" />
      <Resource name="ad_spend" />
      <Resource name="lost_reasons" />
      <Resource name="sales" {...sales} />
      <Resource name="tags" />
      <Resource name="recall_rules" />
      <Resource name="mailings" />
      <Resource name="mailings_summary" />
      <Resource name="stage_triggers" />
      <Resource name="stage_trigger_runs" />
      <Resource name="webhooks" />
      <Resource name="webhook_deliveries" />
      <Resource name="salesbots" />
      <Resource name="salesbot_sessions" />
      <Resource name="salesbot_logs" />
      <Resource name="developer_apps" />
    </Admin>
  );
};
