import { useTranslate } from "ra-core";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { STATUS_FLOW } from "./labMath";
import type { LabStatus } from "./types";

/** The tone of a status chip: a dot of color on a light pill */
const STATUS_TONES: Record<LabStatus, string> = {
  clinic: "bg-muted text-foreground",
  courier: "bg-tone-orange/15 text-foreground",
  lab: "bg-tone-blue/15 text-foreground",
  fitting: "bg-tone-violet/15 text-foreground",
  remake: "bg-tone-red/15 text-foreground",
  ready: "bg-tone-green/15 text-foreground",
  delivered: "bg-primary text-primary-foreground",
};
const DOTS: Record<LabStatus, string> = {
  clinic: "bg-foreground/40",
  courier: "bg-tone-orange",
  lab: "bg-tone-blue",
  fitting: "bg-tone-violet",
  remake: "bg-tone-red",
  ready: "bg-tone-green",
  delivered: "bg-neon",
};

export const StatusChip = ({
  status,
  className,
}: {
  status: LabStatus;
  className?: string;
}) => {
  const translate = useTranslate();
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm whitespace-nowrap",
        STATUS_TONES[status],
        className,
      )}
      data-testid="lab-status"
    >
      <span className={cn("size-2 rounded-full", DOTS[status])} aria-hidden />
      {translate(`lab.statuses.${status}`)}
    </span>
  );
};

/** The status chip as a menu: pick the next status */
export const StatusMenu = ({
  status,
  disabled,
  onChange,
}: {
  status: LabStatus;
  disabled?: boolean;
  onChange: (status: LabStatus) => void;
}) => {
  const translate = useTranslate();
  if (disabled) return <StatusChip status={status} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={translate("lab.card.change_status")}
        title={translate("lab.card.change_status")}
      >
        <StatusChip status={status} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="rounded-2xl">
        {STATUS_FLOW.map((value) => (
          <DropdownMenuItem
            key={value}
            disabled={value === status}
            onSelect={() => onChange(value)}
            className="gap-2 rounded-xl"
          >
            <span className={cn("size-2 rounded-full", DOTS[value])} />
            {translate(`lab.statuses.${value}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** «2 дня»: how long an order is overdue */
export const OverdueChip = ({ days }: { days: number }) => {
  const translate = useTranslate();
  if (days <= 0) return null;
  return (
    <span
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-tone-red px-3.5 text-sm font-medium whitespace-nowrap text-white"
      title={translate("lab.card.overdue", {
        days: translate("lab.overdue_days", { smart_count: days }),
      })}
      data-testid="lab-overdue"
    >
      <ClockGlyph />
      {translate("lab.overdue_days", { smart_count: days })}
    </span>
  );
};

/** A small clock (line icon) */
export const ClockGlyph = ({
  className = "size-3.5",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** The chevron of «Подробнее» */
export const ChevronGlyph = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className={cn("size-4 transition-transform", open && "rotate-180")}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const PlusGlyph = ({ className = "size-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CrossGlyph = ({
  className = "size-3",
}: {
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    aria-hidden
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** Pill tabs of the page (the black pill is the active one) */
export const PillTabs = <T extends string>({
  value,
  options,
  onChange,
  label,
  size = "lg",
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
  size?: "lg" | "sm";
}) => (
  <div
    className="flex flex-wrap items-center gap-2"
    role="tablist"
    aria-label={label}
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "rounded-full text-sm transition-colors",
          size === "lg" ? "h-11 px-5" : "h-9 px-4",
          value === option.value
            ? "bg-primary text-primary-foreground"
            : "bg-card hover:bg-pill",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/** A label over a value, in a light inner block */
export const Fact = ({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={cn("min-w-0", className)}>
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="truncate text-sm">{children}</div>
  </div>
);
