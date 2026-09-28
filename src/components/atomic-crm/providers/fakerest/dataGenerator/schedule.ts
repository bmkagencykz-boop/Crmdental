import { random } from "faker/locale/en_US";

import { DEFAULT_TIME_ZONE } from "../../commons/automessages";
import {
  addDays,
  minuteOfDay,
  todayKey,
  weekdayOf,
  zonedMoment,
  type DayKey,
} from "../../../tasks/calendarLayout";
import {
  busyIntervals,
  doctorHoursOn,
  findFreeSlots,
  clinicHours,
  overlaps,
  parseHm,
} from "../../../schedule/scheduleLayout";
import type {
  Chair,
  DoctorException,
  ScheduleStatusMap,
  Visit,
  VisitStatus,
  WeeklyHours,
} from "../../../schedule/types";
import type { Deal, Doctor } from "../../../types";
import type { Db } from "./types";

const day = (start: string, end: string, breaks?: [string, string][]) => ({
  start,
  end,
  breaks: (breaks ?? []).map(([from, to]) => ({ start: from, end: to })),
});

// Hours and visit durations of the demo doctors, by specialty
const HOURS: Record<string, { hours: WeeklyHours; minutes: number }> = {
  терапевт: {
    hours: Object.fromEntries(
      ["1", "2", "3", "4", "5"].map((d) => [
        d,
        day("09:00", "18:00", [["13:00", "14:00"]]),
      ]),
    ),
    minutes: 30,
  },
  "хирург-имплантолог": {
    hours: {
      "1": day("10:00", "19:00"),
      "3": day("10:00", "19:00"),
      "5": day("10:00", "19:00"),
      "6": day("10:00", "15:00"),
    },
    minutes: 60,
  },
  ортодонт: {
    hours: {
      "2": day("09:00", "17:00"),
      "4": day("09:00", "17:00"),
      "6": day("09:00", "15:00"),
    },
    minutes: 45,
  },
  ортопед: {
    hours: Object.fromEntries(
      ["1", "2", "3", "4", "5"].map((d) => [d, day("12:00", "20:00")]),
    ),
    minutes: 60,
  },
  "детский стоматолог": {
    hours: Object.fromEntries(
      ["1", "2", "3", "4", "5", "6"].map((d) => [
        d,
        day("09:00", "15:00", [["12:00", "12:30"]]),
      ]),
    ),
    minutes: 30,
  },
};

/** Same default mapping as private.schedule_default_status_map */
export const defaultScheduleStatusMap = (db: Pick<Db, "stages">) => {
  const stageId = (name: string) =>
    db.stages.find((stage) => stage.pipeline_id === 1 && stage.name === name)
      ?.id;
  return {
    scheduled: { stage_id: stageId("Записан") },
    confirmed: { stage_id: stageId("Записан") },
    arrived: { stage_id: stageId("Пришёл на консультацию") },
    no_show: {
      tag: "Не пришёл",
      task: "Перезвонить: пациент не пришёл на приём",
    },
    cancelled: { task: "Перезаписать" },
  } satisfies ScheduleStatusMap;
};

/**
 * The schedule of the demo (stage 28): 3 chairs, hours of the 5 doctors, a
 * day off, the settings, and about a week of visits around today linked to
 * the demo deals: booked deals come in the next days (scheduled, confirmed,
 * tomorrow's partly unconfirmed), visited deals had theirs in the last days
 * (arrived, completed), some deals in work missed or cancelled one. The MIS
 * appointments of the demo are mirrored read-only (source «mis»). The demo
 * books in the CRM: the Dentist Plus connection does not sync appointments.
 */
