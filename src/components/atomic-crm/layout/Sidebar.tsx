import {
  CashGlyph,
  FinanceGlyph,
  IntegrationsGlyph,
  LabGlyph,
  MailingsGlyph,
  PayrollGlyph,
  PriceListGlyph,
  ReportsGlyph,
  SettingsGlyph,
  TeamGlyph,
  WaitingListGlyph,
} from "./navGlyphs";
import { CanAccess, useTranslate, useUserMenu } from "ra-core";
import { Link, matchPath, useLocation, useNavigate } from "react-router";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { NavTooltip } from "./NavTooltip";

import { ChangelogPage } from "../misc/ChangelogPage";
import {
  useWaitingCount,
  useWaitingRights,
} from "../waiting-list/useWaitingList";
import { type NavItem, SIDEBAR_WIDTH } from "./navigation";

/**
 * Column of square-ish buttons with short labels under each icon (amoCRM
 * habit).
 */
export const Sidebar = () => {
  const translate = useTranslate();
  const location = useLocation();
  const sales: NavItem = {
    to: "/sales",
    match: "/sales/*",
    icon: TeamGlyph,
    label: translate("resources.sales.name", { smart_count: 2 }),
  };
  // «Касса» (stage 36): payments, deposits, shifts, debtors
  const cash: NavItem = {
    to: "/cash",
    match: "/cash",
    icon: CashGlyph,
    label: translate("payments.nav"),
  };
  // «Финансы» (stage 44): ДДС, ПиУ, the financial model
  const finance: NavItem = {
    to: "/finance",
    match: "/finance",
    icon: FinanceGlyph,
    label: translate("finance.nav"),
  };
  // «Зарплаты» (stage 39): payroll of the doctors and the staff
  const payroll: NavItem = {
    to: "/payroll",
    match: "/payroll/*",
    icon: PayrollGlyph,
    label: translate("payroll.nav"),
  };
  // «Лаборатория» (stage 40): work orders to the dental labs
  const lab: NavItem = {
    to: "/lab",
    match: "/lab",
    icon: LabGlyph,
    label: translate("lab.nav"),
  };
  const reports: NavItem = {
    to: "/reports",
    match: "/reports",
    icon: ReportsGlyph,
    label: translate("reports.title"),
  };
  const priceList: NavItem = {
    to: "/price-list",
    match: "/price-list",
    icon: PriceListGlyph,
    label: translate("price_list.nav"),
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
  // «Лист ожидания» (stage 38): the active entries on a chip
  const waitingRights = useWaitingRights();
  const waiting = useWaitingCount(waitingRights.canUse);
  const waitingList: NavItem = {
    to: "/waiting-list",
    match: "/waiting-list",
    icon: WaitingListGlyph,
    label: translate("waiting_list.nav"),
    badge: waiting.total,
    badgeLabel: translate("waiting_list.nav_badge", { count: waiting.total }),
    badgeAccent: waiting.freed > 0,
  };
  const isActive = (item: NavItem) =>
    matchPath(item.match, location.pathname) != null;

  return (
    <aside
      className="fixed top-24 bottom-0 left-0 z-30 flex flex-col items-center gap-3 overflow-y-auto pt-2 pb-6 [scrollbar-width:none]"
      style={{ width: SIDEBAR_WIDTH }}
      aria-label={translate("crm.navigation.label")}
    >
      <BackButton />
      <div className="mt-3 flex flex-col items-center gap-3">
        {waitingRights.canUse ? (
          <SidebarLink item={waitingList} active={isActive(waitingList)} />
        ) : null}
        <CanAccess resource="cash_desk" action="list">
          <SidebarLink item={cash} active={isActive(cash)} />
        </CanAccess>
        <CanAccess resource="finance" action="menu">
          <SidebarLink item={finance} active={isActive(finance)} />
        </CanAccess>
        <CanAccess resource="payroll" action="list">
          <SidebarLink item={payroll} active={isActive(payroll)} />
        </CanAccess>
        <CanAccess resource="lab" action="menu">
          <SidebarLink item={lab} active={isActive(lab)} />
        </CanAccess>
        <CanAccess resource="reports" action="list">
          <SidebarLink item={reports} active={isActive(reports)} />
        </CanAccess>
        {/* «Прайс» (stage 35): everybody reads the prices */}
        <CanAccess resource="price_list" action="menu">
          <SidebarLink item={priceList} active={isActive(priceList)} />
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

/** «←»: back to the previous screen */
const BackButton = () => {
  const translate = useTranslate();
  const navigate = useNavigate();
  return (
    <NavTooltip label={translate("ra.action.back")}>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="press flex size-12 items-center justify-center rounded-full bg-card text-foreground hover:bg-pill"
        aria-label={translate("ra.action.back")}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
      </button>
    </NavTooltip>
  );
};

/** A round button; the section name shows on hover (and to screen readers) */
const SidebarLink = ({ item, active }: { item: NavItem; active: boolean }) => {
  const Icon = item.icon;
  return (
    <NavTooltip
      label={item.label}
      hint={item.badge ? item.badgeLabel : undefined}
    >
      <Link
        to={item.to}
        aria-current={active ? "page" : undefined}
        className="group relative flex items-center no-underline outline-none"
      >
        <span
          className={cn(
            "press relative flex size-12 items-center justify-center rounded-full group-hover:scale-[1.06] group-focus-visible:ring-2 group-focus-visible:ring-ring",
            active
              ? "bg-primary text-primary-foreground"
              : "bg-card text-foreground group-hover:bg-pill",
          )}
        >
          <Icon className="size-[1.3rem]" />
          {item.badge ? (
            <span
              className={cn(
                "absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ring-2 ring-background",
                item.badgeAccent
                  ? "animate-soft-ping bg-neon text-neon-ink"
                  : "bg-foreground text-background",
              )}
              data-testid="nav-badge"
              aria-hidden
            >
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          ) : null}
        </span>
        <span className="sr-only">{item.label}</span>
      </Link>
    </NavTooltip>
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
