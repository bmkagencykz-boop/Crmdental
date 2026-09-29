import jsonExport from "jsonexport/dist";
import { downloadCSV, useTranslate } from "ra-core";
import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useBranches } from "../branches/useBranches";
import { formatTenge } from "../onboarding/servicePresets";
import { NativeSelect } from "../payments/PaymentDialog";
import { csvRows, type TableRow } from "./financeTable";
import {
  PERIOD_PRESETS,
  presetRange,
  type MonthRange,
  type PeriodPreset,
} from "./useFinance";

/** «1 234 567», a negative with «−» */
export const num = (value: number | null | undefined) => {
  if (value == null) return "—";
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : ""}${formatTenge(Math.abs(rounded))}`;
};

/** «29,48» + «млн ₸»: a big figure and its unit */
export const bigMoney = (
  amount: number | null | undefined,
): [string, string] => {
  const value = amount ?? 0;
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000)
    return [
      sign +
        (abs / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 }),
      "млн ₸",
    ];
  if (abs >= 1_000)
    return [
      sign +
        (abs / 1_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 }),
      "тыс ₸",
    ];
  return [sign + abs.toLocaleString("ru-RU"), "₸"];
};

const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/** «сен 26», a week «14.09», a day «14.09» */
export const periodLabel = (period: string, granularity = "month") =>
  granularity === "month"
    ? `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(2, 4)}`
    : `${period.slice(8, 10)}.${period.slice(5, 7)}`;

/** The tabs of the page: black pill for the active one */
export const TabBar = <T extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
  children?: ReactNode;
}) => (
  <div className="flex flex-wrap items-center gap-2" role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.value}
        type="button"
        role="tab"
        aria-selected={value === tab.value}
        onClick={() => onChange(tab.value)}
        className={cn(
          "h-11 rounded-full px-5 text-sm transition-colors",
          value === tab.value
            ? "bg-primary text-primary-foreground"
            : "bg-card hover:bg-pill",
        )}
      >
        {label(tab.value)}
      </button>
    ))}
    {children}
  </div>
);

/** Pills to pick one value */
export const Chips = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="flex flex-wrap gap-1 rounded-full bg-card p-1"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "h-9 rounded-full px-4 text-sm transition-colors",
          value === option.value
            ? "bg-primary text-primary-foreground"
            : "hover:bg-pill",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/** Period (presets and months) and branch */
export const PeriodBar = ({
  range,
  onRange,
  branch,
  onBranch,
  today,
  children,
}: {
  range: MonthRange;
  onRange: (range: MonthRange) => void;
  branch?: string;
  onBranch?: (branch: string) => void;
  today: string;
  children?: ReactNode;
}) => {
  const translate = useTranslate();
  const { branches, enabled } = useBranches();
  const preset = PERIOD_PRESETS.find((p) => {
    const r = presetRange(p, today);
    return r.from === range.from && r.to === range.to;
  });
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {translate("finance.period.label")}
        </span>
        <Chips<PeriodPreset | "custom">
          label={translate("finance.period.label")}
          value={preset ?? "custom"}
          options={[
            ...PERIOD_PRESETS.map((p) => ({
              value: p,
              label: translate(`finance.period.${p}`),
            })),
            { value: "custom", label: translate("finance.period.custom") },
          ]}
          onChange={(value) => {
            if (value !== "custom") onRange(presetRange(value, today));
          }}
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {translate("finance.period.from")}
        </span>
        <Input
          type="month"
          className="w-40"
          value={range.from.slice(0, 7)}
          aria-label={translate("finance.period.from")}
          onChange={(event) =>
            event.target.value &&
            onRange({
              from: `${event.target.value}-01`,
              to:
                range.to < `${event.target.value}-01`
                  ? `${event.target.value}-01`
                  : range.to,
            })
          }
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {translate("finance.period.to")}
        </span>
        <Input
          type="month"
          className="w-40"
          value={range.to.slice(0, 7)}
          aria-label={translate("finance.period.to")}
          onChange={(event) =>
            event.target.value &&
            onRange({
              from:
                range.from > `${event.target.value}-01`
                  ? `${event.target.value}-01`
                  : range.from,
              to: `${event.target.value}-01`,
            })
          }
        />
      </label>
      {enabled && onBranch ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("finance.period.branch")}
          </span>
          <NativeSelect
            value={branch ?? ""}
            onChange={onBranch}
            aria-label={translate("finance.period.branch")}
          >
            <option value="">{translate("finance.period.all_branches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      ) : null}
      <div className="ml-auto flex flex-wrap items-end gap-2">{children}</div>
    </div>
  );
};

/** A big light figure on a card: «Выручка 29,5 млн ₸» */
export const Tile = ({
  label,
  value,
  hint,
  accent = false,
  tone,
  testId,
}: {
  label: string;
  value: number | null | undefined;
  hint?: ReactNode;
  accent?: boolean;
  tone?: "negative" | "positive";
  testId?: string;
}) => {
  const [figure, unit] = bigMoney(value);
  return (
    <section
      className={cn(
        "flex min-h-40 flex-col rounded-[28px] p-6",
        accent ? "bg-neon text-neon-ink" : "bg-card",
      )}
      data-testid={testId}
    >
      <p
        className={cn(
          "text-sm",
          accent ? "opacity-80" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="mt-auto flex items-baseline gap-1.5 pt-6 whitespace-nowrap">
        <span
          className={cn(
            "text-[40px] leading-none font-light tracking-[-0.04em] tabular-nums",
            tone === "negative" && !accent && "text-tone-red",
          )}
        >
          {figure}
        </span>
        <span
          className={cn(
            "text-base font-light",
            accent ? "opacity-70" : "text-muted-foreground",
          )}
        >
          {unit}
        </span>
      </p>
      {hint ? (
        <p
          className={cn(
            "mt-2 text-xs",
            accent ? "opacity-80" : "text-muted-foreground",
          )}
        >
          {hint}
        </p>
      ) : null}
    </section>
  );
};

/** A small value chip: «Выручка на кресло 9,8 млн ₸» */
export const RatioChip = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="flex flex-col rounded-2xl bg-card px-4 py-3">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-xl font-light tracking-[-0.02em] tabular-nums">
      {value}
    </span>
  </div>
);

/**
 * A table of months: sticky first column, sections that collapse, negative
 * values red, clickable cells (the drill-down)
 */
export const FinanceTable = ({
  rows,
  headers,
  labelOf,
  totalLabel,
  onCell,
  highlight,
  testId,
}: {
  rows: TableRow[];
  headers: string[];
  labelOf: (row: TableRow) => string;
  totalLabel: string;
  onCell?: (row: TableRow, index: number | null) => void;
  /** Columns to set apart (a current, partial month) */
  highlight?: (index: number) => boolean;
  testId?: string;
}) => {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const cell = (row: TableRow, value: number | null) => {
    if (row.kind === "percent")
      return value == null ? "—" : `${String(value).replace(".", ",")} %`;
    if (row.kind === "count") return value == null ? "—" : formatTenge(value);
    return num(value);
  };
  const visible = rows.filter(
    (row) => row.level === 0 || !row.section || !closed[row.section],
  );
  return (
    <div className="overflow-x-auto rounded-2xl" data-testid={testId}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 min-w-56 bg-card px-3 py-2 text-left text-xs font-normal text-muted-foreground" />
            {headers.map((header, i) => (
              <th
                key={header + i}
                className={cn(
                  "px-3 py-2 text-right text-xs font-normal whitespace-nowrap text-muted-foreground",
                  highlight?.(i) && "text-foreground",
                )}
              >
                {header}
              </th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-medium whitespace-nowrap">
              {totalLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const strong = row.kind === "total" || row.kind === "section";
            const collapsible = row.kind === "section" && row.section;
            const clickable =
              onCell &&
              (row.articleId != null ||
                row.accountId !== undefined ||
                row.transfers);
            return (
              <tr
                key={row.key}
                className={cn(row.kind === "total" && "bg-muted/60")}
                data-row={row.key}
              >
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 max-w-72 truncate px-3 py-2 text-left font-normal",
                    row.kind === "total" ? "bg-muted" : "bg-card",
                    row.level === 1 && "pl-8 text-muted-foreground",
                    strong && "font-medium",
                  )}
                  title={labelOf(row)}
                >
                  {collapsible ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2"
                      aria-expanded={!closed[row.section!]}
                      onClick={() =>
                        setClosed((prev) => ({
                          ...prev,
                          [row.section!]: !prev[row.section!],
                        }))
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className={cn(
                          "size-3.5 transition-transform",
                          closed[row.section!] ? "-rotate-90" : "",
                        )}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        aria-hidden
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                      {labelOf(row)}
                    </button>
                  ) : (
                    labelOf(row)
                  )}
                </th>
                {row.values.map((value, i) => (
                  <td
                    key={i}
                    className={cn(
                      "px-3 py-2 text-right whitespace-nowrap tabular-nums",
                      strong && "font-medium",
                      value != null &&
                        value < 0 &&
                        row.kind !== "percent" &&
                        "text-tone-red",
                      highlight?.(i) && "bg-neon-soft/40",
                    )}
                  >
                    {clickable && value ? (
                      <button
                        type="button"
                        className="rounded-md px-1 underline-offset-4 hover:bg-pill hover:underline"
                        onClick={() => onCell!(row, i)}
                      >
                        {cell(row, value)}
                      </button>
                    ) : value === 0 && row.level === 1 ? (
                      <span className="text-muted-foreground/60">·</span>
                    ) : (
                      cell(row, value)
                    )}
                  </td>
                ))}
                <td
                  className={cn(
                    "px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums",
                    row.total != null &&
                      row.total < 0 &&
                      row.kind !== "percent" &&
                      "text-tone-red",
                  )}
                >
                  {clickable && row.total ? (
                    <button
                      type="button"
                      className="rounded-md px-1 hover:bg-pill hover:underline"
                      onClick={() => onCell!(row, null)}
                    >
                      {cell(row, row.total)}
                    </button>
                  ) : (
                    cell(row, row.total)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

/**
 * Bars by period — two per period (in / out, revenue / expenses), the
 * larger hatched — and a line (the balance, the net profit)
 */
export const FinanceChart = ({
  labels,
  a,
  b,
  line,
  aLabel,
  bLabel,
  lineLabel,
  testId,
}: {
  labels: string[];
  a: number[];
  b: number[];
  line?: (number | null)[];
  aLabel: string;
  bLabel: string;
  lineLabel?: string;
  testId?: string;
}) => {
  const max = Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs));
  const lineValues = (line ?? []).filter((v): v is number => v != null);
  const lineMax = Math.max(1, ...lineValues.map(Math.abs));
  const lineMin = Math.min(0, ...lineValues);
  const H = 100;
  const points = (line ?? [])
    .map((value, i) =>
      value == null
        ? null
        : `${((i + 0.5) / labels.length) * 100},${H - ((value - lineMin) / (lineMax - lineMin || 1)) * (H - 8) - 4}`,
    )
    .filter(Boolean)
    .join(" ");
  const peak = a.indexOf(Math.max(...a));
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="hatch inline-block size-3 rounded-[4px] border border-foreground/15 bg-pill" />
          {aLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-[4px] bg-muted-foreground/25" />
          {bLabel}
        </span>
        {lineLabel ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded bg-neon" />
            {lineLabel}
          </span>
        ) : null}
      </div>
      <div className="relative h-48">
        <div className="absolute inset-0 flex items-end gap-1.5">
          {labels.map((label, i) => (
            <div
              key={label + i}
              className="flex h-full min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div className="flex w-full flex-1 items-end justify-center gap-1">
                <div
                  className={cn(
                    "w-1/2 max-w-7 rounded-[10px]",
                    i === peak
                      ? "hatch border border-foreground/15 bg-neon-soft"
                      : "hatch border border-foreground/10 bg-pill",
                  )}
                  style={{
                    height: `${Math.max(3, (Math.abs(a[i]) / max) * 100)}%`,
                  }}
                  title={`${label}: ${num(a[i])} ₸`}
                />
                <div
                  className="w-1/2 max-w-7 rounded-[10px] bg-muted-foreground/25"
                  style={{
                    height: `${Math.max(3, (Math.abs(b[i]) / max) * 100)}%`,
                  }}
                  title={`${label}: ${num(b[i])} ₸`}
                />
              </div>
              <span className="truncate text-[11px] text-muted-foreground">
                {label}
              </span>
            </div>
          ))}
        </div>
        {points ? (
          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 top-0 h-[calc(100%-1.5rem)] w-full"
            aria-hidden
          >
            <polyline
              points={points}
              fill="none"
              stroke="var(--neon)"
              strokeWidth={2.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </div>
    </div>
  );
};

/** An empty state with a light hint */
export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
    {children}
  </p>
);

/** A table as a CSV file («;» for spreadsheets in Russian) */
export const downloadTable = async ({
  rows,
  headers,
  labelOf,
  labelHeader,
  totalHeader,
  filename,
}: {
  rows: TableRow[];
  headers: string[];
  labelOf: (row: TableRow) => string;
  labelHeader: string;
  totalHeader: string;
  filename: string;
}) => {
  const csv = await jsonExport(
    csvRows(rows, headers, labelOf, labelHeader, totalHeader),
    {
      rowDelimiter: ";",
      headers: [labelHeader, ...headers, totalHeader],
    },
  );
  downloadCSV(csv, filename);
};
