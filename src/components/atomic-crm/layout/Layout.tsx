import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useTranslate } from "ra-core";
import { matchPath, useLocation } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { Skeleton } from "@/components/ui/skeleton";

import { DataImportProvider } from "../dataImport/DataImportProvider";
import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { SIDEBAR_WIDTH, useNavItems } from "./navigation";
import { Sidebar } from "./Sidebar";

export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <DataImportProvider>
      <Sidebar />
      <div className="min-h-screen" style={{ paddingLeft: SIDEBAR_WIDTH }}>
        <main className="px-8 pt-7 pb-10" id="main-content">
          <PageTitle />
          <ErrorBoundary FallbackComponent={Error}>
            <Suspense
              fallback={<Skeleton className="h-12 w-12 rounded-full" />}
            >
              {children}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <Notification />
    </DataImportProvider>
  );
};

/**
 * Section title above every page ("Сделки", "Пациенты"...), derived from the
 * current route so that pages don't have to repeat it.
 */
const PageTitle = () => {
  const translate = useTranslate();
  const location = useLocation();
  const items = useNavItems();
  const extra = [
    {
      match: "/sales/*",
      label: translate("resources.sales.name", { smart_count: 2 }),
    },
    { match: "/settings", label: translate("crm.settings.title") },
    { match: "/profile", label: translate("crm.profile.title") },
  ];
  const current = [...items, ...extra].find(
    (item) => matchPath(item.match, location.pathname) != null,
  );
  if (!current) return null;
  return (
    <h1 className="mb-5 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-foreground">
      {current.label}
    </h1>
  );
};
