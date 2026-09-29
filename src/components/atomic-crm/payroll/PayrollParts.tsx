import { useTranslate } from "ra-core";
import { cn } from "@/lib/utils";

import { money } from "../payments/usePayments";
import { weekdayOf } from "../tasks/calendarLayout";
import { heatLevel, monthLabel, nextMonth, previousMonth } from "./payrollMath";
import type { PayrollEmployee } from "./types";

/** ‹ «Сентябрь 2026» › — the month chip */
export const MonthSwitcher = ({
  month,
  onChange,
  closed,
}: {
  month: string;
  onChange: (month: string) => void;
  closed?: boolean;
}) => {
  const translate = useTranslate();
  return (
    <div className="flex items-center gap-2" data-testid="payroll-month">
      <RoundButton
        label={translate("payroll.month.previous")}
        onClick={() => onChange(previousMonth(month))}
      >
        <path d="M15 6l-6 6 6 6" />
      </RoundButton>
      <span className="flex h-11 items-center gap-2 rounded-full bg-neon px-5 text-sm font-medium text-neon-ink">
        {monthLabel(month)}
        {closed ? (
          <span className="rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-semibold">
            {translate("payroll.month.closed")}
          </span>
        ) : null}
      </span>
      <RoundButton
        label={translate("payroll.month.next")}
        onClick={() => onChange(nextMonth(month))}
      >
        <path d="M9 6l6 6-6 6" />
      </RoundButton>
    </div>
  );
};

const RoundButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="flex size-11 items-center justify-center rounded-full bg-card transition-colors hover:bg-pill"
  >
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  </button>
);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

/** A round «photo»: the initials on the doctor's colour */
export const EmployeeAvatar = ({
  employee,
  className,
}: {
  employee: Pick<PayrollEmployee, "name" | "color">;
  className?: string;
}) => (
  <span
    className={cn(
      "relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg font-medium text-white",
      !employee.color && "bg-primary",
      className,
    )}
    style={employee.color ? { background: employee.color } : undefined}
    aria-hidden
  >
    <span className="absolute -top-3 -left-2 size-10 rounded-full bg-white/25 blur-md" />
    <span className="relative">{initials(employee.name)}</span>
  </span>
);

const HEAT = [
  "bg-muted text-muted-foreground",
  "bg-neon/20 text-foreground",
  "bg-neon/45 text-foreground",
  "bg-neon/70 text-neon-ink",
  "bg-neon text-neon-ink",
];

const WEEKDAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"];

/**
 * The month as a grid of days (Monday first): the pinker, the more work;
 * days off greyed and hatched, a red ring on an overdue deadline
 */
export const HeatCalendar = ({
  employee,
  large = false,
}: {
  employee: Pick<PayrollEmployee, "days" | "kind">;
  large?: boolean;
}) => {
  const translate = useTranslate();
  const metric = (day: PayrollEmployee["days"][number]) =>
    employee.kind === "doctor" ? day.works : day.amount;
  const max = Math.max(0, ...employee.days.map(metric));
  const lead = employee.days.length ? weekdayOf(employee.days[0].day) : 0;
  return (
    <div aria-label={translate("payroll.calendar.label")} role="group">
      <div
        className={cn(
          "grid grid-cols-7 text-center text-[11px] text-muted-foreground",
          large ? "gap-2" : "gap-1.5",
        )}
      >
        {WEEKDAY_KEYS.map((key) => (
          <span key={key}>{translate(`payroll.weekdays.${key}`)}</span>
        ))}
      </div>
      <div
        className={cn("mt-1.5 grid grid-cols-7", large ? "gap-2" : "gap-1.5")}
        data-testid="payroll-calendar"
      >
        {Array.from({ length: lead }, (_, index) => (
          <span key={`lead${index}`} />
        ))}
        {employee.days.map((day) => {
          const level = heatLevel(metric(day), max);
          const title = [
            translate("payroll.calendar.day", {
              day: Number(day.day.slice(8)),
              works: day.works,
              amount: money(day.amount),
            }),
            day.off ? translate("payroll.calendar.off") : null,
            day.overdue
              ? translate("payroll.calendar.overdue", { count: day.overdue })
              : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <span
              key={day.day}
              title={title}
              data-level={level}
              data-off={day.off || undefined}
              data-overdue={day.overdue > 0 || undefined}
              className={cn(
                "relative flex items-center justify-center rounded-lg tabular-nums",
                large ? "h-12 text-sm" : "h-8 text-xs",
                day.off && level === 0
                  ? "hatch bg-card text-muted-foreground/70"
                  : HEAT[level],
                day.overdue > 0 &&
                  "ring-2 ring-tone-red ring-offset-1 ring-offset-card",
              )}
            >
              {Number(day.day.slice(8))}
              {day.overdue > 0 ? (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-tone-orange" />
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
};
