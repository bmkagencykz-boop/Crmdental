import {
  useDataProvider,
  useGetMany,
  useLocaleState,
  useNotify,
  useRefresh,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  findById,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import type { CrmDataProvider } from "../providers/types";
import {
  addDays,
  dayKeyOf,
  keyToDate,
  minuteOfDay,
  startOfWeek,
  todayKey,
  zonedMoment,
  type DayKey,
} from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Patient } from "../types";
import { ScheduleGrid, type GridColumn } from "./ScheduleGrid";
import {
  columnKeyOf,
  columnsFor,
  doctorHoursOn,
  findConflict,
  gridRange,
  hoursWarning,
  moveVisit,
  toHm,
  visitDuration,
  type GroupBy,
  type ScheduleView,
} from "./scheduleLayout";
import { VISIT_STATUSES, type Visit } from "./types";
import {
  useChairs,
  useDoctorExceptions,
  useScheduleBusy,
  useScheduleSettings,
  useVisits,
} from "./useSchedule";
import { VisitDialog, type VisitDraft } from "./VisitDialog";
import { STATUS_DOT } from "./visitStyles";

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

const isDay = (value: string | null): value is DayKey =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);

const formatDay = (
  key: DayKey,
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    ...options,
    timeZone: "UTC",
  }).format(keyToDate(key));

/**
 * «Расписание» (stage 28): the appointment book of the clinic. A day with a
 * column per doctor or per chair, or a week of one doctor or chair; 15-minute
 * rows over the clinic hours. Visits are colored by status; drag one to
 * another time or column, click an empty slot to book, click a visit for
 * its status buttons. In MIS mode the visits come from the MIS, read-only.
 * The state lives in the address: ?day=&view=&by=&id=
 */
