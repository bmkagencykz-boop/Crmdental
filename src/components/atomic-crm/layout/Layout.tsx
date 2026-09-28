import { Suspense, type ReactNode } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useTranslate } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { Notification } from "@/components/admin/notification";
import { Error } from "@/components/admin/error";
import { UserMenu } from "@/components/admin/user-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/components/admin/use-theme";
import { Moon, Sun } from "lucide-react";

import { useConfigurationLoader } from "../root/useConfigurationLoader";
import { SIDEBAR_WIDTH, useNavItems } from "./navigation";
import { ChangelogMenuItem, ProfileMenu, Sidebar } from "./Sidebar";
import { NotificationBell } from "../notifications/NotificationBell";
import { OnboardingMenuItem } from "../onboarding/OnboardingCard";
import { IntegratorBanner } from "../integrations/IntegratorBanner";
import { GlobalSearch, useRecentTracker } from "../search/GlobalSearch";
import { GlobalShortcuts, ShortcutsButton } from "../search/Shortcuts";

export const Layout = ({ children }: { children: ReactNode }) => {
  useConfigurationLoader();
  useRecentTracker();
  return (
    <>
      <Sidebar />
      <div className="min-h-screen" style={{ paddingLeft: SIDEBAR_WIDTH }}>
        {/* One compact bar: logo, section title, search, user (stage 31) */}
        <div className="flex h-[4.25rem] items-center gap-6 pr-8 pl-2">
          <Link
            to="/"
            className="shrink-0 text-[1.35rem] tracking-[-0.02em] text-foreground no-underline"
          >
            <span className="font-bold tracking-[-0.03em]">dental</span>
            <span className="font-bold text-brand-pink">crm</span>
          </Link>
          <div className="w-44 shrink-0 truncate">
            <PageTitle />
          </div>
          <div className="flex min-w-0 flex-1 justify-center">
            <GlobalSearch />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShortcutsButton />
            <NotificationBell />
            <ThemeToggle />
            <UserMenu>
              <ProfileMenu />
              <OnboardingMenuItem />
              <ChangelogMenuItem />
            </UserMenu>
          </div>
        </div>
        <main className="px-8 pt-2 pb-12" id="main-content">
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

/** Light / dark switch (light is the amoCRM-like theme) */
const ThemeToggle = () => {
  const translate = useTranslate();
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  const label = translate(isDark ? "crm.theme.to_light" : "crm.theme.to_dark");
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      aria-label={label}
      title={label}
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
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
    <h1 className="truncate text-lg font-semibold leading-tight text-foreground">
      {current.label}
    </h1>
  );
};
