import type { Identifier } from "ra-core";

import { DEFAULT_TIME_ZONE } from "../../commons/automessages";
import { clinicHours } from "../../../schedule/scheduleLayout";
import { addDays, todayKey } from "../../../tasks/calendarLayout";
import type { CrmNotification, Deal } from "../../../types";
import type { DayPart, WaitingEntry } from "../../../waiting-list/types";
import { nearestSlots } from "../../../waiting-list/waitingMatch";
import type { Db } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

type Plan = {
  specialty: string | null;
  priority?: WaitingEntry["priority"];
  status?: WaitingEntry["status"];
  daysAgo: number;
  weekdays?: number[];
  day_parts?: DayPart[];
  hours?: [string, string];
  periodDays?: number;
  direction?: string;
  comment: string;
  /** A slot freed by a cancellation, highlighted on the entry */
  freed?: boolean;
  withDeal?: boolean;
};

// Ten realistic wishes of the patients of a dental clinic
const PLANS: Plan[] = [
  {
    specialty: "терапевт",
    priority: "urgent",
    daysAgo: 1,
    day_parts: ["morning"],
    comment: "Острая боль справа внизу, просит как можно раньше",
    freed: true,
  },
  {
    specialty: "хирург-имплантолог",
    priority: "urgent",
    daysAgo: 2,
    comment: "Удаление восьмёрки — хочет до отпуска",
    periodDays: 10,
    freed: true,
  },
  {
    specialty: "ортодонт",
    daysAgo: 20,
    weekdays: [2, 4],
    day_parts: ["day"],
    comment: "Консультация по брекетам, после учёбы",
  },
  {
    specialty: null,
    daysAgo: 16,
    direction: "Профессиональная гигиена",
    periodDays: 14,
    comment: "Любой врач, лишь бы раньше",
    withDeal: false,
  },
  {
    specialty: "ортопед",
    daysAgo: 3,
    hours: ["17:00", "20:00"],
    comment: "Работает до 17:00, только вечером",
  },
  {
    specialty: "детский стоматолог",
    daysAgo: 5,
    weekdays: [6],
    day_parts: ["morning"],
    comment: "Ребёнок 7 лет, в будни школа — только суббота утром",
  },
  {
    specialty: "терапевт",
    status: "offered",
    daysAgo: 8,
    day_parts: ["evening", "day"],
    comment: "Лечение кариеса 2 зубов",
  },
  {
    specialty: "хирург-имплантолог",
    status: "booked",
    daysAgo: 12,
    comment: "Имплантация 36, ждал освободившееся окно",
  },
  {
    specialty: "ортопед",
    status: "booked",
    daysAgo: 6,
    comment: "Примерка коронки",
  },
  {
    specialty: "терапевт",
    status: "cancelled",
    daysAgo: 25,
    comment: "Записалась в другую клинику",
  },
];

/**
 * The waiting list of the demo (stage 38): ten entries of patients with
 * open deals — two urgent with a slot freed by a cancellation (and the
 * notification of their responsible), long waits, wishes by days of the
 * week, parts of the day and hours, one offered, two booked (linked to a
 * visit of the patient), one cancelled.
 */
