import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useTranslate, type Identifier } from "ra-core";
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { patientDisplayName } from "../patients/parsePatientText";
import { minuteOfDay, type DayKey } from "../tasks/calendarLayout";
import type { Patient } from "../types";
import { textOn } from "./doctorColors";
import {
  blockBox,
  isUnconfirmedTomorrow,
  layoutVisits,
  parseHm,
  slotAt,
  slotCount,
  SLOT_MINUTES,
  toHm,
  visitMinutes,
  type GridRange,
  type Hours,
} from "./scheduleLayout";
import type { BusySlot, Visit } from "./types";
import { VisitDetails } from "./VisitDetails";
import { StatusGlyph } from "./StatusGlyph";
import { formatTime } from "./visitStyles";

/** Height of a 15-minute row, px (half an hour: 44 px, like a paper book) */
export const SLOT_HEIGHT = 22;
const DRAG_TYPE = "application/x-crm-visit";

/** A column of the grid: a doctor or a chair on a day */
export type GridColumn = {
  key: string;
  day: DayKey;
  /** Doctor or chair of the column (null: «без врача / кресла») */
  resourceId: Identifier | null;
  title: ReactNode;
  /** Color of the header band and of the visits without a doctor */
  color: string;
  /** Initials in the round badge of the header */
  badge?: string;
  /** Hours of the doctor that day (null: off); undefined: clinic hours */
  hours?: Hours | null;
  subtitle?: string;
  visits: Visit[];
  busy: BusySlot[];
};

/** What the hover card of a visit shows besides the visit itself */
export type VisitInfo = {
  patient?: Patient;
  service?: string;
  doctor?: string;
  chair?: string;
  author?: string;
  color: string;
};

type GridProps = {
  columns: GridColumn[];
  range: GridRange;
  timeZone: string;
  now: Date;
  today: DayKey;
  readOnly: boolean;
  info: (visit: Visit, column: GridColumn) => VisitInfo;
  onCreate: (column: GridColumn, minute: number) => void;
  onMove: (visit: Visit, column: GridColumn, minute: number) => void;
  onEdit: (visit: Visit) => void;
};

const readDrag = (event: React.DragEvent) => {
  try {
    return JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as {
      id: string;
      offset: number;
    };
  } catch {
    return null;
  }
};

const allowDrop = (event: React.DragEvent) => {
  if (event.dataTransfer.types.includes(DRAG_TYPE)) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
};

/** Minutes of a column the doctor does not work (hatched) */
const unavailable = (hours: Hours | null | undefined, range: GridRange) => {
  if (hours === undefined) return [];
  if (hours === null) return [{ start: range.start, end: range.end }];
  return [
    { start: range.start, end: hours.start },
    { start: hours.end, end: range.end },
    ...hours.breaks.map((pause) => ({
      start: parseHm(pause.start) ?? 0,
      end: parseHm(pause.end) ?? 0,
    })),
  ].filter((interval) => interval.end > interval.start);
};

const px = (minutes: number) => (minutes / SLOT_MINUTES) * SLOT_HEIGHT;

/** The time a doctor does not work: a flat gray, unlike the hatched visits */
const OFF_HOURS: CSSProperties = {
  backgroundColor: "color-mix(in oklab, var(--foreground) 7%, transparent)",
};

/**
 * The time grid of the schedule, like the appointment book of a clinic: a
 * colored column per doctor or chair (day) or per day (week of one doctor or
 * chair), half-hour lines over the clinic hours, the hours a doctor does not
 * work hatched. Headers and times stay in view while scrolling. Drag a visit
 * to another time or column, click an empty slot to book, point at a visit
 * for its details, click it for its status buttons.
 */
