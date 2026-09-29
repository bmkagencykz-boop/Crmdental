import {
  useDataProvider,
  useGetList,
  useGetMany,
  useLocaleState,
  useNotify,
  useRefresh,
  useStore,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { SettingsGlyph } from "../layout/navGlyphs";
import type { Deal, Patient, Sale } from "../types";
import { doctorColor, NEUTRAL_COLOR } from "./doctorColors";
import { ScheduleGrid, type GridColumn, type VisitInfo } from "./ScheduleGrid";
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
import { COUNTED_STATUSES, firstVisitIds } from "./visitMarkers";
import {
  useChairs,
  useDoctorExceptions,
  useScheduleBusy,
  useScheduleSettings,
  useVisits,
} from "./useSchedule";
import { VisitDialog, type VisitDraft } from "./VisitDialog";
import { StatusGlyph } from "./StatusGlyph";
import { inBranch } from "../branches/branches";
import { useCurrentBranch } from "../branches/useBranches";
import {
  useWaitingCount,
  useWaitingRights,
} from "../waiting-list/useWaitingList";

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
  // «Лист ожидания (N)» (stage 38)
  const waitingRights = useWaitingRights();
  const waiting = useWaitingCount(waitingRights.canUse);
  const { data: doctors } = useDoctors();
  const { data: chairs } = useChairs();
  const { data: services } = useServices();
  // Branches (stage 33): the doctors and chairs of the chosen branch and
  // the shared ones; colors stay those of the whole clinic
  const { currentId: branchId } = useCurrentBranch();
  const branchDoctors = useMemo(
    () => inBranch(doctors, branchId),
    [doctors, branchId],
  );
  const branchChairs = useMemo(
    () => inBranch(chairs, branchId),
    [chairs, branchId],
  );
  const resources = groupBy === "doctor" ? branchDoctors : branchChairs;
  const activeResources = resources.filter((item) => item.is_active);
  const selectedId =
    params.get("id") ??
    (activeResources[0] ? String(activeResources[0].id) : "");
  // Doctors hidden from the day view, remembered per user
  const [hiddenDoctors, setHiddenDoctors] = useStore<string[]>(
    "schedule.hidden_doctors",
    [],
  );
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 200 },
    sort: { field: "last_name", order: "ASC" },
  });
  const colorOf = (resourceId: Identifier | null | undefined) => {
    if (resourceId == null) return NEUTRAL_COLOR;
    return groupBy === "doctor"
      ? doctorColor(findById(doctors, resourceId), doctors)
      : doctorColor(findById(chairs, resourceId), chairs);
  };

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
  const { data: allVisits } = useVisits(from, to);
  const visits = useMemo(
    () => inBranch(allVisits, branchId),
    [allVisits, branchId],
  );
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
  // «1В»: the first visit of a patient who never came before
  const { data: earlierVisits = [] } = useGetList<Visit>(
    "visits",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "starts_at", order: "DESC" },
      filter: {
        "patient_id@in": `(${patientIds.join(",")})`,
        "starts_at@lt": from.toISOString(),
        "status@in": `(${COUNTED_STATUSES.join(",")})`,
      },
    },
    { enabled: patientIds.length > 0 },
  );
  const firstVisits = useMemo(
    () => firstVisitIds(visits, earlierVisits),
    [visits, earlierVisits],
  );
  // «$»: the deal of the visit has a prepayment or a payment
  const dealIds = useMemo(
    () =>
      Array.from(
        new Set(
          visits
            .map((visit) => visit.deal_id)
            .filter((id) => id != null)
            .map(String),
        ),
      ),
    [visits],
  );
  const { data: dealRows = [] } = useGetMany<Deal>(
    "deals",
    { ids: dealIds },
    { enabled: dealIds.length > 0 },
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
        )
          .filter(
            (column) =>
              groupBy !== "doctor" ||
              column.id == null ||
              !hiddenDoctors.includes(String(column.id)),
          )
          .map((column) => ({
            key: column.key,
            day: anchor,
            resourceId: column.id,
            title: column.name,
            color: colorOf(column.id),
            badge: column.id != null ? initials(column.name) : undefined,
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
            color: colorOf(resourceId),
            title: (
              <span className={cn(day === today && "underline")}>
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

  const info = (visit: Visit, column: GridColumn): VisitInfo => {
    const author = findById(sales, visit.created_by);
    const doctor = findById(doctors, visit.doctor_id);
    return {
      patient: patients.get(String(visit.patient_id)),
      service: findById(services, visit.service_id)?.name,
      doctor: doctor?.name,
      chair: findById(chairs, visit.chair_id)?.name,
      author: author ? `${author.first_name} ${author.last_name}` : undefined,
      firstVisit: firstVisits.has(String(visit.id)),
      prepayment: findById(dealRows, visit.deal_id)?.prepayment_amount ?? 0,
      paid: findById(dealRows, visit.deal_id)?.paid_amount ?? 0,
      // The doctor's color, whatever the columns
      color: doctor ? doctorColor(doctor, doctors) : column.color,
    };
  };
  const shownDoctors = branchDoctors.filter(
    (doctor) => doctor.is_active && !hiddenDoctors.includes(String(doctor.id)),
  ).length;

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

  // «Записать повторно»: the same patient, deal, doctor, chair and service,
  // a week later at the same time; the dialog shows the free slots
  const onRebook = (visit: Visit) =>
    setDraft({
      patient_id: visit.patient_id,
      deal_id: visit.deal_id ?? null,
      doctor_id: visit.doctor_id ?? null,
      chair_id: visit.chair_id ?? null,
      service_id: visit.service_id ?? null,
      day: addDays(dayKeyOf(visit.starts_at, timeZone), 7),
      time: toHm(minuteOfDay(visit.starts_at, timeZone)),
      duration: visitDuration(visit),
    });

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
      ? `${formatDay(anchor, locale, { day: "numeric", month: "long", year: "numeric" })} (${formatDay(anchor, locale, { weekday: "long" })})`
      : `${formatDay(days[0], locale, { day: "numeric", month: "short" })} – ${formatDay(days[6], locale, { day: "numeric", month: "short", year: "numeric" })}`;
  const dateLabel =
    view === "day"
      ? formatDay(anchor, locale, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : title;
  const newVisit = () =>
    setDraft({
      day: anchor,
      time: toHm(Math.max(clinic.start, 9 * 60)),
      ...(view === "week" && selectedId
        ? groupBy === "doctor"
          ? { doctor_id: selectedId }
          : { chair_id: selectedId }
        : {}),
    });

  return (
    <div className="flex flex-col gap-4" data-testid="schedule-page">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-base font-semibold">
            {translate("schedule.toolbar.label")}
          </span>
          <Choice
            label={translate("schedule.toolbar.view")}
            value={view}
            options={[
              { value: "day", label: translate("schedule.toolbar.per_day") },
              { value: "week", label: translate("schedule.toolbar.per_week") },
            ]}
            onChange={(value) =>
              update({ view: value === "day" ? null : value })
            }
          />
          <Choice
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
            <Choice
              label={translate(
                groupBy === "doctor"
                  ? "schedule.fields.doctor"
                  : "schedule.fields.chair",
              )}
              value={selectedId}
              options={resources
                .filter(
                  (item) => item.is_active || String(item.id) === selectedId,
                )
                .map((item) => ({ value: String(item.id), label: item.name }))}
              onChange={(value) => update({ id: value })}
            />
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {view === "day" &&
          groupBy === "doctor" &&
          branchDoctors.length > 0 ? (
            <DoctorFilter
              doctors={branchDoctors.filter((doctor) => doctor.is_active)}
              hidden={hiddenDoctors}
              onChange={setHiddenDoctors}
              label={translate("schedule.toolbar.doctors_shown", {
                count: shownDoctors,
              })}
              colorOf={(doctor) => doctorColor(doctor, doctors)}
            />
          ) : null}
          <div className="flex h-9 items-center rounded-md border border-border bg-card">
            <button
              type="button"
              className="flex h-full w-9 items-center justify-center rounded-l-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() =>
                update({ day: addDays(anchor, view === "day" ? -1 : -7) })
              }
              aria-label={translate("schedule.toolbar.previous")}
            >
              ‹
            </button>
            <label className="relative flex h-full min-w-40 cursor-pointer items-center justify-center px-2 text-sm font-medium tabular-nums hover:bg-accent">
              {dateLabel}
              <input
                type="date"
                value={anchor}
                onChange={(event) =>
                  isDay(event.target.value) &&
                  update({ day: event.target.value })
                }
                onClick={(event) => {
                  try {
                    event.currentTarget.showPicker();
                  } catch {
                    // Older browsers: the field itself takes the date
                  }
                }}
                aria-label={translate("schedule.toolbar.date")}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <button
              type="button"
              className="flex h-full w-9 items-center justify-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() =>
                update({ day: addDays(anchor, view === "day" ? 1 : 7) })
              }
              aria-label={translate("schedule.toolbar.next")}
            >
              ›
            </button>
          </div>
          <Button
            variant="outline"
            className="h-9"
            disabled={anchor === today}
            onClick={() => update({ day: null })}
          >
            {translate("schedule.toolbar.today")}
          </Button>
          <Button
            asChild
            variant="outline"
            className="size-9 p-0"
            title={translate("schedule.toolbar.settings")}
          >
            <Link
              to="/settings?section=schedule"
              aria-label={translate("schedule.toolbar.settings")}
            >
              <SettingsGlyph className="size-4" />
            </Link>
          </Button>
          {waitingRights.canUse ? (
            <Button
              asChild
              variant="outline"
              className={cn(
                "h-9 px-4",
                waiting.freed > 0 && "bg-neon text-neon-ink hover:bg-neon/90",
              )}
            >
              <Link to="/waiting-list" data-testid="schedule-waiting-list">
                {translate("waiting_list.schedule_button", {
                  count: waiting.total,
                })}
              </Link>
            </Button>
          ) : null}
          <Button
            className="h-9 px-5 font-semibold"
            disabled={readOnly}
            onClick={newVisit}
          >
            + {translate("schedule.toolbar.new_visit")}
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

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-3">
          <h2 className="text-base font-bold first-letter:uppercase">
            {title}
          </h2>
          <span className="text-sm text-muted-foreground">
            {translate("schedule.grid.count", {
              smart_count: columns.reduce(
                (sum, column) =>
                  sum +
                  column.visits.filter((visit) => visit.status !== "cancelled")
                    .length,
                0,
              ),
            })}
          </span>
          <ul className="ml-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
            {VISIT_STATUSES.map((status) => (
              <li key={status} className="flex items-center gap-1.5">
                <StatusGlyph status={status} className="size-3.5" />
                {translate(`schedule.statuses.${status}`)}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-warn" />
              {translate("schedule.grid.unconfirmed")}
            </li>
          </ul>
        </div>
        {columns.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {translate(
              groupBy === "doctor"
                ? view === "day" &&
                  branchDoctors.some((doctor) => doctor.is_active)
                  ? "schedule.grid.all_hidden"
                  : "schedule.grid.no_doctors"
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
            info={info}
            onCreate={onCreate}
            onMove={onMove}
            onEdit={setEditing}
            onRebook={onRebook}
          />
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        {translate("schedule.grid.hint")}
      </p>

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

/** «На день ▾»: the current choice as a link, the others in a menu */
const Choice = ({
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
  <DropdownMenu>
    <DropdownMenuTrigger
      className="flex items-center gap-1 text-base font-medium text-brand-link outline-none hover:underline focus-visible:underline"
      aria-label={label}
    >
      {options.find((option) => option.value === value)?.label ?? label}
      <span className="text-xs" aria-hidden>
        ▾
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="max-h-80 min-w-44">
      <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
        {options.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

/** «Выбрано врачей: 6»: which doctors the day shows */
const DoctorFilter = ({
  doctors,
  hidden,
  onChange,
  label,
  colorOf,
}: {
  doctors: { id: Identifier; name: string; color?: string | null }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  label: string;
  colorOf: (doctor: { id: Identifier; color?: string | null }) => string;
}) => {
  const translate = useTranslate();
  const toggle = (id: string, shown: boolean) =>
    onChange(shown ? hidden.filter((item) => item !== id) : [...hidden, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 px-4 font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-2 text-xs">
          <button
            type="button"
            className="font-medium text-brand-link hover:underline"
            onClick={() => onChange([])}
          >
            {translate("schedule.toolbar.show_all")}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:underline"
            onClick={() => onChange(doctors.map((doctor) => String(doctor.id)))}
          >
            {translate("schedule.toolbar.hide_all")}
          </button>
        </div>
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {doctors.map((doctor) => {
            const id = String(doctor.id);
            const shown = !hidden.includes(id);
            return (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  <Checkbox
                    checked={shown}
                    onCheckedChange={(checked) => toggle(id, checked === true)}
                  />
                  <span
                    className="size-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: colorOf(doctor) }}
                  />
                  <span className="truncate">{doctor.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
};

/** «Мухамеджанова Дана» → «МД» */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