export const generateWaitingList = (db: Db) => {
  const timeZone = db.organizations?.[0]?.timezone || DEFAULT_TIME_ZONE;
  const now = new Date();
  const today = todayKey(timeZone, now);
  const clinic = clinicHours(db.schedule_settings?.[0]);
  const openStages = new Set(
    db.stages.filter((stage) => stage.kind === "open").map((s) => String(s.id)),
  );
  const futureVisit = (patientId: Identifier) =>
    db.visits.find(
      (visit) =>
        same(visit.patient_id, patientId) &&
        visit.source === "crm" &&
        ["scheduled", "confirmed"].includes(visit.status) &&
        new Date(visit.starts_at).getTime() > now.getTime(),
    );
  const openDeals = db.deals.filter(
    (deal) => !deal.archived_at && openStages.has(String(deal.stage_id)),
  );
  const used = new Set<string>();
  const pick = (booked: boolean): Deal | undefined => {
    const deal = openDeals.find(
      (candidate) =>
        !used.has(String(candidate.patient_id)) &&
        !!futureVisit(candidate.patient_id) === booked,
    );
    if (deal) used.add(String(deal.patient_id));
    return deal;
  };
  const doctorOf = (specialty: string | null) =>
    specialty
      ? db.doctors.find(
          (doctor) => doctor.is_active && doctor.specialty === specialty,
        )
      : undefined;
  const manager = db.sales.find((sale) => sale.role === "manager");

  const entries: WaitingEntry[] = [];
  PLANS.forEach((plan, index) => {
    const deal = pick(plan.status === "booked");
    if (!deal) return;
    const doctor = doctorOf(plan.specialty);
    const created = new Date(now.getTime() - plan.daysAgo * DAY);
    created.setMinutes(0, 0, 0);
    const visit =
      plan.status === "booked" ? futureVisit(deal.patient_id) : null;
    const entry: WaitingEntry = {
      id: index + 1,
      patient_id: deal.patient_id,
      deal_id: plan.withDeal === false ? null : deal.id,
      doctor_id: visit?.doctor_id ?? doctor?.id ?? null,
      service_id: plan.direction ? null : (deal.service_id ?? null),
      direction: plan.direction ?? null,
      branch_id: deal.branch_id ?? doctor?.branch_id ?? null,
      date_from: plan.daysAgo > 7 ? addDays(today, -plan.daysAgo) : today,
      date_to: plan.periodDays ? addDays(today, plan.periodDays) : null,
      weekdays: plan.weekdays ?? [],
      day_parts: plan.day_parts ?? [],
      time_from: plan.hours?.[0] ?? null,
      time_to: plan.hours?.[1] ?? null,
      duration_minutes: null,
      priority: plan.priority ?? "normal",
      status: plan.status ?? "waiting",
      comment: plan.comment,
      visit_id: visit?.id ?? null,
      sales_id: deal.sales_id ?? manager?.id ?? null,
      created_by: manager?.id ?? deal.sales_id ?? null,
      offered_at: null,
      offered_by: null,
      offered_starts_at: null,
      offered_doctor_id: null,
      slot_starts_at: null,
      slot_ends_at: null,
      slot_doctor_id: null,
      slot_found_at: null,
      status_changed_at: new Date(
        created.getTime() + (plan.status ? DAY : 0),
      ).toISOString(),
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
    };
    // A real free slot of the doctor: offered, or freed by a cancellation
    if (plan.status === "offered" || plan.freed) {
      const [slot] = nearestSlots({
        entry: { ...entry, date_from: addDays(today, 1) },
        doctors: db.doctors,
        visits: db.visits,
        exceptions: db.doctor_exceptions ?? [],
        clinic,
        timeZone,
        now,
        limit: 1,
      });
      if (slot && plan.status === "offered") {
        Object.assign(entry, {
          offered_at: new Date(
            now.getTime() - 3 * 60 * 60 * 1000,
          ).toISOString(),
          offered_by: entry.sales_id,
          offered_starts_at: slot.starts_at,
          offered_doctor_id: slot.doctor_id,
        });
      }
      if (slot && plan.freed) {
        Object.assign(entry, {
          slot_starts_at: slot.starts_at,
          slot_ends_at: slot.ends_at,
          slot_doctor_id: slot.doctor_id,
          slot_found_at: new Date(now.getTime() - 40 * 60 * 1000).toISOString(),
        });
        // The cancelled visit that freed it, of another patient
        const other = db.patients.find(
          (patient) => !used.has(String(patient.id)),
        );
        if (other) {
          used.add(String(other.id));
          db.visits.push({
            id: Math.max(0, ...db.visits.map((v) => Number(v.id))) + 1,
            patient_id: other.id,
            deal_id: null,
            doctor_id: slot.doctor_id,
            chair_id: null,
            service_id: null,
            starts_at: slot.starts_at,
            ends_at: slot.ends_at,
            status: "cancelled",
            note: "Отменил: заболел",
            source: "crm",
            external_id: null,
            created_by: manager?.id ?? null,
            created_at: entry.created_at,
            updated_at: entry.slot_found_at!,
            status_changed_at: entry.slot_found_at,
            branch_id: entry.branch_id ?? null,
          });
        }
        const doctorName = db.doctors.find((d) =>
          same(d.id, slot.doctor_id),
        )?.name;
        const patient = db.patients.find((p) => same(p.id, entry.patient_id));
        const at = entry.slot_found_at!;
        db.notifications.push({
          id: Math.max(0, ...db.notifications.map((n) => Number(n.id))) + 1,
          sales_id: entry.sales_id ?? db.sales[0].id,
          kind: "waiting_list_slot",
          title: "Освободилось время для листа ожидания",
          body: [
            [patient?.last_name, patient?.first_name].filter(Boolean).join(" "),
            new Intl.DateTimeFormat("ru-RU", {
              timeZone,
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
              .format(new Date(slot.starts_at))
              .replace(",", ""),
            doctorName,
          ]
            .filter(Boolean)
            .join(" · "),
          deal_id: entry.deal_id ?? null,
          patient_id: entry.patient_id,
          task_id: null,
          message_count: 1,
          created_at: at,
          updated_at: at,
          read_at: null,
        } satisfies CrmNotification);
      }
    }
    entries.push(entry);
  });
  db.waiting_list = entries;
};
