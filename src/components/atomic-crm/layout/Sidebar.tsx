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
import { UserMenu } from "@/components/admin/user-menu";
import { useTheme } from "@/components/admin/use-theme";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ChangelogPage } from "../misc/ChangelogPage";
import { ImportPage } from "../misc/ImportPage";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { type NavItem, SIDEBAR_WIDTH, useNavItems } from "./navigation";

const adminItems = (translate: ReturnType<typeof useTranslate>) => ({
  sales: {
    to: "/sales",
    match: "/sales/*",
    icon: Users,
    label: translate("resources.sales.name", { smart_count: 2 }),
  },
  settings: {
    to: "/settings",
    match: "/settings",
    icon: Settings,
    label: translate("crm.settings.title"),
  },
});

export const Sidebar = () => {
  const translate = useTranslate();
  const { title } = useConfigurationContext();
  const location = useLocation();
  const items = useNavItems();
  const { sales, settings } = adminItems(translate);
  const isActive = (item: NavItem) =>
    matchPath(item.match, location.pathname) != null;

  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 flex flex-col items-center border-r border-sidebar-border bg-sidebar py-5"
      style={{ width: SIDEBAR_WIDTH }}
      aria-label={translate("crm.navigation.label")}
    >
      <Link
        to="/"
        className="mb-6 flex size-10 items-center justify-center rounded-full bg-primary text-[15px] font-bold tracking-tight text-primary-foreground"
        title={title}
      >
        D
      </Link>
      <nav className="flex flex-1 flex-col items-center gap-1">
        {items.map((item) => (
          <SidebarLink key={item.to} item={item} active={isActive(item)} />
        ))}
      </nav>
      <div className="flex flex-col items-center gap-1">
        <CanAccess resource="sales" action="list">
          <SidebarLink item={sales} active={isActive(sales)} />
        </CanAccess>
        <CanAccess resource="configuration" action="edit">
          <SidebarLink item={settings} active={isActive(settings)} />
        </CanAccess>
        <ThemeButton />
        <div className="mt-2">
          <UserMenu>
            <ProfileMenu />
            <ImportFromJsonMenuItem />
            <ChangelogMenuItem />
          </UserMenu>
        </div>
      </div>
    </aside>
  );
};

const SidebarLink = ({ item, active }: { item: NavItem; active: boolean }) => {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className="group flex w-[4.5rem] flex-col items-center gap-1 rounded-md py-1.5 text-sidebar-foreground no-underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-full transition-colors",
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "text-sidebar-foreground/70 group-hover:bg-sidebar-accent group-hover:text-sidebar-foreground",
        )}
      >
        <Icon className="size-[1.15rem]" strokeWidth={1.75} />
      </span>
      <span
        className={cn(
          "max-w-full text-center text-[11px] leading-[1.15]",
          active
            ? "font-semibold text-sidebar-foreground"
            : "font-medium text-sidebar-foreground/65 group-hover:text-sidebar-foreground",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
};

const ThemeButton = () => {
  const translate = useTranslate();
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  const label = translate("crm.theme.label");
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={label}
      aria-label={label}
      className="flex size-10 items-center justify-center rounded-full text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      {isDark ? (
        <Sun className="size-[1.1rem]" strokeWidth={1.75} />
      ) : (
        <Moon className="size-[1.1rem]" strokeWidth={1.75} />
      )}
    </button>
  );
};

const ProfileMenu = () => {
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

const ImportFromJsonMenuItem = () => {
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

const ChangelogMenuItem = () => {
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
