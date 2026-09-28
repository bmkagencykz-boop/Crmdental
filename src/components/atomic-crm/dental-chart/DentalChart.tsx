import { useTranslate } from "ra-core";
import { useState } from "react";
import { cn } from "@/lib/utils";

import {
  chartRows,
  jawOf,
  rootCount,
  toothKind,
  dentitionOf,
  type Area,
  type Dentition,
  type ToothKind,
} from "./teeth";

/**
 * «Зубная формула»: the teeth of both jaws in FDI order (the patient's right
 * on the left), permanent or primary, drawn as clean SVG silhouettes — the
 * upper roots up, the lower roots down — with a checkbox under every tooth
 * and the areas «Верхняя челюсть», «Нижняя челюсть», «Ротовая полость».
 * Reusable: marks colour the teeth (the plan editor highlights the teeth of
 * the stage in neon), the selection is controlled by the caller.
 */

export type ToothMark = {
  /** neon: the accent (items of the stage); ink: black; soft: light pink; done: muted */
  tone?: "neon" | "ink" | "soft" | "done";
  /** Tooltip: the services of the tooth */
  title?: string;
};

export type DentalChartProps = {
  /** Controlled dentition; defaultDentition otherwise */
  dentition?: Dentition;
  defaultDentition?: Dentition;
  onDentitionChange?: (dentition: Dentition) => void;
  /** Selected teeth; checkboxes are shown when onSelectedChange is given */
  selected?: number[];
  onSelectedChange?: (teeth: number[]) => void;
  /** Selected areas (a jaw, the mouth) */
  areas?: Area[];
  onAreasChange?: (areas: Area[]) => void;
  marks?: Partial<Record<number, ToothMark>>;
  areaMarks?: Partial<Record<Area, ToothMark>>;
  disabled?: boolean;
  className?: string;
};

const VIEW_W = 40;
const VIEW_H = 72;

/**
 * Outlines in the upper orientation (roots up, the crown below, the neck at
 * y≈42), in a 40 × 72 box. The lower teeth are the same, flipped.
 */
const OUTLINE: Record<ToothKind, string> = {
  incisor:
    "M13 42 C13 28 16 12 19 5 C19.5 4 20.5 4 21 5 C24 12 27 28 27 42 C29 46 30 56 30 62 C30 67 25 68 20 68 C15 68 10 67 10 62 C10 56 11 46 13 42 Z",
  canine:
    "M12 42 C12 26 15 8 19 2 C19.6 1 20.4 1 21 2 C25 8 28 26 28 42 C31 45 31 52 29 58 C27 64 23 68 20 70 C17 68 13 64 11 58 C9 52 9 45 12 42 Z",
  premolar:
    "M11 42 C11 28 14 10 18 4 C19 2.5 21 2.5 22 4 C26 10 29 28 29 42 C32 44 33 50 33 56 C33 64 27 67 20 67 C13 67 7 64 7 56 C7 50 8 44 11 42 Z",
  molar:
    "M8 42 C7 30 8 14 11 6 C12 3 15 3 16 6 L18 22 C19 25 21 25 22 22 L24 6 C25 3 28 3 29 6 C32 14 33 30 32 42 C35 44 36 50 36 56 C36 63 32 67 27 66 C24 65.5 22 64.5 20 64.5 C18 64.5 16 65.5 13 66 C8 67 4 63 4 56 C4 50 5 44 8 42 Z",
};
/** The neck of the tooth (cemento-enamel junction) */
const NECK: Record<ToothKind, string> = {
  incisor: "M13 42 C17 44.5 23 44.5 27 42",
  canine: "M12 42 C16 44.5 24 44.5 28 42",
  premolar: "M11 42 C16 45 24 45 29 42",
  molar: "M8 42 C15 45.5 25 45.5 32 42",
};
/** The palatal root of an upper molar, the split of a two-rooted premolar */
const EXTRA_ROOT = "M17.5 24 C17.5 14 19 8 20 6 C21 8 22.5 14 22.5 24";
const ROOT_SPLIT = "M20 41 L20 12";
/** Fissures of the chewing teeth, the edge of the front teeth */
const CROWN_DETAIL: Record<ToothKind, string> = {
  incisor: "M15 63 C18 64.5 22 64.5 25 63",
  canine: "M17 62 L20 66 L23 62",
  premolar: "M14 57 C17 59 23 59 26 57",
  molar: "M10 56 C13 58 16 58 20 56 C24 58 27 58 30 56",
};

const TONE_FILL: Record<NonNullable<ToothMark["tone"]>, string> = {
  neon: "var(--neon)",
  ink: "#121214",
  soft: "var(--neon-soft)",
  done: "#d9d9dd",
};

