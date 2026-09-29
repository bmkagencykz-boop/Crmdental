import {
  useDataProvider,
  useGetList,
  useGetMany,
  useLocaleState,
  useNotify,
  useTranslate,
} from "ra-core";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useBranches, useCurrentBranch } from "../branches/useBranches";
import {
  findById,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import { Molar3D, Sphere3D } from "../misc/Dental3D";
import { NativeSelect } from "../payments/PaymentDialog";
import { patientDisplayName } from "../patients/parsePatientText";
import type { Visit } from "../schedule/types";
import {
  useDoctorExceptions,
  useScheduleBusy,
  useScheduleSettings,
  useVisits,
} from "../schedule/useSchedule";
import { VisitDialog, type VisitDraft } from "../schedule/VisitDialog";
import { toHm } from "../schedule/scheduleLayout";
import {
  addDays,
  dayKeyOf,
  minuteOfDay,
  todayKey,
  zonedMoment,
} from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Patient, Sale } from "../types";
import { shortDay, slotLabel } from "./format";
import { OfferDialog } from "./OfferDialog";
import type { WaitingEntry } from "./types";
import {
  useRefreshWaiting,
  useWaitingEntries,
  useWaitingRights,
} from "./useWaitingList";
import { WaitingEntryDialog } from "./WaitingEntryDialog";
import {
  filterEntries,
  freedSlotOf,
  groupEntries,
  isActiveEntry,
  LONG_WAIT_DAYS,
  nearestSlots,
  waitingDays,
  WAITING_GROUPS,
  type FreeSlot,
  type Slot,
} from "./waitingMatch";
import { CountUp } from "../misc/CountUp";

const ALL = "all";
/** How far ahead the nearest slots are looked for */
const HORIZON_DAYS = 21;

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
};

const fullName = (sale?: Pick<Sale, "first_name" | "last_name">) =>
  sale ? [sale.first_name, sale.last_name].filter(Boolean).join(" ") : "";

/**
 * «Лист ожидания» (stage 38): patients waiting for a convenient time,
 * grouped by urgency and age, filtered by doctor, service and branch. Each
 * entry shows its wishes and the nearest free slots that match them
 * (doctors' hours and visits, findFreeSlots) with «Записать» (the visit
 * dialog, prefilled; the entry becomes «Записан») and «Предложить» (a
 * message to the patient). A slot freed by a cancellation or a no-show is
 * highlighted on the entries that fit it.
 */
