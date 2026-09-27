import {
  FileText,
  Import,
  Moon,
  Settings,
  Sun,
  User,
  Users,
} from "lucide-react";
import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { Link, matchPath, useLocation } from "react-router";
import { useTheme } from "@/components/admin/use-theme";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ChangelogPage } from "../misc/ChangelogPage";
import { ImportPage } from "../misc/ImportPage";
import { type NavItem, SIDEBAR_WIDTH, useNavItems } from "./navigation";

/**
 * Floating column of round buttons (Stratus reference) with short labels
 * under each icon (amoCRM habit).
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
        className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground"
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
        <CanAccess resource="sales" action="list">
          <SidebarLink item={sales} active={isActive(sales)} />
        </CanAccess>
        <CanAccess resource="configuration" action="edit">
          <SidebarLink item={settings} active={isActive(settings)} />
        </CanAccess>
        <ThemeSwitch />
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
          "flex size-11 items-center justify-center rounded-full transition-all duration-200",
          active
            ? "bg-primary text-primary-foreground shadow-soft"
            : "soft text-foreground/70 group-hover:-translate-y-0.5 group-hover:text-foreground",
        )}
      >
        <Icon className="size-[1.1rem]" strokeWidth={1.8} />
      </span>
      <span
        className={cn(
          "text-center text-[10.5px] leading-[1.15] transition-colors",
          active
            ? "font-semibold text-foreground"
            : "font-medium text-muted-foreground group-hover:text-foreground",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
};

/** Light / dark pair, like the moon and sun circles of the reference. */
const ThemeSwitch = () => {
  const translate = useTranslate();
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const options = [
    {
      value: "dark",
      icon: Moon,
      active: isDark,
      label: translate("crm.theme.dark"),
    },
    {
      value: "light",
      icon: Sun,
      active: !isDark,
      label: translate("crm.theme.light"),
    },
  ] as const;
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      {options.map(({ value, icon: Icon, active, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setTheme(value)}
          aria-pressed={active}
          aria-label={label}
          title={label}
          className={cn(
            "flex size-11 items-center justify-center rounded-full outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-primary text-primary-foreground shadow-soft"
              : "soft text-foreground/70 hover:text-foreground",
          )}
        >
          <Icon className="size-[1.05rem]" strokeWidth={1.8} />
        </button>
      ))}
    </div>
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

export const ImportFromJsonMenuItem = () => {
  const translate = useTranslate();
  const userMenuContext = useUserMenu();
  if (!userMenuContext) {
    throw new Error("<ImportFromJsonMenuItem> must be used inside <UserMenu>");
  }
  return (
    <DropdownMenuItem asChild onClick={userMenuContext.onClose}>
      <Link to={ImportPage.path} className="flex items-center gap-2">
        <Import />
        {translate("crm.header.import_data")}
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
