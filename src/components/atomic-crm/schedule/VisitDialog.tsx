import {
  Form,
  required,
  useDataProvider,
  useGetIdentity,
  useGetList,
  useNotify,
  useRefresh,
  useTranslate,
  type Identifier,
} from "ra-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  findById,
  toChoices,
  toDoctorChoices,
  useDoctors,
  useServices,
} from "../dictionaries/useDictionaries";
import { PatientInput } from "../patients/PatientInput";
import type { CrmDataProvider } from "../providers/types";
import { addDays, zonedMoment } from "../tasks/calendarLayout";
import { useClinicTimeZone } from "../tasks/useClinicTimeZone";
import type { Deal } from "../types";
import {
  busyIntervals,
  DEFAULT_VISIT_MINUTES,
  doctorHoursOn,
  DURATION_CHOICES,
  findConflict,
  findFreeSlots,
  hoursWarning,
  parseHm,
  toHm,
} from "./scheduleLayout";
import type { Visit } from "./types";
import {
  useChairs,
  useDoctorExceptions,
  useScheduleSettings,
  useVisits,
} from "./useSchedule";

const NEW_DEAL = "new";
const NO_DEAL = "none";

/** Values of the dialog: a day and a time of the clinic, a duration */
export type VisitDraft = {
  patient_id?: Identifier | null;
  deal_id?: Identifier | null;
  doctor_id?: Identifier | null;
  chair_id?: Identifier | null;
  service_id?: Identifier | null;
  /** YYYY-MM-DD of the clinic */
  day: string;
  /** HH:MM of the clinic */
  time: string;
  duration?: number;
  note?: string | null;
};

type FormValues = Omit<VisitDraft, "deal_id" | "duration"> & {
  deal_id: Identifier | typeof NEW_DEAL | typeof NO_DEAL;
  duration: number;
};

/** 15-minute times of the time select, 06:00 to 23:00 */
const TIME_CHOICES = Array.from({ length: (23 - 6) * 4 + 1 }, (_, index) => {
  const value = toHm(6 * 60 + index * 15);
  return { id: value, name: value };
});

/**
 * «Новая запись» / «Изменить запись»: patient (search, or a new one by name
 * and phone), deal (an open deal of the patient, «Новая сделка» or none),
 * doctor, chair, service, day and time of the clinic, duration (the
 * doctor's default) and a note. Warns outside the doctor's hours and when
 * the doctor or the chair is busy, and offers the free times of the day.
 */