export const generateSchedule = (db: Db) => {
  const timeZone = db.organizations?.[0]?.timezone || DEFAULT_TIME_ZONE;
  const now = new Date();
  const today = todayKey(timeZone, now);
  const nowMinute = minuteOfDay(now, timeZone);

  db.chairs = [
    { id: 1, name: "Кресло 1", is_active: true, position: 0 },
    { id: 2, name: "Кресло 2", is_active: true, position: 1 },
    { id: 3, name: "Кресло 3 (детское)", is_active: true, position: 2 },
  ] satisfies Chair[];

  db.doctors = db.doctors.map((doctor) => {
    const plan = HOURS[doctor.specialty ?? ""];
    return {
      ...doctor,
      working_hours: plan?.hours ?? {},
      visit_minutes: plan?.minutes ?? 30,
    };
  });

  db.schedule_settings = [
    {
      id: 1,
      hours_start: "09:00",
      hours_end: "20:00",
      status_map: defaultScheduleStatusMap(db),
      confirm_keywords: ["1", "да", "подтверждаю"],
      reschedule_keywords: ["2", "перенести", "перенос"],
    },
  ];
  const clinic = clinicHours(db.schedule_settings[0]);

  // The therapist takes a day off in two days (on a weekday)
  const offDay = [2, 3, 4]
    .map((n) => addDays(today, n))
    .find((d) => weekdayOf(d) < 5);
  db.doctor_exceptions = offDay
    ? [
        {
          id: 1,
          doctor_id: db.doctors[0].id,
          day: offDay,
          start_time: null,
          end_time: null,
          note: "Отгул",
        } satisfies DoctorException,
      ]
    : [];

  // The demo books in the CRM; the synced MIS visits stay read-only
  db.mis_connections = (db.mis_connections ?? []).map((connection) => ({
    ...connection,
    sync_appointments: false,
  }));

  const visits: Visit[] = [];
  let nextId = 1;
  (db.mis_appointments ?? []).forEach((appointment) => {
    if (!appointment.starts_at) return;
    const starts = new Date(appointment.starts_at);
    visits.push({
      id: nextId++,
      patient_id: appointment.patient_id,
      deal_id: appointment.deal_id,
      doctor_id: appointment.doctor_id,
      chair_id: null,
      service_id:
        db.services.find(
          (service) =>
            service.name.toLowerCase() ===
            (appointment.service_name ?? "").toLowerCase(),
        )?.id ?? null,
      starts_at: starts.toISOString(),
      ends_at:
        appointment.ends_at ??
        new Date(starts.getTime() + 30 * 60 * 1000).toISOString(),
      status:
        appointment.status === "in_treatment"
          ? "completed"
          : (appointment.status as VisitStatus),
      note: appointment.service_name,
      source: "mis",
      external_id: `dentist_plus:${appointment.external_id}`,
      created_at: appointment.created_at,
      updated_at: appointment.updated_at,
    });
  });
  const misDeals = new Set(visits.map((visit) => visit.deal_id));

  const doctorOf = (deal: Deal, d: DayKey): Doctor | undefined => {
    const working = db.doctors.filter(
      (doctor) =>
        doctorHoursOn(doctor, d, db.doctor_exceptions, clinic) != null,
    );
    const own = working.find((doctor) => doctor.id === deal.doctor_id);
    return own ?? (working.length ? random.arrayElement(working) : undefined);
  };

  /** Books a deal on a day at the first free time of a doctor and a chair */
  const place = (
    deal: Deal,
    d: DayKey,
    status: (minute: number) => VisitStatus,
    options: { fromMinute?: number; untilMinute?: number } = {},
  ) => {
    const doctor = doctorOf(deal, d);
    if (!doctor) return null;
    const hours = doctorHoursOn(doctor, d, db.doctor_exceptions, clinic)!;
    const duration = doctor.visit_minutes ?? 30;
    const busy = busyIntervals(
      visits,
      d,
      (visit) => visit.doctor_id === doctor.id,
      timeZone,
    );
    const slots = findFreeSlots({
      hours: {
        ...hours,
        end: Math.min(hours.end, options.untilMinute ?? hours.end),
      },
      busy,
      duration,
      nowMinute: options.fromMinute,
    });
    // Not always the first free slot: the day fills up in a patchwork
    const minute = slots.length
      ? slots[Math.min(random.number(3), slots.length - 1)]
      : null;
    if (minute == null) return null;
    const chair = db.chairs.find(
      (chair) =>
        !busyIntervals(
          visits,
          d,
          (visit) => visit.chair_id === chair.id,
          timeZone,
        ).some((interval) =>
          overlaps(interval, { start: minute, end: minute + duration }),
        ),
    );
    const starts = zonedMoment(d, minute, timeZone);
    const visit: Visit = {
      id: nextId++,
      patient_id: deal.patient_id,
      deal_id: deal.id,
      doctor_id: doctor.id,
      chair_id: chair?.id ?? null,
      service_id: deal.service_id ?? null,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + duration * 60 * 1000).toISOString(),
      status: status(minute),
      note: null,
      source: "crm",
      created_by: deal.sales_id ?? null,
      created_at: new Date(now.getTime() - 4 * 24 * 3600 * 1000).toISOString(),
    };
    visit.updated_at = visit.created_at;
    visits.push(visit);
    deal.doctor_id = deal.doctor_id ?? doctor.id;
    return visit;
  };

  const stageName = (deal: Deal) =>
    db.stages.find((stage) => stage.id === deal.stage_id)?.name;
  const openDeals = db.deals
    .filter(
      (deal) =>
        deal.pipeline_id === 1 &&
        !deal.archived_at &&
        !deal.unsorted_at &&
        !misDeals.has(deal.id),
    )
    .sort((a, b) => Number(a.id) - Number(b.id));

  // Booked deals: from later today to the next week
  openDeals
    .filter((deal) => stageName(deal) === "Записан")
    .slice(0, 22)
    .forEach((deal, index) => {
      const offset = index % 7;
      const d = addDays(today, offset);
      const visit = place(
        deal,
        d,
        () =>
          offset === 1
            ? random.arrayElement(["scheduled", "scheduled", "confirmed"])
            : offset === 0
              ? "confirmed"
              : random.arrayElement(["scheduled", "confirmed"]),
        { fromMinute: offset === 0 ? nowMinute + 15 : undefined },
      );
      if (visit) deal.appointment_at = visit.starts_at;
    });

  // Visited deals: in the last days, or this morning
  openDeals
    .filter((deal) =>
      ["Пришёл на консультацию", "План согласован", "В лечении"].includes(
        stageName(deal) ?? "",
      ),
    )
    .slice(0, 12)
    .forEach((deal, index) => {
      const offset = -(index % 4);
      const d = addDays(today, offset);
      const visit = place(
        deal,
        d,
        (minute) =>
          offset === 0 && minute + 30 > nowMinute ? "arrived" : "completed",
        offset === 0 ? { untilMinute: Math.max(nowMinute, 0) } : {},
      );
      if (visit) deal.visit_at = visit.starts_at;
    });

  // Deals in work: a missed visit and a cancelled one
  openDeals
    .filter((deal) => stageName(deal) === "В работе")
    .slice(0, 5)
    .forEach((deal, index) => {
      const offset = index < 3 ? -1 - index : 2 + index;
      place(deal, addDays(today, offset), () =>
        index < 3 ? "no_show" : "cancelled",
      );
    });

  // A full book around today, like a real clinic: regular patients fill
  // most of every doctor's hours (visits of their treatment, without a
  // deal), with the comments the front desk leaves
  const NOTES = [
    "Удобнее после обеда",
    "Фото протокол, скан",
    "Контроль после имплантации",
    "Слепок после ИМП",
    "Консультация по брекетам",
    "Просит напомнить за час",
    "Придёт с ребёнком",
    "Оплата по QR",
  ];
  const regulars = db.patients.slice(0, 60);
  // Most regulars came before: one past visit each, a week or more ago, so
  // «1В» (first visit) marks only the new ones
  regulars.forEach((patient, index) => {
    if (index % 5 === 0) return;
    const d = addDays(today, -5 - (index % 20));
    const doctor = db.doctors.find(
      (item) => doctorHoursOn(item, d, db.doctor_exceptions, clinic) != null,
    );
    if (!doctor) return;
    const hours = doctorHoursOn(doctor, d, db.doctor_exceptions, clinic)!;
    const minute = hours.start + Math.floor(index / 20) * 60;
    const starts = zonedMoment(d, minute, timeZone);
    visits.push({
      id: nextId++,
      patient_id: patient.id,
      deal_id: null,
      doctor_id: doctor.id,
      chair_id: null,
      service_id: null,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 30 * 60 * 1000).toISOString(),
      status: "completed",
      note: null,
      source: "crm",
      created_by: patient.sales_id ?? null,
      created_at: starts.toISOString(),
      updated_at: starts.toISOString(),
    });
  });
  const fillDays = Array.from({ length: 6 }, (_, i) => addDays(today, i - 2));
  fillDays.forEach((d) => {
    db.doctors.forEach((doctor) => {
      const hours = doctorHoursOn(doctor, d, db.doctor_exceptions, clinic);
      if (!hours) return;
      const pauses = hours.breaks.map((pause) => ({
        start: parseHm(pause.start) ?? 0,
        end: parseHm(pause.end) ?? 0,
      }));
      let minute = hours.start;
      while (minute < hours.end) {
        const duration = random.arrayElement([30, 30, 30, 60, 60, 90]);
        const slot = { start: minute, end: minute + duration };
        const taken = busyIntervals(
          visits,
          d,
          (visit) => visit.doctor_id === doctor.id,
          timeZone,
        );
        if (
          slot.end > hours.end ||
          taken.some((interval) => overlaps(interval, slot)) ||
          pauses.some((pause) => overlaps(pause, slot)) ||
          random.number(9) < 3
        ) {
          minute += 30;
          continue;
        }
        // A few dozen regulars: most come back, some are new
        const patient = random.arrayElement(regulars);
        const starts = zonedMoment(d, minute, timeZone);
        const past = d < today || (d === today && slot.end <= nowMinute);
        const current = d === today && !past && minute <= nowMinute;
        const status: VisitStatus = past
          ? random.arrayElement([
              "completed",
              "completed",
              "completed",
              "completed",
              "no_show",
            ])
          : current
            ? "arrived"
            : random.arrayElement([
                "scheduled",
                "confirmed",
                "confirmed",
                "scheduled",
                "cancelled",
              ]);
        const visit: Visit = {
          id: nextId++,
          patient_id: patient.id,
          // Regular patients: visits of their treatment, not of a sale
          deal_id: null,
          doctor_id: doctor.id,
          chair_id: null,
          service_id: db.services.length
            ? random.arrayElement(db.services).id
            : null,
          starts_at: starts.toISOString(),
          ends_at: new Date(
            starts.getTime() + duration * 60 * 1000,
          ).toISOString(),
          status,
          note: random.number(9) < 3 ? random.arrayElement(NOTES) : null,
          source: "crm",
          created_by: patient.sales_id ?? null,
          created_at: new Date(
            now.getTime() - 3 * 24 * 3600 * 1000,
          ).toISOString(),
        };
        visit.updated_at = visit.created_at;
        visits.push(visit);
        minute = slot.end;
      }
    });
  });

  db.visits = visits.sort(
    (a, b) =>
      a.starts_at.localeCompare(b.starts_at) || Number(a.id) - Number(b.id),
  );
};
