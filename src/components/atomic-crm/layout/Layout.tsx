import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { CanAccess, useGetList, useLocaleState, useTranslate } from "ra-core";
import { cn } from "@/lib/utils";
import { Link, matchPath, useLocation } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { UserMenu } from "@/components/admin/user-menu";
import { Skeleton } from "@/components/ui/skeleton";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import type { Sale } from "../types";
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
      {/* Top: the mark, the main sections as pills, the team, the user */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-24 items-center gap-5 bg-background pr-8">
        <Link
          to="/"
          className="flex shrink-0 items-center justify-center text-foreground no-underline"
          style={{ width: SIDEBAR_WIDTH }}
          aria-label="Dental CRM"
        >
          <BrandMark />
        </Link>
        <TopTabs />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <TeamStack />
          {/* Branches (stage 33): only for a clinic with 2+ branches */}
          <BranchSwitcher />
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
        className="min-h-screen pt-24"
        style={{ paddingLeft: SIDEBAR_WIDTH }}
      >
        <main className="pt-2 pr-8 pb-12" id="main-content">
          <div className="mb-7 flex flex-wrap items-end gap-x-8 gap-y-4">
            <PageTitle />
            <div className="ml-auto flex w-full max-w-md items-center gap-2">
              <GlobalSearch />
              <TodayPill />
            </div>
          </div>
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
      <div className="fixed right-6 bottom-6 z-30">
        <ShortcutsButton />
      </div>
    </>
  );
};

/** The mark of the app: four rounded bars, like the reference's «#» */
const BrandMark = () => (
  <svg viewBox="0 0 32 32" className="size-9" aria-hidden="true">
    <rect x="9" y="3" width="4.5" height="26" rx="2.25" fill="currentColor" />
    <rect
      x="18.5"
      y="3"
      width="4.5"
      height="26"
      rx="2.25"
      fill="currentColor"
    />
    <rect x="3" y="9" width="26" height="4.5" rx="2.25" fill="var(--neon)" />
    <rect
      x="3"
      y="18.5"
      width="26"
      height="4.5"
      rx="2.25"
      fill="currentColor"
    />
  </svg>
);

/** The main sections as pills; the current one is black */
const TopTabs = () => {
  const location = useLocation();
  const items = useNavItems();
  return (
    <nav className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      {items.map((item) => {
        const active = matchPath(item.match, location.pathname) != null;
        const Icon = item.icon;
        const tab = (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-medium no-underline transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "bg-card text-foreground hover:bg-pill",
            )}
          >
            <Icon className="size-[18px]" />
            {item.label}
            {item.badge ? (
              <span
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-neon px-1.5 text-[11px] font-bold text-neon-ink"
                data-testid="nav-badge"
                title={item.badgeLabel}
                aria-hidden
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            ) : null}
          </Link>
        );
        return item.resource ? (
          <CanAccess key={item.to} resource={item.resource} action="menu">
            {tab}
          </CanAccess>
        ) : (
          tab
        );
      })}
    </nav>
  );
};

/** The team as a stack of avatars with «+N», opens the users */
const TeamStack = () => {
  const translate = useTranslate();
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 50 },
    sort: { field: "first_name", order: "ASC" },
    filter: { "disabled@neq": true },
  });
  if (sales.length === 0) return null;
  const shown = sales.slice(0, 3);
  return (
    <Link
      to="/sales"
      className="flex items-center no-underline"
      title={translate("resources.sales.name", { smart_count: 2 })}
    >
      {shown.map((sale, index) => (
        <span
          key={sale.id}
          className="-ml-3 flex size-12 items-center justify-center overflow-hidden rounded-full border-[3px] border-background bg-card text-xs font-semibold text-foreground first:ml-0"
          style={{ zIndex: 10 - index }}
        >
          {sale.avatar?.src ? (
            <img
              src={sale.avatar.src}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            `${sale.first_name[0] ?? ""}${sale.last_name[0] ?? ""}`
          )}
        </span>
      ))}
      {sales.length > shown.length ? (
        <span className="-ml-3 flex size-12 items-center justify-center rounded-full border-[3px] border-background bg-primary text-sm font-semibold text-primary-foreground">
          +{sales.length - shown.length}
        </span>
      ) : null}
    </Link>
  );
};

/** «28 сентября» with a black calendar button: today, opens the schedule */
const TodayPill = () => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const label = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date());
  return (
    <Link
      to="/schedule"
      className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-card pr-1.5 pl-4 text-sm font-medium whitespace-nowrap text-foreground no-underline hover:bg-pill"
      title={translate("schedule.nav")}
    >
      {label}
      <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
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
    { match: "/price-list", label: translate("price_list.title") },
    { match: "/cash", label: translate("payments.title") },
    { match: "/lab", label: translate("lab.title") },
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
    <h1 className="truncate text-[52px] leading-[1.05] font-normal tracking-[-0.035em] text-foreground">
      {current.label}
    </h1>
  );
};