export const WaitingListPage = () => {
  const translate = useTranslate();
  const rights = useWaitingRights();
  const timeZone = useClinicTimeZone();
  const now = useNow();
  const today = todayKey(timeZone, now);
  const { data: doctors } = useDoctors();
  const { data: services } = useServices();
  const { branches, enabled: branchesOn } = useBranches();
  const { currentId: currentBranch } = useCurrentBranch();
  const [doctorFilter, setDoctorFilter] = useState<string>(ALL);
  const [serviceFilter, setServiceFilter] = useState<string>(ALL);
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const branchValue =
    branchFilter ?? (currentBranch != null ? String(currentBranch) : ALL);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);

  const { data: entries, isPending } = useWaitingEntries({}, rights.canUse);
  const shown = useMemo(
    () =>
      filterEntries(entries, {
        doctorId: doctorFilter === ALL ? null : doctorFilter,
        serviceId: serviceFilter === ALL ? null : serviceFilter,
        branchId: branchValue === ALL ? null : branchValue,
      }),
    [entries, doctorFilter, serviceFilter, branchValue],
  );
  const groups = useMemo(() => groupEntries(shown, now), [shown, now]);
  const active = shown.filter(isActiveEntry);

  // The schedule of the next three weeks: hours, visits, busy time
  const { hours: clinic, misKind } = useScheduleSettings();
  const from = useMemo(
    () => zonedMoment(today, 0, timeZone),
    [today, timeZone],
  );
  const to = useMemo(
    () => zonedMoment(addDays(today, HORIZON_DAYS), 0, timeZone),
    [today, timeZone],
  );
  const { data: visits } = useVisits(from, to, {}, rights.canUse);
  const busy = useScheduleBusy(from, to);
  const { data: exceptions } = useDoctorExceptions(
    today,
    addDays(today, HORIZON_DAYS),
  );
  const slotsOf = useMemo(() => {
    const map = new Map<string, FreeSlot[]>();
    for (const entry of active) {
      map.set(
        String(entry.id),
        nearestSlots({
          entry,
          doctors,
          visits,
          busy,
          exceptions,
          clinic,
          timeZone,
          now,
          days: HORIZON_DAYS,
          limit: 3,
          serviceMinutes: findById(services, entry.service_id ?? undefined)
            ?.duration_minutes,
        }),
      );
    }
    return map;
    // `active` follows `shown`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    shown,
    doctors,
    visits,
    busy,
    exceptions,
    clinic,
    timeZone,
    now,
    services,
  ]);

  const patientIds = useMemo(
    () => Array.from(new Set(shown.map((entry) => String(entry.patient_id)))),
    [shown],
  );
  const { data: patientRows = [] } = useGetMany<Patient>(
    "patients",
    { ids: patientIds },
    { enabled: patientIds.length > 0 },
  );
  const patients = useMemo(
    () => new Map(patientRows.map((row) => [String(row.id), row])),
    [patientRows],
  );
  const { data: sales = [] } = useGetList<Sale>("sales", {
    pagination: { page: 1, perPage: 500 },
    sort: { field: "last_name", order: "ASC" },
  });

  if (rights.isPending) return null;
  if (!rights.canUse) return <Navigate to="/" replace />;

  const freedCount = active.filter((entry) => freedSlotOf(entry, now)).length;
  const urgentCount = active.filter(
    (entry) => entry.priority === "urgent",
  ).length;

  return (
    <div className="flex flex-col gap-5" data-testid="waiting-list-page">
      <div className="flex flex-wrap items-end gap-3">
        {/* The title is the page title of the layout */}
        <span className="mr-auto" />
        <Filter
          label={translate("waiting_list.filters.doctor")}
          value={doctorFilter}
          onChange={setDoctorFilter}
          options={doctors
            .filter((doctor) => doctor.is_active)
            .map((doctor) => ({
              value: String(doctor.id),
              label: doctor.name,
            }))}
        />
        <Filter
          label={translate("waiting_list.filters.service")}
          value={serviceFilter}
          onChange={setServiceFilter}
          options={services
            .filter((service) =>
              entries.some(
                (entry) => String(entry.service_id) === String(service.id),
              ),
            )
            .map((service) => ({
              value: String(service.id),
              label: service.name,
            }))}
        />
        {branchesOn ? (
          <Filter
            label={translate("waiting_list.filters.branch")}
            value={branchValue}
            onChange={setBranchFilter}
            options={branches.map((branch) => ({
              value: String(branch.id),
              label: branch.name,
            }))}
          />
        ) : null}
        <Button
          variant="outline"
          className="h-11"
          onClick={() => setShowClosed((value) => !value)}
          aria-pressed={showClosed}
        >
          {translate(
            showClosed
              ? "waiting_list.filters.hide_closed"
              : "waiting_list.filters.show_closed",
          )}
        </Button>
        <Button
          className="h-11 px-5"
          onClick={() => setAdding(true)}
          data-testid="waiting-add"
        >
          + {translate("waiting_list.add")}
        </Button>
      </div>

      <section
        className="relative flex min-h-[11rem] flex-col overflow-hidden rounded-[28px] bg-neon p-6 text-neon-ink"
        aria-label={translate("waiting_list.title")}
      >
        <p className="max-w-xl text-sm opacity-80">
          {translate("waiting_list.hero.hint")}
        </p>
        <div className="mt-auto flex flex-wrap items-end gap-x-10 gap-y-3 pt-6">
          <HeroNumber
            value={active.length}
            label={translate("waiting_list.hero.waiting")}
            testId="waiting-count"
          />
          <HeroNumber
            value={freedCount}
            label={translate("waiting_list.hero.freed")}
            testId="waiting-freed"
          />
          <HeroNumber
            value={urgentCount}
            label={translate("waiting_list.hero.urgent")}
          />
        </div>
        <Molar3D className="pointer-events-none absolute -top-3 right-6 size-40 opacity-95" />
        <Sphere3D tone="soft" size={34} style={{ right: 190, top: 26 }} />
        <Sphere3D tone="neon" size={20} style={{ right: 160, bottom: 30 }} />
      </section>

      {isPending ? null : shown.length === 0 ? (
        <EmptyState
          filtered={entries.length > 0}
          onAdd={() => setAdding(true)}
        />
      ) : (
        WAITING_GROUPS.filter(
          (group) => groups[group].length && (group !== "closed" || showClosed),
        ).map((group) => (
          <section
            key={group}
            className="flex flex-col gap-3"
            data-testid={`waiting-group-${group}`}
          >
            <div className="flex items-baseline gap-3 px-1">
              <h2 className="text-[22px] leading-tight font-normal tracking-[-0.02em]">
                {translate(`waiting_list.groups.${group}`)}
              </h2>
              <span className="rounded-full bg-card px-2.5 py-0.5 text-sm tabular-nums">
                {groups[group].length}
              </span>
              <span className="text-sm text-muted-foreground">
                {translate(`waiting_list.groups_hint.${group}`, {
                  days: LONG_WAIT_DAYS,
                })}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {groups[group].map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  patient={patients.get(String(entry.patient_id))}
                  slots={slotsOf.get(String(entry.id)) ?? []}
                  sales={sales}
                  now={now}
                  readOnlySchedule={!!misKind}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {adding ? (
        <WaitingEntryDialog
          open
          onClose={() => setAdding(false)}
          draft={{
            doctor_id: doctorFilter === ALL ? null : doctorFilter,
            branch_id: branchValue === ALL ? null : branchValue,
          }}
        />
      ) : null}
    </div>
  );
};

WaitingListPage.path = "/waiting-list";

const HeroNumber = ({
  value,
  label,
  testId,
}: {
  value: number;
  label: string;
  testId?: string;
}) => (
  <p className="flex items-baseline gap-2">
    <span
      className="text-[52px] leading-none font-light tracking-[-0.04em] tabular-nums"
      data-testid={testId}
    >
      <CountUp>{value}</CountUp>
    </span>
    <span className="text-base font-light">{label}</span>
  </p>
);

const Filter = ({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) => {
  const translate = useTranslate();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="px-1 text-xs text-muted-foreground">{label}</span>
      <NativeSelect value={value} onChange={onChange} aria-label={label}>
        <option value={ALL}>{translate("waiting_list.filters.all")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
};

const EmptyState = ({
  filtered,
  onAdd,
}: {
  filtered: boolean;
  onAdd: () => void;
}) => {
  const translate = useTranslate();
  return (
    <section className="relative flex flex-col items-start gap-3 overflow-hidden rounded-[28px] bg-card p-8">
      <h2 className="text-[22px] font-normal tracking-[-0.02em]">
        {translate(
          filtered ? "waiting_list.empty.filtered" : "waiting_list.empty.title",
        )}
      </h2>
      {filtered ? null : (
        <>
          <p className="max-w-lg text-sm text-muted-foreground">
            {translate("waiting_list.empty.text")}
          </p>
          <Button onClick={onAdd}>+ {translate("waiting_list.add")}</Button>
        </>
      )}
      <Molar3D
        tone="soft"
        className="pointer-events-none absolute -right-4 -bottom-6 size-40 opacity-80"
      />
    </section>
  );
};

/** Status chip: black for «Предложено», pink for «Записан» */
const StatusChip = ({ entry }: { entry: WaitingEntry }) => {
  const translate = useTranslate();
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs whitespace-nowrap",
        entry.status === "waiting" && "bg-muted",
        entry.status === "offered" && "bg-tone-violet/15 text-tone-violet",
        entry.status === "booked" && "bg-tone-green/15 text-tone-green",
        entry.status === "cancelled" &&
          "bg-muted text-muted-foreground line-through",
      )}
      data-testid="waiting-status"
    >
      {translate(`waiting_list.statuses.${entry.status}`)}
    </span>
  );
};

/**
 * One entry: the patient, the doctor and the service, the wishes as chips,
 * the freed slot (highlighted), the nearest free slots with «Записать» and
 * «Предложить», and the actions.
 */
export const EntryCard = ({
  entry,
  patient,
  slots,
  sales,
  now,
  readOnlySchedule,
  compact = false,
}: {
  entry: WaitingEntry;
  patient?: Patient;
  slots: FreeSlot[];
  sales: Sale[];
  now: Date;
  readOnlySchedule?: boolean;
  compact?: boolean;
}) => {
  const translate = useTranslate();
  const [locale] = useLocaleState();
  const notify = useNotify();
  const dataProvider = useDataProvider();
  const refreshWaiting = useRefreshWaiting();
  const rights = useWaitingRights();
  const timeZone = useClinicTimeZone();
  const { data: doctors } = useDoctors();
  const { data: services } = useServices();
  const [editing, setEditing] = useState(false);
  const [offering, setOffering] = useState<Slot | null>(null);
  const [booking, setBooking] = useState<VisitDraft | null>(null);
  const active = isActiveEntry(entry);
  const freed = freedSlotOf(entry, now);
  const doctor = findById(doctors, entry.doctor_id ?? undefined);
  const service = findById(services, entry.service_id ?? undefined);
  const responsible = findById(sales, entry.sales_id ?? undefined);
  const author = findById(sales, entry.created_by ?? undefined);
  const days = waitingDays(entry, now);

  const patch = async (data: Partial<WaitingEntry>, message: string) => {
    try {
      await dataProvider.update<WaitingEntry>("waiting_list", {
        id: entry.id,
        data,
        previousData: entry,
      });
      notify(message, { type: "info" });
      refreshWaiting();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };
  const remove = async () => {
    if (!window.confirm(translate("waiting_list.card.delete_confirm"))) return;
    try {
      await dataProvider.delete("waiting_list", {
        id: entry.id,
        previousData: entry,
      });
      notify("waiting_list.notify.deleted", { type: "info" });
      refreshWaiting();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    }
  };
  const book = (slot: Slot) => {
    const minutes = Math.round(
      (new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) /
        60000,
    );
    setBooking({
      patient_id: entry.patient_id,
      deal_id: entry.deal_id ?? null,
      doctor_id: slot.doctor_id ?? entry.doctor_id ?? null,
      service_id: entry.service_id ?? null,
      day: dayKeyOf(slot.starts_at, timeZone),
      time: toHm(minuteOfDay(slot.starts_at, timeZone)),
      duration: minutes > 0 ? minutes : undefined,
      note: entry.comment ?? null,
    });
  };
  const onBooked = (visit: Visit) =>
    patch({ visit_id: visit.id }, "waiting_list.notify.booked");

  const wishes = [
    entry.date_to
      ? translate("waiting_list.card.period", {
          from: shortDay(entry.date_from, locale),
          to: shortDay(entry.date_to, locale),
        })
      : translate("waiting_list.card.period_open", {
          from: shortDay(entry.date_from, locale),
        }),
    ...(entry.weekdays?.length
      ? [
          entry.weekdays
            .map((day) => translate(`waiting_list.weekdays_short.${day}`))
            .join(", "),
        ]
      : []),
    ...(entry.day_parts ?? []).map((part) =>
      translate(`waiting_list.day_parts.${part}`),
    ),
    ...(entry.time_from && entry.time_to
      ? [`${entry.time_from.slice(0, 5)}–${entry.time_to.slice(0, 5)}`]
      : []),
    ...(entry.duration_minutes
      ? [
          translate("waiting_list.card.minutes", {
            count: entry.duration_minutes,
          }),
        ]
      : []),
  ];

  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-[28px] bg-card p-5",
        !active && "opacity-70",
        freed && "ring-2 ring-neon",
      )}
      data-testid="waiting-entry"
      data-status={entry.status}
      data-freed={freed ? "true" : undefined}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          {compact ? null : (
            <Link
              to={`/patients/${entry.patient_id}/show`}
              className="text-lg leading-tight font-normal tracking-[-0.01em] hover:underline"
            >
              {patient ? patientDisplayName(patient) : `#${entry.patient_id}`}
            </Link>
          )}
          <p className="text-sm text-muted-foreground">
            {[
              doctor?.name ?? translate("waiting_list.any_doctor"),
              service?.name ?? entry.direction,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {entry.priority === "urgent" ? (
          <span className="rounded-full bg-neon px-2.5 py-1 text-xs font-semibold text-neon-ink">
            {translate("waiting_list.priorities.urgent")}
          </span>
        ) : null}
        <StatusChip entry={entry} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {wishes.map((wish) => (
          <span key={wish} className="rounded-full bg-muted px-3 py-1 text-xs">
            {wish}
          </span>
        ))}
      </div>

      {entry.comment ? (
        <p className="text-sm whitespace-pre-line">{entry.comment}</p>
      ) : null}

      {freed ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-2xl bg-neon/15 p-3"
          data-testid="waiting-freed-slot"
          title={translate("waiting_list.card.freed_hint")}
        >
          <span className="mr-auto text-sm">
            <span className="font-medium">
              {translate("waiting_list.card.freed", {
                time: slotLabel(freed.starts_at, timeZone, locale),
              })}
            </span>
            {freed.doctor_id != null ? (
              <span className="text-muted-foreground">
                {" "}
                · {findById(doctors, freed.doctor_id)?.name}
              </span>
            ) : null}
          </span>
          <Button size="sm" onClick={() => setOffering(freed)}>
            {translate("waiting_list.card.offer_time")}
          </Button>
          {readOnlySchedule ? null : (
            <Button size="sm" variant="outline" onClick={() => book(freed)}>
              {translate("waiting_list.card.book")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              patch(
                {
                  slot_starts_at: null,
                  slot_ends_at: null,
                  slot_doctor_id: null,
                },
                "waiting_list.notify.dismissed",
              )
            }
          >
            {translate("waiting_list.card.dismiss")}
          </Button>
        </div>
      ) : null}

      {entry.status === "offered" && entry.offered_starts_at ? (
        <p className="text-sm text-tone-violet">
          {translate("waiting_list.card.offered", {
            time: slotLabel(entry.offered_starts_at, timeZone, locale),
          })}
        </p>
      ) : null}

      {active ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {translate("waiting_list.card.nearest")}
          </span>
          {slots.length ? (
            <ul className="flex flex-col gap-1.5" data-testid="waiting-slots">
              {slots.map((slot) => (
                <li
                  key={`${slot.doctor_id}-${slot.starts_at}`}
                  className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/70 py-1.5 pr-1.5 pl-3"
                  data-testid="waiting-slot"
                >
                  <span className="mr-auto text-sm tabular-nums">
                    {slotLabel(slot.starts_at, timeZone, locale)}
                    <span className="text-muted-foreground">
                      {" "}
                      · {findById(doctors, slot.doctor_id)?.name}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 bg-card"
                    onClick={() => setOffering(slot)}
                  >
                    {translate("waiting_list.card.offer")}
                  </Button>
                  {readOnlySchedule ? null : (
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => book(slot)}
                    >
                      {translate("waiting_list.card.book")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate("waiting_list.card.no_slots")}
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
        <span>
          {days > 0
            ? translate("waiting_list.card.waiting_days", {
                smart_count: days,
              })
            : translate("waiting_list.card.waiting_today")}
        </span>
        {responsible ? (
          <span>
            {translate("waiting_list.card.responsible", {
              name: fullName(responsible),
            })}
          </span>
        ) : null}
        {author && author.id !== responsible?.id ? (
          <span>
            {translate("waiting_list.card.added_by", {
              name: fullName(author),
            })}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-1">
          {entry.deal_id != null && !compact ? (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2">
              <Link to={`/deals/${entry.deal_id}/show`}>
                {translate("waiting_list.card.open_deal")}
              </Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setEditing(true)}
          >
            {translate("waiting_list.card.edit")}
          </Button>
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() =>
                patch({ status: "cancelled" }, "waiting_list.notify.cancelled")
              }
            >
              {translate("waiting_list.card.cancel")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() =>
                patch(
                  { status: "waiting", visit_id: null },
                  "waiting_list.notify.restored",
                )
              }
            >
              {translate("waiting_list.card.restore")}
            </Button>
          )}
          {rights.canDelete(entry.created_by) ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-destructive"
              onClick={remove}
            >
              {translate("waiting_list.card.delete")}
            </Button>
          ) : null}
        </span>
      </div>

      {editing ? (
        <WaitingEntryDialog
          open
          entry={entry}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {offering ? (
        <OfferDialog
          entry={entry}
          patient={patient}
          slot={offering}
          onClose={() => setOffering(null)}
        />
      ) : null}
      {booking ? (
        <VisitDialog
          open
          draft={booking}
          onClose={() => setBooking(null)}
          onSaved={onBooked}
        />
      ) : null}
    </article>
  );
};