export const ScheduleGrid = ({
  columns,
  range,
  timeZone,
  now,
  today,
  readOnly,
  info,
  onCreate,
  onMove,
  onEdit,
}: GridProps) => {
  const translate = useTranslate();
  const rows = slotCount(range);
  const height = rows * SLOT_HEIGHT;
  const nowMinute = minuteOfDay(now, timeZone);
  const visitsById = new Map(
    columns.flatMap((column) =>
      column.visits.map((visit) => [String(visit.id), visit] as const),
    ),
  );

  return (
    <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={100}>
      <div
        className="max-h-[calc(100vh-15rem)] min-h-96 overflow-auto"
        data-testid="schedule-scroll"
      >
        <div
          className="grid min-w-fit"
          style={{
            gridTemplateColumns: `3.75rem repeat(${columns.length}, minmax(13.5rem, 1fr))`,
          }}
          data-testid="schedule-grid"
        >
          <div className="sticky top-0 left-0 z-40 border-b border-border bg-card" />
          {columns.map((column) => (
            <div
              key={column.key}
              className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-l border-card px-2.5"
              style={{
                backgroundColor: column.color,
                color: textOn(column.color),
              }}
              data-column={column.key}
              data-testid="schedule-column-header"
            >
              {column.badge ? (
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-black/25 text-[10px] font-bold tracking-wide"
                  aria-hidden
                >
                  {column.badge}
                </span>
              ) : null}
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[13px] font-bold">
                  {column.title}
                </div>
                {column.subtitle ? (
                  <div className="truncate text-[11px] opacity-85">
                    {column.subtitle}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          <div
            className="sticky left-0 z-20 border-r border-border bg-card"
            style={{ height }}
            aria-hidden
          >
            {Array.from({ length: rows }, (_, row) => {
              const minute = range.start + row * SLOT_MINUTES;
              return minute % 30 === 0 ? (
                <span
                  key={row}
                  className={cn(
                    "absolute right-2 -translate-y-1/2 text-xs tabular-nums",
                    minute % 60 === 0
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                  style={{ top: Math.max(row * SLOT_HEIGHT, 8) }}
                >
                  {toHm(minute)}
                </span>
              ) : null;
            })}
          </div>
          {columns.map((column) => {
            const blocks = layoutVisits(column.visits, column.day, timeZone);
            return (
              <div
                key={column.key}
                className="relative border-l border-border bg-card"
                style={{ height }}
                data-column={column.key}
                data-day={column.day}
                onDragOver={readOnly ? undefined : allowDrop}
                onDrop={(event) => {
                  const drag = readDrag(event);
                  if (!drag) return;
                  event.preventDefault();
                  const visit = visitsById.get(drag.id);
                  if (!visit) return;
                  const top = event.currentTarget.getBoundingClientRect().top;
                  onMove(
                    visit,
                    column,
                    slotAt(
                      event.clientY - top - drag.offset + SLOT_HEIGHT / 2,
                      SLOT_HEIGHT,
                      range,
                    ),
                  );
                }}
              >
                {unavailable(column.hours, range).map((interval) => (
                  <div
                    key={`${interval.start}-${interval.end}`}
                    className="pointer-events-none absolute inset-x-0"
                    style={{
                      ...OFF_HOURS,
                      top: px(interval.start - range.start),
                      height: px(interval.end - interval.start),
                    }}
                  />
                ))}
                {Array.from({ length: rows }, (_, row) => {
                  const minute = range.start + row * SLOT_MINUTES;
                  const end = minute + SLOT_MINUTES;
                  return (
                    <button
                      key={row}
                      type="button"
                      disabled={readOnly}
                      onClick={() => onCreate(column, minute)}
                      className={cn(
                        "group/slot relative block w-full border-b text-left transition-colors enabled:hover:bg-brand-link/10 disabled:cursor-default",
                        end % 60 === 0
                          ? "border-border"
                          : end % 30 === 0
                            ? "border-border/60"
                            : "border-dotted border-border/40",
                      )}
                      style={{ height: SLOT_HEIGHT }}
                      data-slot={toHm(minute)}
                      aria-label={translate("schedule.grid.new_visit_at", {
                        time: `${column.day} ${toHm(minute)}`,
                      })}
                    >
                      {readOnly ? null : (
                        <span className="pointer-events-none absolute left-2 top-1/2 hidden -translate-y-1/2 text-[11px] font-semibold text-brand-link group-hover/slot:inline">
                          + {toHm(minute)}
                        </span>
                      )}
                    </button>
                  );
                })}
                {column.busy.map((slot) => {
                  const box = visitMinutes(slot, timeZone);
                  if (box.day !== column.day) return null;
                  return (
                    <div
                      key={`busy-${slot.starts_at}-${slot.ends_at}`}
                      className="pointer-events-none absolute inset-x-1 flex items-start rounded-sm border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground"
                      style={{
                        ...OFF_HOURS,
                        top: px(box.start - range.start) + 1,
                        height: px(box.end - box.start) - 2,
                      }}
                    >
                      {translate("schedule.grid.busy")}
                    </div>
                  );
                })}
                {blocks.map((block) => {
                  const box = blockBox(block, range);
                  return (
                    <VisitBlock
                      key={block.item.id}
                      visit={block.item}
                      info={info(block.item, column)}
                      timeZone={timeZone}
                      now={now}
                      readOnly={readOnly}
                      onEdit={onEdit}
                      rows={box.height}
                      style={{
                        top: box.top * SLOT_HEIGHT + 1,
                        height: box.height * SLOT_HEIGHT - 2,
                        left: `calc(${box.left * 100}% + 3px)`,
                        width: `calc(${box.width * 100}% - 6px)`,
                      }}
                    />
                  );
                })}
                {column.day === today &&
                nowMinute >= range.start &&
                nowMinute < range.end ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive"
                    style={{ top: px(nowMinute - range.start) }}
                    title={translate("schedule.grid.now")}
                  >
                    <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-destructive" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </TooltipPrimitive.Provider>
  );
};

/** Missed and cancelled visits are marked in red, the others in the doctor's color */
const isRefused = (visit: Visit) =>
  visit.status === "no_show" || visit.status === "cancelled";

/**
 * A visit: a card with the doctor's color on its left edge, hatched in that
 * color, the status sign, the patient, «09:30 – 10:00», the service and the
 * comment as far as the card allows. Pointing at it shows everything.
 */
const VisitBlock = ({
  visit,
  info,
  timeZone,
  now,
  readOnly,
  onEdit,
  rows,
  style,
}: {
  visit: Visit;
  info: VisitInfo;
  timeZone: string;
  now: Date;
  readOnly: boolean;
  onEdit: (visit: Visit) => void;
  /** Height in 15-minute rows */
  rows: number;
  style: CSSProperties;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const name = patientDisplayName(info.patient) || "…";
  const unconfirmed = isUnconfirmedTomorrow(visit, now, timeZone);
  const draggable = !readOnly && visit.source === "crm";
  const color = isRefused(visit) ? "#E5484D" : info.color;
  const time = `${formatTime(visit.starts_at, timeZone)} – ${formatTime(visit.ends_at, timeZone)}`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipPrimitive.Root open={open ? false : undefined}>
        <PopoverTrigger asChild>
          <TooltipPrimitive.Trigger asChild>
            <button
              type="button"
              draggable={draggable}
              onDragStart={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  DRAG_TYPE,
                  JSON.stringify({
                    id: String(visit.id),
                    offset: event.clientY - rect.top,
                  }),
                );
              }}
              data-testid="visit-block"
              data-visit-id={visit.id}
              data-status={visit.status}
              className={cn(
                "absolute z-10 flex flex-col overflow-hidden rounded-sm border border-l-4 py-1 pr-5 pl-1.5 text-left text-foreground transition-shadow hover:z-30 hover:shadow-soft",
                draggable && "cursor-grab active:cursor-grabbing",
                visit.status === "cancelled" && "z-0 opacity-75",
                visit.status === "completed" && "opacity-80",
              )}
              style={{
                ...style,
                borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
                borderLeftColor: color,
                backgroundColor: `color-mix(in oklab, ${color} 7%, var(--card))`,
                backgroundImage: `repeating-linear-gradient(135deg, color-mix(in oklab, ${color} 11%, transparent) 0 9px, transparent 9px 18px)`,
              }}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <StatusGlyph
                  status={visit.status}
                  className="size-4 shrink-0"
                />
                <span
                  className={cn(
                    "truncate text-[13px] leading-tight font-semibold",
                    visit.status === "cancelled" && "line-through",
                  )}
                >
                  {name}
                </span>
                {unconfirmed ? (
                  <span
                    className="size-2 shrink-0 rounded-full bg-warn"
                    aria-label={translate("schedule.grid.unconfirmed")}
                  />
                ) : null}
              </span>
              {rows >= 2 ? (
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-5.5 text-[11.5px] leading-tight text-muted-foreground tabular-nums">
                  <span className="shrink-0">{time}</span>
                  {visit.source === "mis" ? (
                    <span className="rounded-sm border border-border px-1 text-[9.5px] font-bold tracking-wide">
                      {translate("schedule.mis.badge")}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {rows >= 3 && info.service ? (
                <span className="mt-1 truncate pl-5.5 text-[11.5px] leading-tight">
                  {info.service}
                </span>
              ) : null}
              {rows >= 4 && visit.note ? (
                <span className="mt-0.5 line-clamp-2 pl-5.5 text-[11px] leading-snug text-muted-foreground">
                  {visit.note}
                </span>
              ) : null}
              <span
                className="absolute top-1 right-1 flex h-4 w-3 flex-col items-center justify-center gap-[2px]"
                aria-hidden
              >
                <span className="size-[3px] rounded-full bg-muted-foreground" />
                <span className="size-[3px] rounded-full bg-muted-foreground" />
                <span className="size-[3px] rounded-full bg-muted-foreground" />
              </span>
            </button>
          </TooltipPrimitive.Trigger>
        </PopoverTrigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="right"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 w-80 rounded-md border border-border bg-popover p-3.5 text-popover-foreground shadow-soft"
            data-testid="visit-hover"
          >
            <VisitHover visit={visit} info={info} time={time} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
      <PopoverContent className="w-80 p-3" align="start">
        <VisitDetails
          visit={visit}
          onEdit={() => {
            setOpen(false);
            onEdit(visit);
          }}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
};

/** Everything about a visit, on hover */
const VisitHover = ({
  visit,
  info,
  time,
}: {
  visit: Visit;
  info: VisitInfo;
  time: string;
}) => {
  const translate = useTranslate();
  const phone =
    info.patient?.phones?.[0] ?? info.patient?.phone_jsonb?.[0]?.number;
  const rows: [string, ReactNode][] = [
    [translate("schedule.hover.time"), time],
    [translate("schedule.fields.patient"), patientDisplayName(info.patient)],
    [translate("schedule.hover.phone"), phone],
    [translate("schedule.fields.service"), info.service],
    [translate("schedule.fields.doctor"), info.doctor],
    [translate("schedule.fields.chair"), info.chair],
    [
      translate("schedule.hover.status"),
      <span key="status" className="inline-flex items-center gap-1.5">
        <StatusGlyph status={visit.status} className="size-3.5" />
        {translate(`schedule.statuses.${visit.status}`)}
      </span>,
    ],
    [
      translate("schedule.hover.author"),
      visit.source === "mis" ? translate("schedule.mis.badge") : info.author,
    ],
    [
      translate("schedule.hover.card"),
      info.patient ? `№ ${info.patient.id}` : null,
    ],
  ];
  return (
    <div className="flex flex-col gap-2 text-[13px]">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows
          .filter(([, value]) => value != null && value !== "")
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold">{label}:</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
      </dl>
      {visit.note ? (
        <div className="border-t border-border pt-2">
          <div className="text-xs text-muted-foreground">
            {translate("schedule.hover.note")}
          </div>
          <p className="whitespace-pre-line">{visit.note}</p>
        </div>
      ) : null}
    </div>
  );
};
