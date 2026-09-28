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
import { formatTime, STATUS_BLOCK } from "./visitStyles";

/** Height of a 15-minute row, px */
export const SLOT_HEIGHT = 20;
const DRAG_TYPE = "application/x-crm-visit";

/** A column of the grid: a doctor or a chair on a day */
export type GridColumn = {
  key: string;
  day: DayKey;
  /** Doctor or chair of the column (null: «без врача / кресла») */
  resourceId: Identifier | null;
  title: ReactNode;
  /** Hours of the doctor that day (null: off); undefined: clinic hours */
  hours?: Hours | null;
  subtitle?: string;
  visits: Visit[];
  busy: BusySlot[];
};

type GridProps = {
  columns: GridColumn[];
  range: GridRange;
  timeZone: string;
  now: Date;
  today: DayKey;
  readOnly: boolean;
  patients: Map<string, Patient>;
  serviceName: (id: Identifier | null | undefined) => string | undefined;
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

/** Minutes of a column the doctor does not work (shaded) */
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

/**
 * The time grid of the schedule: 15-minute rows over the clinic hours, a
 * column per doctor / chair (day) or per day (week of one doctor or chair).
 * Hours the doctor does not work are shaded. Drag a visit to another time
 * or column, click an empty slot to book, click a visit for its popover.
 */
export const ScheduleGrid = ({
  columns,
  range,
  timeZone,
  now,
  today,
  readOnly,
  patients,
  serviceName,
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
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `3.25rem repeat(${columns.length}, minmax(8.5rem, 1fr))`,
        }}
        data-testid="schedule-grid"
      >
        <div className="sticky left-0 z-20 border-b border-border bg-card" />
        {columns.map((column) => (
          <div
            key={column.key}
            className="border-b border-l border-border px-2 py-1.5 text-xs"
            data-column={column.key}
          >
            <div className="truncate font-semibold">{column.title}</div>
            {column.subtitle ? (
              <div
                className={cn(
                  "truncate text-[11px] text-muted-foreground",
                  column.hours === null && "text-warn",
                )}
              >
                {column.subtitle}
              </div>
            ) : null}
          </div>
        ))}

        <div
          className="sticky left-0 z-20 bg-card"
          style={{ height }}
          aria-hidden
        >
          {Array.from({ length: rows }, (_, row) => {
            const minute = range.start + row * SLOT_MINUTES;
            return minute % 60 === 0 ? (
              <span
                key={row}
                className="absolute right-1.5 text-[11px] tabular-nums text-muted-foreground"
                style={{ top: row * SLOT_HEIGHT + 1 }}
              >
                {toHm(minute).replace(/^0/, "")}
              </span>
            ) : null;
          })}
        </div>
        {columns.map((column) => {
          const blocks = layoutVisits(column.visits, column.day, timeZone);
          return (
            <div
              key={column.key}
              className="relative border-l border-border"
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
                  className="pointer-events-none absolute inset-x-0 bg-muted/60"
                  style={{
                    top:
                      ((interval.start - range.start) / SLOT_MINUTES) *
                      SLOT_HEIGHT,
                    height:
                      ((interval.end - interval.start) / SLOT_MINUTES) *
                      SLOT_HEIGHT,
                  }}
                />
              ))}
              {Array.from({ length: rows }, (_, row) => {
                const minute = range.start + row * SLOT_MINUTES;
                return (
                  <button
                    key={row}
                    type="button"
                    disabled={readOnly}
                    onClick={() => onCreate(column, minute)}
                    className={cn(
                      "relative block w-full border-b transition-colors enabled:hover:bg-accent/70 disabled:cursor-default",
                      minute % 60 === 45
                        ? "border-border/80"
                        : "border-border/30 border-dashed",
                    )}
                    style={{ height: SLOT_HEIGHT }}
                    data-slot={toHm(minute)}
                    aria-label={translate("schedule.grid.new_visit_at", {
                      time: `${column.day} ${toHm(minute)}`,
                    })}
                  />
                );
              })}
              {column.busy.map((slot) => {
                const box = visitMinutes(slot, timeZone);
                if (box.day !== column.day) return null;
                return (
                  <div
                    key={`busy-${slot.starts_at}-${slot.ends_at}`}
                    className="pointer-events-none absolute inset-x-0.5 flex items-start rounded-md border border-dashed border-border bg-muted px-1.5 text-[11px] text-muted-foreground"
                    style={{
                      top:
                        ((box.start - range.start) / SLOT_MINUTES) *
                          SLOT_HEIGHT +
                        1,
                      height:
                        ((box.end - box.start) / SLOT_MINUTES) * SLOT_HEIGHT -
                        2,
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
                    patient={patients.get(String(block.item.patient_id))}
                    serviceName={serviceName(block.item.service_id)}
                    timeZone={timeZone}
                    now={now}
                    readOnly={readOnly}
                    onEdit={onEdit}
                    compact={box.height <= 2}
                    style={{
                      top: box.top * SLOT_HEIGHT + 1,
                      height: box.height * SLOT_HEIGHT - 2,
                      left: `calc(${box.left * 100}% + 2px)`,
                      width: `calc(${box.width * 100}% - 4px)`,
                    }}
                  />
                );
              })}
              {column.day === today &&
              nowMinute >= range.start &&
              nowMinute < range.end ? (
                <div
                  className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive"
                  style={{
                    top:
                      ((nowMinute - range.start) / SLOT_MINUTES) * SLOT_HEIGHT,
                  }}
                  title={translate("schedule.grid.now")}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** A visit: colored by status, patient and service, phone on hover */
const VisitBlock = ({
  visit,
  patient,
  serviceName,
  timeZone,
  now,
  readOnly,
  onEdit,
  compact,
  style,
}: {
  visit: Visit;
  patient?: Patient;
  serviceName?: string;
  timeZone: string;
  now: Date;
  readOnly: boolean;
  onEdit: (visit: Visit) => void;
  compact: boolean;
  style: CSSProperties;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(false);
  const name = patientDisplayName(patient) || "…";
  const phone = patient?.phones?.[0] ?? patient?.phone_jsonb?.[0]?.number;
  const unconfirmed = isUnconfirmedTomorrow(visit, now, timeZone);
  const draggable = !readOnly && visit.source === "crm";
  const hint = [
    `${formatTime(visit.starts_at, timeZone)}–${formatTime(visit.ends_at, timeZone)}`,
    name,
    phone,
    serviceName,
    translate(`schedule.statuses.${visit.status}`),
    unconfirmed ? translate("schedule.grid.unconfirmed") : null,
    visit.source === "mis" ? translate("schedule.mis.badge") : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
          title={hint}
          data-testid="visit-block"
          data-visit-id={visit.id}
          data-status={visit.status}
          className={cn(
            "absolute z-10 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight text-foreground shadow-card transition-shadow hover:z-30 hover:shadow-soft",
            STATUS_BLOCK[visit.status],
            draggable && "cursor-grab active:cursor-grabbing",
            visit.status === "cancelled" && "z-0 opacity-70",
          )}
          style={style}
        >
          {unconfirmed ? (
            <span
              className="absolute right-1 top-1 size-1.5 rounded-full bg-warn"
              aria-label={translate("schedule.grid.unconfirmed")}
            />
          ) : null}
          <span className={cn("block truncate", compact && "inline")}>
            <span className="font-semibold tabular-nums">
              {formatTime(visit.starts_at, timeZone)}
            </span>{" "}
            <span className="font-medium">{name}</span>
          </span>
          {!compact && serviceName ? (
            <span className="block truncate text-muted-foreground">
              {serviceName}
            </span>
          ) : null}
          {!compact && visit.source === "mis" ? (
            <span className="block text-[10px] font-semibold tracking-wide text-muted-foreground">
              {translate("schedule.mis.badge")}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
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