export const SchedulePage = () => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const timeZone = useClinicTimeZone();
  const now = useNow();
  const today = todayKey(timeZone, now);
  const [params, setParams] = useSearchParams();
  const anchor = isDay(params.get("day")) ? params.get("day")! : today;
  const view: ScheduleView = params.get("view") === "week" ? "week" : "day";
  const groupBy: GroupBy = params.get("by") === "chair" ? "chair" : "doctor";
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) =>
      value == null ? next.delete(key) : next.set(key, value),
    );
    setParams(next, { replace: true });
  };

  const { hours: clinic, misKind } = useScheduleSettings();
  const readOnly = !!misKind;
  const { data: doctors } = useDoctors();
  const { data: chairs } = useChairs();
  const { data: services } = useServices();
  const resources = groupBy === "doctor" ? doctors : chairs;
  const activeResources = resources.filter((item) => item.is_active);
  const selectedId =
    params.get("id") ??
    (activeResources[0] ? String(activeResources[0].id) : "");

  const days = useMemo(
    () =>
      view === "day"
        ? [anchor]
        : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)),
    [view, anchor],
  );
  const from = useMemo(
    () => zonedMoment(days[0], 0, timeZone),
    [days, timeZone],
  );
  const to = useMemo(
    () => zonedMoment(addDays(days[days.length - 1], 1), 0, timeZone),
    [days, timeZone],
  );
  const { data: visits } = useVisits(from, to);
  const busy = useScheduleBusy(from, to);
  const { data: exceptions } = useDoctorExceptions(
    days[0],
    days[days.length - 1],
  );
  const patientIds = useMemo(
    () => Array.from(new Set(visits.map((visit) => String(visit.patient_id)))),
    [visits],
  );
  const { data: patientRows = [] } = useGetMany<Patient>(
    "patients",
    { ids: patientIds },
    { enabled: patientIds.length > 0 },
  );
  const patients = useMemo(
    () => new Map(patientRows.map((p) => [String(p.id), p])),
    [patientRows],
  );

  const hoursOf = (resourceId: Identifier | null, day: DayKey) =>
    groupBy === "doctor" && resourceId != null
      ? doctorHoursOn(findById(doctors, resourceId), day, exceptions, clinic)
      : clinic;
  const hoursLabel = (resourceId: Identifier | null, day: DayKey) => {
    const hours = hoursOf(resourceId, day);
    return hours
      ? `${toHm(hours.start)}–${toHm(hours.end)}`
      : translate("schedule.grid.day_off");
  };
  const busyOf = (resourceId: Identifier | null) =>
    busy.filter(
      (slot) =>
        resourceId != null &&
        String(groupBy === "doctor" ? slot.doctor_id : slot.chair_id) ===
          String(resourceId),
    );

  const columns: GridColumn[] =
    view === "day"
      ? columnsFor(
          resources,
          visits.filter(
            (visit) => dayKeyOf(visit.starts_at, timeZone) === anchor,
          ),
          groupBy,
          translate(
            groupBy === "doctor"
              ? "schedule.grid.no_doctor"
              : "schedule.grid.no_chair",
          ),
        ).map((column) => ({
          key: column.key,
          day: anchor,
          resourceId: column.id,
          title: column.name,
          hours:
            groupBy === "doctor" && column.id != null
              ? hoursOf(column.id, anchor)
              : undefined,
          subtitle:
            column.id != null && groupBy === "doctor"
              ? hoursLabel(column.id, anchor)
              : undefined,
          visits: visits.filter(
            (visit) => columnKeyOf(visit, groupBy) === column.key,
          ),
          busy: busyOf(column.id),
        }))
      : days.map((day) => {
          const resourceId = selectedId || null;
          return {
            key: day,
            day,
            resourceId,
            title: (
              <span className={cn(day === today && "text-brand-link")}>
                {formatDay(day, locale, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </span>
            ),
            hours:
              groupBy === "doctor" && resourceId
                ? hoursOf(resourceId, day)
                : undefined,
            subtitle:
              groupBy === "doctor" && resourceId
                ? hoursLabel(resourceId, day)
                : undefined,
            visits: visits.filter(
              (visit) => columnKeyOf(visit, groupBy) === String(resourceId),
            ),
            busy: busyOf(resourceId),
          };
        });

  const range = gridRange(
    clinic,
    columns.flatMap((column) => column.visits),
    days,
    timeZone,
  );

  const [draft, setDraft] = useState<VisitDraft | null>(null);
  const [editing, setEditing] = useState<Visit | null>(null);

  const resourcePatch = (column: GridColumn) =>
    groupBy === "doctor"
      ? { doctor_id: column.resourceId }
      : { chair_id: column.resourceId };

  const onCreate = (column: GridColumn, minute: number) => {
    const doctor =
      groupBy === "doctor" ? findById(doctors, column.resourceId) : undefined;
    setDraft({
      day: column.day,
      time: toHm(minute),
      duration: doctor?.visit_minutes ?? undefined,
      ...resourcePatch(column),
    });
  };

  const onMove = async (visit: Visit, column: GridColumn, minute: number) => {
    if (visit.source === "mis") {
      notify("schedule.mis.readonly", { type: "warning" });
      return;
    }
    const moved = {
      ...visit,
      ...moveVisit(visit, column.day, minute, timeZone),
      ...(view === "day" ? resourcePatch(column) : {}),
    };
    if (
      moved.starts_at === visit.starts_at &&
      moved.doctor_id === visit.doctor_id &&
      moved.chair_id === visit.chair_id
    ) {
      return;
    }
    const conflict = findConflict(moved, visits);
    if (conflict) {
      notify(`schedule.errors.${conflict.resource}_busy`, { type: "error" });
      return;
    }
    try {
      await dataProvider.update<Visit>("visits", {
        id: visit.id,
        data: {
          starts_at: moved.starts_at,
          ends_at: moved.ends_at,
          doctor_id: moved.doctor_id ?? null,
          chair_id: moved.chair_id ?? null,
        },
        previousData: visit,
      });
      // Outside the doctor's hours: moved anyway, with a warning
      const doctor = findById(doctors, moved.doctor_id);
      const warning = doctor
        ? hoursWarning(
            doctorHoursOn(doctor, column.day, exceptions, clinic),
            minute,
            minute + visitDuration(visit),
          )
        : null;
      notify(warning ? `schedule.warnings.${warning}` : "schedule.grid.moved", {
        type: warning ? "warning" : "info",
        messageArgs: { time: toHm(minute) },
      });
      refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };

  const title =
    view === "day"
      ? formatDay(anchor, locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : `${formatDay(days[0], locale, { day: "numeric", month: "short" })} – ${formatDay(days[6], locale, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="flex flex-col gap-3" data-testid="schedule-page">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 px-0"
          onClick={() =>
            update({ day: addDays(anchor, view === "day" ? -1 : -7) })
          }
          aria-label={translate("schedule.toolbar.previous")}
        >
          ‹
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => update({ day: null })}
        >
          {translate("schedule.toolbar.today")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 px-0"
          onClick={() =>
            update({ day: addDays(anchor, view === "day" ? 1 : 7) })
          }
          aria-label={translate("schedule.toolbar.next")}
        >
          ›
        </Button>
        <input
          type="date"
          value={anchor}
          onChange={(event) =>
            isDay(event.target.value) && update({ day: event.target.value })
          }
          aria-label={translate("schedule.toolbar.date")}
          className="field h-8 rounded-md border border-input px-2 text-sm"
        />
        <h2 className="ml-1 text-base font-semibold first-letter:uppercase">
          {title}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented
            label={translate("schedule.toolbar.view")}
            value={view}
            options={[
              { value: "day", label: translate("schedule.toolbar.day") },
              { value: "week", label: translate("schedule.toolbar.week") },
            ]}
            onChange={(value) =>
              update({ view: value === "day" ? null : value })
            }
          />
          <Segmented
            label={translate("schedule.toolbar.group")}
            value={groupBy}
            options={[
              { value: "doctor", label: translate("schedule.toolbar.doctors") },
              { value: "chair", label: translate("schedule.toolbar.chairs") },
            ]}
            onChange={(value) =>
              update({ by: value === "doctor" ? null : value, id: null })
            }
          />
          {view === "week" ? (
            <select
              value={selectedId}
              onChange={(event) => update({ id: event.target.value })}
              aria-label={translate(
                groupBy === "doctor"
                  ? "schedule.fields.doctor"
                  : "schedule.fields.chair",
              )}
              className="field h-8 max-w-56 rounded-md border border-input px-2 text-sm"
            >
              {resources
                .filter(
                  (item) => item.is_active || String(item.id) === selectedId,
                )
                .map((item) => (
                  <option key={item.id} value={String(item.id)}>
                    {item.name}
                  </option>
                ))}
            </select>
          ) : null}
          <Button
            size="sm"
            className="h-8"
            disabled={readOnly}
            onClick={() =>
              setDraft({
                day: anchor,
                time: toHm(Math.max(clinic.start, 9 * 60)),
                ...(view === "week" && selectedId
                  ? groupBy === "doctor"
                    ? { doctor_id: selectedId }
                    : { chair_id: selectedId }
                  : {}),
              })
            }
          >
            {translate("schedule.toolbar.book")}
          </Button>
        </div>
      </div>

      {readOnly ? (
        <p
          className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          {translate("schedule.mis.banner", {
            name: translate(`mis_connectors.name.${misKind}`, { _: misKind }),
          })}
        </p>
      ) : null}

      {columns.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
          {translate(
            groupBy === "doctor"
              ? "schedule.grid.no_doctors"
              : "schedule.grid.no_chairs",
          )}
        </p>
      ) : (
        <ScheduleGrid
          columns={columns}
          range={range}
          timeZone={timeZone}
          now={now}
          today={today}
          readOnly={readOnly}
          patients={patients}
          serviceName={(id) => findById(services, id)?.name}
          onCreate={onCreate}
          onMove={onMove}
          onEdit={setEditing}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <ul className="flex flex-wrap items-center gap-3">
          {VISIT_STATUSES.map((status) => (
            <li key={status} className="flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-sm", STATUS_DOT[status])} />
              {translate(`schedule.statuses.${status}`)}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-warn" />
            {translate("schedule.grid.unconfirmed")}
          </li>
        </ul>
        <span>{translate("schedule.grid.hint")}</span>
      </div>

      {draft ? (
        <VisitDialog open draft={draft} onClose={() => setDraft(null)} />
      ) : null}
      {editing ? (
        <VisitDialog
          open
          visit={editing}
          draft={{
            patient_id: editing.patient_id,
            deal_id: editing.deal_id ?? null,
            doctor_id: editing.doctor_id ?? null,
            chair_id: editing.chair_id ?? null,
            service_id: editing.service_id ?? null,
            day: dayKeyOf(editing.starts_at, timeZone),
            time: toHm(minuteOfDay(editing.starts_at, timeZone)),
            duration: visitDuration(editing),
            note: editing.note ?? "",
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
};

SchedulePage.path = "/schedule";

const Segmented = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) => (
  <div
    role="group"
    aria-label={label}
    className="flex h-8 overflow-hidden rounded-md border border-border"
  >
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "px-2.5 text-sm transition-colors",
          value === option.value
            ? "bg-primary font-semibold text-primary-foreground"
            : "bg-card hover:bg-accent",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);
