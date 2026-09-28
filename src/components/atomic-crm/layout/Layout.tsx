import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useLocaleState, useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { UserMenu } from "@/components/admin/user-menu";
import { Skeleton } from "@/components/ui/skeleton";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { SIDEBAR_WIDTH, useNavItems } from "./navigation";
import { ScheduleGlyph } from "./navGlyphs";
import { ChangelogMenuItem, ProfileMenu, Sidebar } from "./Sidebar";
import { NotificationBell } from "../notifications/NotificationBell";
import { OnboardingMenuItem } from "../onboarding/OnboardingCard";
import { IntegratorBanner } from "../integrations/IntegratorBanner";
import { GlobalSearch, useRecentTracker } from "../search/GlobalSearch";
import { GlobalShortcuts, ShortcutsButton } from "../search/Shortcuts";
import { BranchSwitcher } from "../branches/BranchSwitcher";

export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  useRecentTracker();
  return (
    <>
      {/* One top bar across the page: logo, search, date, bell, user */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-20 items-center gap-6 bg-background pr-8">
        <Link
          to="/"
          className="flex shrink-0 flex-col items-center justify-center text-[13px] leading-[1.05] font-extrabold tracking-[0.08em] text-foreground uppercase no-underline"
          style={{ width: SIDEBAR_WIDTH }}
          aria-label="Dental CRM"
        >
          <span>Dental</span>
          <span className="text-primary">CRM</span>
        </Link>
        <div className="flex min-w-0 flex-1">
          <GlobalSearch />
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Branches (stage 33): only for a clinic with 2+ branches */}
          <BranchSwitcher />
          <TodayPill />
          <ShortcutsButton />
          <NotificationBell />
          <UserMenu>
            <ProfileMenu />
            <OnboardingMenuItem />
            <ChangelogMenuItem />
          </UserMenu>
        </div>
      </header>
      <Sidebar />
      <div
        className="min-h-screen pt-20"
        style={{ paddingLeft: SIDEBAR_WIDTH }}
      >
        <main className="pt-3 pr-8 pb-12" id="main-content">
          <PageTitle />
          <IntegratorBanner />
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
      <GlobalShortcuts />
    </>
  );
};

/** «28 сентября» with a calendar: today, opens the schedule */
const TodayPill = () => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const label = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <Link
      to="/schedule"
      className="flex h-11 items-center gap-2 rounded-full border-2 border-foreground/85 pr-1 pl-4 text-sm font-semibold text-foreground no-underline transition-colors hover:border-primary"
      title={translate("schedule.nav")}
    >
      {label}
      <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-background">
        <ScheduleGlyph className="size-4" />
      </span>
    </Link>
  );
};

/**
 * Section title of every page ("Сделки", "Пациенты"...) in the top bar,
 * derived from the current route so that pages don't have to repeat it.
 * Compact since stage 31: it used to take a 44px line above every page.
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
    { match: "/audit", label: translate("audit.title") },
    { match: "/mailings", label: translate("mailings.title") },
    { match: "/integrations", label: translate("market.title") },
    { match: "/search", label: translate("search.page.title") },
  ];
  const current = [...items, ...extra].find(
    (item) => matchPath(item.match, location.pathname) != null,
  );
  if (!current) return null;
  return (
    <h1 className="mb-5 truncate text-[28px] leading-tight font-semibold tracking-[-0.01em] text-foreground">
      {current.label}
    </h1>
  );
};