/** One tooth as SVG: the silhouette of its kind, flipped for the lower jaw */
export const ToothGlyph = ({
  tooth,
  mark,
  selected,
  className,
}: {
  tooth: number;
  mark?: ToothMark;
  selected?: boolean;
  className?: string;
}) => {
  const kind = toothKind(tooth);
  const lower = jawOf(tooth) === "lower";
  const primary = dentitionOf(tooth) === "primary";
  const roots = rootCount(tooth);
  const fill = mark?.tone ? TONE_FILL[mark.tone] : "#fbfbfc";
  const ink = mark?.tone === "ink" ? "#fbfbfc" : "#121214";
  // Primary teeth are smaller; the lower jaw is the upper one upside down
  const transform = [
    lower ? `matrix(1 0 0 -1 0 ${VIEW_H})` : "",
    primary ? "translate(4 7.2) scale(0.8)" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className={cn("block h-auto w-full overflow-visible", className)}
      aria-hidden="true"
    >
      <g transform={transform || undefined}>
        <path
          d={OUTLINE[kind]}
          fill={fill}
          stroke="#121214"
          strokeOpacity={selected ? 1 : 0.55}
          strokeWidth={selected ? 2.2 : 1.1}
          strokeLinejoin="round"
        />
        {roots === 3 ? (
          <path
            d={EXTRA_ROOT}
            fill="none"
            stroke={ink}
            strokeOpacity="0.35"
            strokeWidth="1"
          />
        ) : null}
        {roots === 2 && kind === "premolar" ? (
          <path
            d={ROOT_SPLIT}
            fill="none"
            stroke={ink}
            strokeOpacity="0.3"
            strokeWidth="1"
          />
        ) : null}
        <path
          d={NECK[kind]}
          fill="none"
          stroke={ink}
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        <path
          d={CROWN_DETAIL[kind]}
          fill="none"
          stroke={ink}
          strokeOpacity="0.3"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
};

const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export const DentalChart = ({
  dentition: controlled,
  defaultDentition = "permanent",
  onDentitionChange,
  selected = [],
  onSelectedChange,
  areas = [],
  onAreasChange,
  marks = {},
  areaMarks = {},
  disabled,
  className,
}: DentalChartProps) => {
  const translate = useTranslate();
  const [own, setOwn] = useState<Dentition>(defaultDentition);
  const dentition = controlled ?? own;
  const setDentition = (next: Dentition) => {
    setOwn(next);
    onDentitionChange?.(next);
  };
  const rows = chartRows(dentition);
  const selectable = !!onSelectedChange && !disabled;
  const half = rows.upper.length / 2;

  const toothLabel = (tooth: number) =>
    translate("plan_editor.chart.tooth", { n: tooth });

  const column = (tooth: number) => {
    const mark = marks[tooth];
    const isSelected = selected.includes(tooth);
    const label = toothLabel(tooth);
    return (
      <div
        key={tooth}
        className="flex min-w-0 flex-1 flex-col items-center gap-1"
        data-tooth={tooth}
        data-marked={mark?.tone ? "true" : undefined}
      >
        <span
          className={cn(
            "text-[11px] tabular-nums",
            isSelected || mark?.tone === "neon"
              ? "font-semibold text-foreground"
              : "text-muted-foreground",
          )}
        >
          {tooth}
        </span>
        <button
          type="button"
          tabIndex={-1}
          disabled={!selectable}
          title={mark?.title ? `${label}: ${mark.title}` : label}
          aria-hidden="true"
          onClick={() => onSelectedChange?.(toggle(selected, tooth))}
          className={cn(
            "w-full max-w-11 rounded-xl px-0.5 py-1 transition-colors",
            selectable && "cursor-pointer hover:bg-pill",
            isSelected && "bg-pill",
          )}
        >
          <ToothGlyph tooth={tooth} mark={mark} selected={isSelected} />
        </button>
        {onSelectedChange ? (
          <input
            type="checkbox"
            checked={isSelected}
            disabled={disabled}
            aria-label={label}
            onChange={() => onSelectedChange(toggle(selected, tooth))}
            className="size-3.5 accent-primary"
          />
        ) : null}
      </div>
    );
  };

  const row = (teeth: number[], jaw: "upper" | "lower") => (
    <div
      className="flex items-end gap-4"
      role="group"
      aria-label={translate(`plan_editor.chart.${jaw}`)}
    >
      <div className="flex flex-1 gap-0.5">
        {teeth.slice(0, half).map(column)}
      </div>
      <div className="w-px self-stretch bg-foreground/15" aria-hidden />
      <div className="flex flex-1 gap-0.5">{teeth.slice(half).map(column)}</div>
    </div>
  );

  return (
    <div
      className={cn("flex flex-col gap-4", className)}
      data-testid="dental-chart"
    >
      <div
        className="flex w-fit gap-1 rounded-full bg-muted p-1"
        role="tablist"
        aria-label={translate("plan_editor.chart.title")}
      >
        {(["permanent", "primary"] as Dentition[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={dentition === value}
            onClick={() => setDentition(value)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm transition-colors",
              dentition === value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {translate(`plan_editor.chart.${value}`)}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-5",
          dentition === "primary" ? "max-w-[34rem]" : "max-w-[52rem]",
        )}
      >
        {row(rows.upper, "upper")}
        <div className="h-px bg-foreground/10" aria-hidden />
        {row(rows.lower, "lower")}
      </div>
      {onAreasChange || Object.keys(areaMarks).length ? (
        <div className="flex flex-wrap justify-center gap-2">
          {(["upper", "lower", "mouth"] as Area[]).map((area) => {
            const checked = areas.includes(area);
            const mark = areaMarks[area];
            return (
              <label
                key={area}
                title={mark?.title}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors",
                  checked
                    ? "bg-primary text-primary-foreground"
                    : mark?.tone === "neon"
                      ? "bg-neon text-neon-ink"
                      : "bg-pill text-foreground hover:bg-pill-hover",
                  (disabled || !onAreasChange) && "cursor-default",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || !onAreasChange}
                  onChange={() => onAreasChange?.(toggle(areas, area))}
                  className="size-3.5 accent-neon"
                />
                {translate(`plan_editor.chart.area.${area}`)}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
