import { useGetList, useTranslate } from "ra-core";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

import { useLeadSources } from "../dictionaries/useDictionaries";
import { DentalCloud } from "../misc/Dental3D";
import type { Visit } from "../schedule/types";
import type { Deal, DealPayment } from "../types";

const DAY = 86_400_000;
const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};
/** The first of the last seven days (today included) */
const startOfWeek = (date: Date) =>
  new Date(startOfDay(date).getTime() - 6 * DAY);
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const weekdayOf = (date: Date) => WEEKDAYS[(date.getDay() + 6) % 7];
/** Index of a date among the last seven days (0: six days ago, 6: today) */
const dayIndex = (value: string) =>
  6 -
  Math.floor(
    (startOfDay(new Date()).getTime() - startOfDay(new Date(value)).getTime()) /
      DAY,
  );
/** The labels of the last seven days: «Вт … Пн» */
const lastSevenLabels = () =>
  Array.from({ length: 7 }, (_, i) =>
    weekdayOf(new Date(startOfDay(new Date()).getTime() - (6 - i) * DAY)),
  );

/** «10,2» + «млн»: a big figure and its unit, like «29,48m» */
const bigMoney = (amount: number): [string, string] => {
  if (amount >= 1_000_000)
    return [
      (amount / 1_000_000).toLocaleString("ru-RU", {
        maximumFractionDigits: 2,
      }),
      "млн ₸",
    ];
  if (amount >= 1_000)
    return [
      (amount / 1_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }),
      "тыс ₸",
    ];
  return [amount.toLocaleString("ru-RU"), "₸"];
};

/** The round «↗» button of a card */
export const ArrowButton = ({
  to,
  label,
  dark = false,
  className,
}: {
  to: string;
  label: string;
  dark?: boolean;
  className?: string;
}) => (
  <Link
    to={to}
    aria-label={label}
    title={label}
    className={cn(
      "flex size-14 items-center justify-center rounded-full no-underline transition-colors",
      dark
        ? "bg-primary text-primary-foreground"
        : "bg-card text-foreground hover:bg-primary hover:text-primary-foreground",
      className,
    )}
  >
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  </Link>
);

/** A small round tool button (filters, comments) next to the arrow */
export const RoundTool = ({
  children,
  dark = false,
  label,
}: {
  children: ReactNode;
  dark?: boolean;
  label: string;
}) => (
  <span
    className={cn(
      "flex size-11 items-center justify-center rounded-full",
      dark ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
    )}
    title={label}
    aria-hidden
  >
    {children}
  </span>
);

export const SlidersIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-[18px]"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
  >
    <path d="M8 4v16M16 4v16" />
    <circle cx="8" cy="15" r="2.4" fill="var(--card)" />
    <circle cx="16" cy="9" r="2.4" fill="var(--card)" />
  </svg>
);

/**
 * A card of the design: large radius, a notch in the top-right corner with
 * the round «↗» button in it, a light title.
 */
export const StudioCard = ({
  title,
  subtitle,
  to,
  toLabel,
  tools,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  to?: string;
  toLabel?: string;
  tools?: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <section className={cn("relative", className)} aria-label={title}>
    <div
      className={cn(
        "flex h-full flex-col rounded-[28px] bg-card p-6",
        to && "notch",
      )}
    >
      <div className="flex items-start gap-3 pr-16">
        <div className="min-w-0">
          <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {tools ? <div className="ml-auto flex gap-2">{tools}</div> : null}
      </div>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
    {to ? (
      <ArrowButton
        to={to}
        label={toLabel ?? title}
        className="absolute top-0 right-0"
      />
    ) : null}
  </section>
);

/** A big light figure with a small unit: «186», «29,48 млн ₸» */
const Big = ({ value, unit }: { value: string; unit?: string }) => (
  <p className="flex items-baseline gap-1.5 whitespace-nowrap">
    <span className="text-[44px] leading-none font-light tracking-[-0.04em] tabular-nums">
      {value}
    </span>
    {unit ? (
      <span className="text-base font-light text-muted-foreground">{unit}</span>
    ) : null}
  </p>
);

/** A neon chip with a value, placed over a bar or a point */
const NeonChip = ({ children }: { children: ReactNode }) => (
  <span className="rounded-lg bg-neon px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-neon-ink shadow-[0_6px_16px_-6px_rgba(255,46,147,0.8)]">
    {children}
  </span>
);

const useWeekDeals = () => {
  const weekStart = startOfWeek(new Date());
  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 1000 },
    filter: {
      "created_at@gte": new Date(weekStart.getTime() - 7 * DAY).toISOString(),
    },
  });
  return { deals, weekStart };
};

