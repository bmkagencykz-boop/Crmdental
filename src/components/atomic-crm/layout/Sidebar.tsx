import {
  IntegrationsGlyph,
  MailingsGlyph,
  ReportsGlyph,
  SettingsGlyph,
  TeamGlyph,
} from "./navGlyphs";
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
    icon: TeamGlyph,
    label: translate("resources.sales.name", { smart_count: 2 }),
  };
  const reports: NavItem = {
    to: "/reports",
    match: "/reports",
    icon: ReportsGlyph,
    label: translate("reports.title"),
  };
  const mailings: NavItem = {
    to: "/mailings",
    match: "/mailings",
    icon: MailingsGlyph,
    label: translate("mailings.title"),
  };
  const integrations: NavItem = {
    to: "/integrations",
    match: "/integrations",
    icon: IntegrationsGlyph,
    label: translate("market.nav"),
  };
  const settings: NavItem = {
    to: "/settings",
    match: "/settings",
    icon: SettingsGlyph,
    label: translate("crm.settings.title"),
  };
  const isActive = (item: NavItem) =>
    matchPath(item.match, location.pathname) != null;

  return (
    <aside
      className="fixed top-20 bottom-0 left-0 z-30 flex flex-col items-center overflow-y-auto pt-4 pb-6 [scrollbar-width:none]"
      style={{ width: SIDEBAR_WIDTH }}
      aria-label={translate("crm.navigation.label")}
    >
      <nav className="flex flex-1 flex-col items-center gap-3">
        {items.map((item) =>
          item.resource ? (
            // The integrator (stage 25) only sees Сделки, Интеграции, Настройки
            <CanAccess key={item.to} resource={item.resource} action="menu">
              <SidebarLink item={item} active={isActive(item)} />
            </CanAccess>
          ) : (
            <SidebarLink key={item.to} item={item} active={isActive(item)} />
          ),
        )}
      </nav>
      <div className="mt-6 flex flex-col items-center gap-3">
        <CanAccess resource="reports" action="list">
          <SidebarLink item={reports} active={isActive(reports)} />
        </CanAccess>
        <CanAccess resource="mailings" action="list">
          <SidebarLink item={mailings} active={isActive(mailings)} />
        </CanAccess>
        <CanAccess resource="sales" action="list">
          <SidebarLink item={sales} active={isActive(sales)} />
        </CanAccess>
        <CanAccess resource="integrations" action="list">
          <SidebarLink item={integrations} active={isActive(integrations)} />
        </CanAccess>
        {/* Everyone: managers keep their quick replies there */}
        <SidebarLink item={settings} active={isActive(settings)} />
      </div>
    </aside>
  );
};

/** A round button; the section name shows on hover (and to screen readers) */
const SidebarLink = ({ item, active }: { item: NavItem; active: boolean }) => {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className="group relative flex items-center no-underline outline-none"
    >
      <span
        className={cn(
          "relative flex size-12 items-center justify-center rounded-full transition-all duration-200 group-focus-visible:ring-2 group-focus-visible:ring-ring",
          active
            ? "bg-primary text-primary-foreground shadow-[0_10px_24px_-10px_rgba(239,59,110,0.8)]"
            : "bg-card text-foreground/70 shadow-card group-hover:text-primary",
        )}
      >
        <Icon className="size-[1.3rem]" />
        {item.badge ? (
          <span
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background ring-2 ring-background"
            data-testid="nav-badge"
            title={item.badgeLabel}
            aria-hidden
          >
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        ) : null}
      </span>
      <span className="sr-only">{item.label}</span>
      <span
        className="pointer-events-none absolute left-full z-50 ml-3 hidden rounded-full bg-foreground px-3 py-1.5 text-xs font-medium whitespace-nowrap text-background shadow-soft group-hover:block"
        aria-hidden
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
        {translate("crm.changelog.title")}
      </Link>
    </DropdownMenuItem>
  );
};
