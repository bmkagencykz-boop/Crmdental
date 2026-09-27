import {
  ChartColumn,
  FileText,
  Megaphone,
  Settings,
  User,
  Users,
} from "lucide-react";
import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ChangelogPage } from "../misc/ChangelogPage";
import { type NavItem, SIDEBAR_WIDTH, useNavItems } from "./navigation";

/**
 * Column of square-ish buttons with short labels under each icon (amoCRM
 * habit).
 */
export const Sidebar = () => {
  const translate = useTranslate();
  const location = useLocation();
  const items = useNavItems();
  const sales: NavItem = {
    to: "/sales",
    match: "/sales/*",
    icon: Users,
    label: translate("resources.sales.name", { smart_count: 2 }),
  };
  const reports: NavItem = {
    to: "/reports",
    match: "/reports",
    icon: ChartColumn,
    label: translate("reports.title"),
  };
  const mailings: NavItem = {
    to: "/mailings",
    match: "/mailings",
    icon: Megaphone,
    label: translate("mailings.title"),
  };
  const settings: NavItem = {
    to: "/settings",
    match: "/settings",
    icon: Settings,
    label: translate("crm.settings.title"),
  };
  const isActive = (item: NavItem) =>
    matchPath(item.match, location.pathname) != null;

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 flex flex-col items-center pt-5 pb-6"
      style={{ width: SIDEBAR_WIDTH }}
      aria-label={translate("crm.navigation.label")}
    >
      <Link
        to="/"
        className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        aria-label="Dental CRM"
      >
        <LogoMark />
      </Link>
      <nav className="mt-9 flex flex-1 flex-col items-center gap-3">
        {items.map((item) => (
          <SidebarLink key={item.to} item={item} active={isActive(item)} />
        ))}
      </nav>
      <div className="flex flex-col items-center gap-3">
        <CanAccess resource="reports" action="list">
          <SidebarLink item={reports} active={isActive(reports)} />
        </CanAccess>
        <CanAccess resource="mailings" action="list">
          <SidebarLink item={mailings} active={isActive(mailings)} />
        </CanAccess>
        <CanAccess resource="sales" action="list">
          <SidebarLink item={sales} active={isActive(sales)} />
        </CanAccess>
        {/* Everyone: managers keep their quick replies there */}
        <SidebarLink item={settings} active={isActive(settings)} />
      </div>
    </aside>
  );
};

const LogoMark = () => (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
    <path
      d="M17.6 7.2A7.2 7.2 0 1 0 17.6 16.8"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
  </svg>
);

const SidebarLink = ({ item, active }: { item: NavItem; active: boolean }) => {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className="group flex w-[4.75rem] flex-col items-center gap-1.5 rounded-xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "relative flex size-12 items-center justify-center rounded-lg transition-all duration-200",
          active
            ? "bg-primary text-primary-foreground shadow-[0_8px_22px_-10px_rgba(239,59,110,0.7)]"
            : "border border-nav-button-border bg-nav-button text-foreground shadow-card group-hover:border-primary/60 group-hover:text-brand-link",
        )}
      >
        <Icon className="size-[1.3rem]" strokeWidth={2} />
        {item.badge ? (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-blush px-1 text-[10px] font-bold text-[#1A1517] ring-2 ring-background"
            data-testid="nav-badge"
            aria-hidden
          >
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "text-center text-[11px] leading-[1.15] transition-colors",
          active
            ? "font-semibold text-brand-link"
            : "font-medium text-foreground/85 group-hover:text-foreground",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
};

export const ProfileMenu = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ProfileMenu> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to="/profile" className="flex items-center gap-2">
        <User />
        {translate("crm.profile.title")}
      </Link>
    </DropdownMenuItem>
  );
};

export const ChangelogMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ChangelogMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ChangelogPage.path} className="flex items-center gap-2">
        <FileText />
        {translate("crm.changelog.title")}
      </Link>
    </DropdownMenuItem>
  );
};