const usePayments = (days: number) => {
  const from = startOfDay(new Date(Date.now() - days * DAY));
  const { data: payments = [] } = useGetList<DealPayment>("deal_payments", {
    pagination: { page: 1, perPage: 2000 },
    filter: { "paid_at@gte": from.toISOString() },
  });
  return payments;
};

/** «Клиника сегодня»: the 3D hero with today's visits */
export const ClinicHeroCard = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const today = startOfDay(new Date());
  const { data: visits = [] } = useGetList<Visit>("visits", {
    pagination: { page: 1, perPage: 500 },
    filter: {
      "starts_at@gte": today.toISOString(),
      "starts_at@lt": new Date(today.getTime() + DAY).toISOString(),
    },
  });
  const active = visits.filter((visit) => visit.status !== "cancelled");
  const came = visits.filter((visit) =>
    ["arrived", "completed"].includes(visit.status),
  ).length;
  const confirmed = visits.filter((visit) =>
    ["confirmed", "arrived", "completed"].includes(visit.status),
  ).length;
  const missed = visits.filter((visit) => visit.status === "no_show").length;
  const percent = (part: number) =>
    active.length ? Math.round((part / active.length) * 100) : 0;
  return (
    <section
      className={cn(
        "relative flex min-h-[34rem] flex-col overflow-hidden rounded-[28px] bg-card",
        className,
      )}
      aria-label={translate("studio.clinic_today")}
    >
      <div className="relative z-10 flex items-start justify-between p-6">
        <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
          {translate("studio.clinic_today")}
        </h2>
        <ArrowButton
          to="/schedule"
          label={translate("schedule.nav")}
          className="-mt-1 -mr-1 size-11 bg-pill"
        />
      </div>
      <DentalCloud className="absolute inset-x-0 top-10 h-[62%]" />
      <div className="relative z-10 mx-3 mt-auto mb-3 rounded-[24px] bg-white/55 p-4 backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{translate("studio.visits")}</p>
            <p className="text-xs text-muted-foreground">
              {translate("studio.visits_hint")}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col justify-end rounded-[20px] bg-neon px-3 pt-10 pb-3 text-neon-ink">
            <span className="text-2xl font-light tracking-[-0.03em] tabular-nums">
              {active.length}
            </span>
            <span className="text-xs">{translate("studio.booked")}</span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="rounded-[18px] bg-card px-3 py-2">
              <span className="text-lg font-light tabular-nums">
                {percent(confirmed)}%
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {translate("studio.confirmed")}
              </span>
            </div>
            <div className="rounded-[18px] bg-card px-3 py-2">
              <span className="text-lg font-light tabular-nums">{came}</span>
              <span className="block text-[11px] text-muted-foreground">
                {translate("studio.came")}
                {missed > 0
                  ? ` · ${translate("studio.missed", { count: missed })}`
                  : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

/** «Активность»: new deals of the week by day, hatched bars */
export const ActivityCard = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const { deals, weekStart } = useWeekDeals();
  const thisWeek = deals.filter(
    (deal) => new Date(deal.created_at) >= weekStart,
  );
  const labels = lastSevenLabels();
  const perDay = labels.map(
    (_, day) =>
      thisWeek.filter((deal) => dayIndex(deal.created_at) === day).length,
  );
  const max = Math.max(1, ...perDay);
  const peak = perDay.indexOf(Math.max(...perDay));
  const today = 6;
  return (
    <StudioCard
      title={translate("studio.activity")}
      to="/deals"
      toLabel={translate("resources.deals.name", { smart_count: 2 })}
      tools={
        <RoundTool label={translate("studio.filters")}>
          <SlidersIcon />
        </RoundTool>
      }
      className={className}
    >
      <p className="text-sm text-muted-foreground">
        {translate("studio.new_deals_week")}
      </p>
      <Big value={String(thisWeek.length)} />
      <div className="mt-auto flex h-44 items-end gap-2.5 pt-8">
        {perDay.map((count, day) => {
          const highlighted = day === peak && count > 0;
          return (
            <div key={day} className="flex flex-1 flex-col items-center gap-2">
              <div className="relative flex w-full flex-1 items-end">
                {highlighted ? (
                  <span className="absolute -top-9 left-1/2 -translate-x-1/2">
                    <NeonChip>{count}</NeonChip>
                  </span>
                ) : null}
                <div
                  className={cn(
                    "w-full rounded-[14px]",
                    highlighted
                      ? "hatch border border-foreground/15 bg-pill"
                      : "bg-muted",
                  )}
                  style={{
                    height: `${Math.max(12, (count / max) * 100)}%`,
                    minHeight: 18,
                  }}
                  title={`${labels[day]}: ${count}`}
                />
              </div>
              <span
                className={cn(
                  "text-xs",
                  day === today
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {labels[day]}
              </span>
            </div>
          );
        })}
      </div>
    </StudioCard>
  );
};

/** «Сравнение выручки»: payments by day, this week against the last one */
export const RevenueCard = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const payments = usePayments(14);
  const weekStart = startOfWeek(new Date());
  const lastStart = new Date(weekStart.getTime() - 7 * DAY);
  const sumBy = (from: Date) =>
    Array.from({ length: 7 }, (_, day) => {
      const dayStart = new Date(from.getTime() + day * DAY);
      const dayEnd = new Date(dayStart.getTime() + DAY);
      return payments
        .filter((payment) => {
          const at = new Date(payment.paid_at);
          return at >= dayStart && at < dayEnd;
        })
        .reduce((sum, payment) => sum + payment.amount, 0);
    });
  const current = sumBy(weekStart);
  const last = sumBy(lastStart);
  const total = current.reduce((a, b) => a + b, 0);
  const lastTotal = last.reduce((a, b) => a + b, 0);
  const change = lastTotal
    ? Math.round(((total - lastTotal) / lastTotal) * 100)
    : null;
  const max = Math.max(1, ...current, ...last);
  const W = 560;
  const H = 170;
  const x = (day: number) => 16 + (day * (W - 32)) / 6;
  const y = (value: number) => H - 14 - (value / max) * (H - 40);
  const line = (values: number[]) =>
    values.map((value, day) => `${x(day)},${y(value)}`).join(" ");
  const band = `${line(current)} ${[...last]
    .map((value, day) => `${x(day)},${y(value)}`)
    .reverse()
    .join(" ")}`;
  const today = 6;
  const labels = lastSevenLabels();
  const [value, unit] = bigMoney(total);
  return (
    <StudioCard
      title={translate("studio.revenue")}
      to="/reports"
      toLabel={translate("reports.title")}
      tools={
        <RoundTool dark label={translate("studio.filters")}>
          <SlidersIcon />
        </RoundTool>
      }
      className={className}
    >
      <p className="text-sm text-muted-foreground">
        {translate("studio.paid_this_week")}
      </p>
      <Big value={value} unit={unit} />
      <div className="relative mt-auto pt-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
          <title>{translate("studio.revenue")}</title>
          <defs>
            <pattern
              id="revenue-hatch"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="7"
                stroke="#121214"
                strokeOpacity="0.35"
                strokeWidth="1.4"
              />
            </pattern>
          </defs>
          <polygon points={band} fill="url(#revenue-hatch)" />
          <polyline
            points={line(last)}
            fill="none"
            stroke="#121214"
            strokeOpacity="0.25"
            strokeWidth="1.2"
          />
          <polyline
            points={line(current)}
            fill="none"
            stroke="#121214"
            strokeOpacity="0.55"
            strokeWidth="1.2"
          />
          {current.map((value, day) => (
            <circle
              key={day}
              cx={x(day)}
              cy={y(value)}
              r="2.6"
              fill="#121214"
              fillOpacity="0.5"
            />
          ))}
          <line
            x1={x(today)}
            x2={x(today)}
            y1="10"
            y2={H - 10}
            stroke="#121214"
            strokeOpacity="0.2"
          />
        </svg>
        {change != null ? (
          <span
            className="absolute -translate-x-1/2"
            style={{
              left: `${(x(today) / W) * 100}%`,
              top: `${(y(current[today]) / H) * 100}%`,
            }}
          >
            <NeonChip>
              {change > 0 ? "+" : ""}
              {change}%
            </NeonChip>
          </span>
        ) : null}
        <div className="mt-1 flex justify-between px-3 text-xs text-muted-foreground">
          {labels.map((day, i) => (
            <span
              key={i}
              className={cn(i === today && "font-semibold text-foreground")}
            >
              {day}
            </span>
          ))}
        </div>
      </div>
    </StudioCard>
  );
};

/** «Оплаты»: the last seven days as a line with points */
export const PaymentsCard = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const payments = usePayments(7);
  const start = startOfDay(new Date(Date.now() - 6 * DAY));
  const days = Array.from(
    { length: 7 },
    (_, i) => new Date(start.getTime() + i * DAY),
  );
  const perDay = days.map((day) =>
    payments
      .filter((payment) => {
        const at = new Date(payment.paid_at);
        return at >= day && at < new Date(day.getTime() + DAY);
      })
      .reduce((sum, payment) => sum + payment.amount, 0),
  );
  const total = perDay.reduce((a, b) => a + b, 0);
  const patients = new Set(payments.map((payment) => payment.deal_id)).size;
  const max = Math.max(1, ...perDay);
  const peak = perDay.indexOf(Math.max(...perDay));
  const W = 420;
  const H = 150;
  const x = (i: number) => 14 + (i * (W - 28)) / 6;
  const y = (value: number) => H - 12 - (value / max) * (H - 44);
  const path = perDay
    .map((value, i) => {
      if (i === 0) return `M${x(i)},${y(value)}`;
      const px = x(i - 1);
      const py = y(perDay[i - 1]);
      const cx = (px + x(i)) / 2;
      return `C${cx},${py} ${cx},${y(value)} ${x(i)},${y(value)}`;
    })
    .join(" ");
  const [value, unit] = bigMoney(total);
  return (
    <StudioCard
      title={translate("studio.payments")}
      to="/reports"
      toLabel={translate("reports.title")}
      tools={
        <RoundTool label={translate("studio.filters")}>
          <SlidersIcon />
        </RoundTool>
      }
      className={className}
    >
      <div className="flex flex-1 gap-5">
        <div className="flex w-44 shrink-0 flex-col">
          <p className="text-sm text-muted-foreground">
            {translate("studio.last_7_days")}
          </p>
          <Big value={value} unit={unit} />
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <span className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <b className="font-semibold tabular-nums">{payments.length}</b>
              <span className="text-muted-foreground">
                {translate("studio.payments_count")}
              </span>
            </span>
            <span className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
              <b className="font-semibold tabular-nums">{patients}</b>
              <span className="text-muted-foreground">
                {translate("studio.deals_count")}
              </span>
            </span>
          </div>
        </div>
        <div className="relative min-w-0 flex-1 self-end">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
            <title>{translate("studio.payments")}</title>
            <path d={path} fill="none" stroke="#121214" strokeWidth="1.6" />
            {perDay.map((value, i) => (
              <circle key={i} cx={x(i)} cy={y(value)} r="4" fill="#121214" />
            ))}
          </svg>
          {perDay[peak] > 0 ? (
            <span
              className="absolute -translate-x-1/2 -translate-y-[140%]"
              style={{
                left: `${(x(peak) / W) * 100}%`,
                top: `${(y(perDay[peak]) / H) * 100}%`,
              }}
            >
              <NeonChip>{perDay[peak].toLocaleString("ru-RU")} ₸</NeonChip>
            </span>
          ) : null}
          <div className="mt-1 flex justify-between px-1 text-xs text-muted-foreground">
            {days.map((day) => (
              <span key={day.toISOString()}>
                {WEEKDAYS[(day.getDay() + 6) % 7]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </StudioCard>
  );
};

/** «Источники заявок»: leads of 30 days and the top sources in percent */
export const SourcesCard = ({ className }: { className?: string }) => {
  const translate = useTranslate();
  const { data: sources } = useLeadSources();
  const from = new Date(startOfDay(new Date()).getTime() - 30 * DAY);
  const { data: deals = [] } = useGetList<Deal>("deals", {
    pagination: { page: 1, perPage: 1000 },
    filter: { "created_at@gte": from.toISOString() },
  });
  const counts = new Map<string, number>();
  deals.forEach((deal) => {
    const key = String(deal.source_id ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const top = [...counts.entries()]
    .filter(([key]) => key !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return (
    <StudioCard
      title={translate("studio.sources")}
      to="/reports"
      toLabel={translate("reports.title")}
      className={className}
    >
      <p className="text-sm text-muted-foreground">
        {translate("studio.leads_30_days")}
      </p>
      <Big value={String(deals.length)} unit={translate("studio.leads")} />
      <div className="mt-auto flex flex-col gap-2.5 pt-6">
        {top.map(([key, count]) => {
          const percent = deals.length
            ? Math.round((count / deals.length) * 100)
            : 0;
          const name =
            sources.find((source) => String(source.id) === key)?.name ?? "—";
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-sm">{name}</span>
              <span className="relative h-9 flex-1 overflow-hidden rounded-xl bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-xl bg-pill"
                  style={{ width: `${Math.max(percent, 8)}%` }}
                />
                <span className="absolute inset-y-0 left-3 flex items-center text-sm font-medium tabular-nums">
                  {percent}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </StudioCard>
  );
};
