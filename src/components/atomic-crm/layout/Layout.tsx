import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { UserMenu } from "@/components/admin/user-menu";
import { Skeleton } from "@/components/ui/skeleton";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { SIDEBAR_WIDTH, useNavItems } from "./navigation";
import { ChangelogMenuItem, ProfileMenu, Sidebar } from "./Sidebar";

export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  return (
    <>
      <Sidebar />
      <div className="min-h-screen" style={{ paddingLeft: SIDEBAR_WIDTH }}>
        <div className="flex h-[5.25rem] items-center justify-between pr-8 pl-2">
          <Link
            to="/"
            className="text-[1.35rem] tracking-[-0.02em] text-foreground no-underline"
          >
            <span className="font-bold tracking-[-0.03em]">dental</span>
            <span className="font-bold text-brand-pink">crm</span>
          </Link>
          <UserMenu>
            <ProfileMenu />
            <ChangelogMenuItem />
          </UserMenu>
        </div>
        <main className="px-8 pt-2 pb-12" id="main-content">
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
    </>
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
    { match: "/reports", label: translate("reports.title") },
  ];
  // The deal page has its own header
  if (matchPath("/deals/:id/show", location.pathname)) return null;
  const current = [...items, ...extra].find(
    (item) => matchPath(item.match, location.pathname) != null,
  );
  if (!current) return null;
  return (
    <h1 className="mb-8 text-[2.75rem] font-medium leading-[1.05] tracking-[-0.04em] text-foreground">
      {current.label}
    </h1>
  );
};