export const VisitDialog = ({
  open,
  onClose,
  draft,
  visit,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  draft: VisitDraft;
  /** Edit this visit */
  visit?: Visit;
  onSaved?: (visit: Visit) => void;
}) => {
  const translate = useTranslate();
  const notify = useNotify();
  const refresh = useRefresh();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { identity } = useGetIdentity();
  const timeZone = useClinicTimeZone();
  const { misKind } = useScheduleSettings();
  const { data: services } = useServices();
  const [saving, setSaving] = useState(false);

  const record: FormValues = useMemo(
    () => ({
      patient_id: draft.patient_id ?? null,
      deal_id:
        draft.deal_id != null
          ? draft.deal_id
          : draft.patient_id != null && !visit
            ? NEW_DEAL
            : NO_DEAL,
      doctor_id: draft.doctor_id ?? null,
      chair_id: draft.chair_id ?? null,
      service_id: draft.service_id ?? null,
      day: draft.day,
      time: draft.time,
      duration: draft.duration ?? DEFAULT_VISIT_MINUTES,
      note: draft.note ?? "",
    }),
    // The draft of an open dialog does not change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );

  const save = async (values: Partial<FormValues>) => {
    const minute = parseHm(values.time);
    if (!values.patient_id || !values.day || minute == null) return;
    setSaving(true);
    try {
      let dealId: Identifier | null =
        values.deal_id === NO_DEAL || values.deal_id == null
          ? null
          : values.deal_id;
      if (values.deal_id === NEW_DEAL) {
        const service = findById(services, values.service_id);
        const { data: deal } = await dataProvider.create<Deal>("deals", {
          data: {
            patient_id: values.patient_id,
            name: service?.name ?? translate("schedule.dialog.deal_name"),
            service_id: values.service_id ?? null,
            doctor_id: values.doctor_id ?? null,
            sales_id: identity?.id ?? null,
          } as Partial<Deal>,
        });
        dealId = deal.id;
      }
      const starts = zonedMoment(values.day, minute, timeZone);
      const data = {
        patient_id: values.patient_id,
        deal_id: dealId,
        doctor_id: values.doctor_id ?? null,
        chair_id: values.chair_id ?? null,
        service_id: values.service_id ?? null,
        starts_at: starts.toISOString(),
        ends_at: new Date(
          starts.getTime() +
            (Number(values.duration) || DEFAULT_VISIT_MINUTES) * 60000,
        ).toISOString(),
        note: values.note?.trim() || null,
      };
      const { data: saved } = visit
        ? await dataProvider.update<Visit>("visits", {
            id: visit.id,
            data,
            previousData: visit,
          })
        : await dataProvider.create<Visit>("visits", {
            data: data as Partial<Visit>,
          });
      notify(visit ? "schedule.dialog.updated" : "schedule.dialog.created", {
        type: "info",
      });
      refresh();
      onSaved?.(saved);
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), {
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              visit ? "schedule.dialog.edit_title" : "schedule.dialog.title",
            )}
          </DialogTitle>
        </DialogHeader>
        {misKind && !visit ? (
          <p className="text-sm text-muted-foreground">
            {translate("schedule.mis.readonly")}
          </p>
        ) : (
          <Form
            record={record}
            onSubmit={save}
            className="flex flex-col gap-4"
            resource="visits"
          >
            <VisitFields visit={visit} />
            <VisitWarnings visit={visit} />
            <DialogFooter className="w-full justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                {translate("ra.action.cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {translate(visit ? "ra.action.save" : "schedule.dialog.submit")}
              </Button>
            </DialogFooter>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const VisitFields = ({ visit }: { visit?: Visit }) => {
  const translate = useTranslate();
  const { setValue, getFieldState } = useFormContext<FormValues>();
  const { data: doctors } = useDoctors();
  const { data: chairs } = useChairs();
  const { data: services } = useServices();
  const [patientId, dealId, doctorId, chairId, serviceId] = useWatch<
    FormValues,
    ["patient_id", "deal_id", "doctor_id", "chair_id", "service_id"]
  >({ name: ["patient_id", "deal_id", "doctor_id", "chair_id", "service_id"] });

  const { data: deals = [], isPending: dealsPending } = useGetList<Deal>(
    "deals",
    {
      pagination: { page: 1, perPage: 50 },
      sort: { field: "updated_at", order: "DESC" },
      filter: { patient_id: patientId, "archived_at@is": null },
    },
    { enabled: patientId != null },
  );
  const openDeals = deals.filter(
    (deal) => deal.stage_kind === "open" || String(deal.id) === String(dealId),
  );

  // A patient picked in the dialog: their latest open deal (once the deals
  // are loaded), else a new one. The patient of the draft keeps its deal.
  const firstPatient = useRef(patientId);
  const latestOpenDealId = deals.find((deal) => deal.stage_kind === "open")?.id;
  useEffect(() => {
    if (
      patientId == null ||
      String(patientId) === String(firstPatient.current) ||
      dealsPending
    )
      return;
    setValue("deal_id", latestOpenDealId ?? NEW_DEAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, dealsPending, latestOpenDealId]);

  // The doctor gives the duration (unless it was chosen) and the service
  // of the deal gives the service
  const firstDoctor = useRef(doctorId);
  useEffect(() => {
    if (visit || doctorId === firstDoctor.current) return;
    firstDoctor.current = doctorId;
    const minutes = findById(doctors, doctorId)?.visit_minutes;
    if (minutes && !getFieldState("duration").isDirty) {
      setValue("duration", minutes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, doctors.length]);
  useEffect(() => {
    if (visit || serviceId != null) return;
    const deal = openDeals.find((item) => String(item.id) === String(dealId));
    if (deal?.service_id != null) setValue("service_id", deal.service_id);
    if (deal?.doctor_id != null && doctorId == null) {
      setValue("doctor_id", deal.doctor_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, openDeals.length]);

  const durationChoices = Array.from(
    new Set([
      ...DURATION_CHOICES,
      ...(findById(doctors, doctorId)?.visit_minutes
        ? [findById(doctors, doctorId)!.visit_minutes!]
        : []),
    ]),
  )
    .sort((a, b) => a - b)
    .map((minutes) => ({
      id: minutes,
      name: translate("schedule.minutes", { count: minutes }),
    }));

  return (
    <div className="flex flex-col gap-4">
      <PatientInput source="patient_id" label="schedule.fields.patient" />
      <SelectInput
        source="deal_id"
        label="schedule.fields.deal"
        choices={[
          ...openDeals.map((deal) => ({
            id: deal.id,
            name:
              deal.name ||
              translate("schedule.dialog.deal_untitled", { id: deal.id }),
          })),
          { id: NEW_DEAL, name: translate("schedule.dialog.new_deal") },
          { id: NO_DEAL, name: translate("schedule.dialog.no_deal") },
        ]}
        validate={required()}
        helperText={false}
        disabled={patientId == null}
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SelectInput
          source="doctor_id"
          label="schedule.fields.doctor"
          choices={toDoctorChoices(doctors, doctorId)}
          emptyText="schedule.fields.none"
          helperText={false}
        />
        <SelectInput
          source="chair_id"
          label="schedule.fields.chair"
          choices={chairs
            .filter(
              (chair) =>
                chair.is_active || String(chair.id) === String(chairId),
            )
            .map((chair) => ({ id: chair.id, name: chair.name }))}
          emptyText="schedule.fields.none"
          helperText={false}
        />
        <SelectInput
          source="service_id"
          label="schedule.fields.service"
          choices={toChoices(services, serviceId)}
          emptyText="schedule.fields.none"
          helperText={false}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <TextInput
          source="day"
          type="date"
          label="schedule.fields.day"
          validate={required()}
          helperText={false}
        />
        <SelectInput
          source="time"
          label="schedule.fields.time"
          choices={TIME_CHOICES}
          validate={required()}
          helperText={false}
        />
        <SelectInput
          source="duration"
          label="schedule.fields.duration"
          choices={durationChoices}
          validate={required()}
          helperText={false}
        />
      </div>
      <TextInput
        source="note"
        label="schedule.fields.note"
        multiline
        helperText={false}
      />
    </div>
  );
};

/**
 * Warnings of the dialog: outside the doctor's hours (saved anyway), the
 * doctor or the chair busy (refused), and the free times of the doctor.
 */
const VisitWarnings = ({ visit }: { visit?: Visit }) => {
  const translate = useTranslate();
  const timeZone = useClinicTimeZone();
  const { setValue } = useFormContext<FormValues>();
  const { hours: clinic } = useScheduleSettings();
  const { data: doctors } = useDoctors();
  const [day, time, duration, doctorId, chairId] = useWatch<
    FormValues,
    ["day", "time", "duration", "doctor_id", "chair_id"]
  >({ name: ["day", "time", "duration", "doctor_id", "chair_id"] });
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "");
  const from = valid ? zonedMoment(day, 0, timeZone) : new Date();
  const to = valid ? zonedMoment(addDays(day, 1), 0, timeZone) : new Date();
  const { data: visits } = useVisits(from, to, {}, valid);
  const { data: exceptions } = useDoctorExceptions(
    valid ? day : undefined,
    valid ? day : undefined,
  );
  if (!valid) return null;
  const minute = parseHm(time);
  const length = Number(duration) || DEFAULT_VISIT_MINUTES;
  const doctor = findById(doctors, doctorId);
  const hours = doctor
    ? doctorHoursOn(doctor, day, exceptions, clinic)
    : clinic;
  const warning =
    minute != null ? hoursWarning(hours, minute, minute + length) : null;
  const starts = minute != null ? zonedMoment(day, minute, timeZone) : null;
  const conflict = starts
    ? findConflict(
        {
          id: visit?.id,
          starts_at: starts.toISOString(),
          ends_at: new Date(starts.getTime() + length * 60000).toISOString(),
          doctor_id: doctorId,
          chair_id: chairId,
        },
        visits,
      )
    : null;
  const free = doctor
    ? findFreeSlots({
        hours,
        busy: busyIntervals(
          visits,
          day,
          (item) => String(item.doctor_id) === String(doctor.id),
          timeZone,
          visit?.id,
        ),
        duration: length,
        limit: 8,
      })
    : [];

  if (!warning && !conflict && !doctor) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      {doctor ? (
        <p className="text-muted-foreground">
          {hours
            ? translate("schedule.dialog.doctor_hours", {
                hours: `${toHm(hours.start)}–${toHm(hours.end)}`,
              })
            : translate("schedule.dialog.doctor_off")}
        </p>
      ) : null}
      {warning ? (
        <p className="text-warn" role="status">
          {translate(`schedule.warnings.${warning}`)}
        </p>
      ) : null}
      {conflict ? (
        <p className="font-medium text-destructive" role="alert">
          {translate(`schedule.errors.${conflict.resource}_busy`)}
        </p>
      ) : null}
      {doctor && free.length ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">
            {translate("schedule.dialog.free")}
          </span>
          {free.map((start) => (
            <button
              key={start}
              type="button"
              onClick={() =>
                setValue("time", toHm(start), { shouldDirty: true })
              }
              className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs tabular-nums hover:border-primary"
            >
              {toHm(start)}
            </button>
          ))}
        </div>
      ) : doctor && hours ? (
        <p className="text-xs text-muted-foreground">
          {translate("schedule.dialog.no_free")}
        </p>
      ) : null}
    </div>
  );
};
