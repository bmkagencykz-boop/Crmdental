import type { Identifier } from "ra-core";

/** Statuses of a visit (public.visits.status), in the order of the buttons */
export const VISIT_STATUSES = [
  "scheduled",
  "confirmed",
  "arrived",
  "completed",
  "no_show",
  "cancelled",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** A visit of the schedule (stage 28) */
export type Visit = {
  id: Identifier;
  patient_id: Identifier;
  deal_id?: Identifier | null;
  doctor_id?: Identifier | null;
  chair_id?: Identifier | null;
  service_id?: Identifier | null;
  starts_at: string;
  ends_at: string;
  status: VisitStatus;
  note?: string | null;
  /** crm: booked in the CRM; mis: mirrored from the MIS, read-only */
  source: "crm" | "mis";
  external_id?: string | null;
  created_by?: Identifier | null;
  created_at?: string;
  updated_at?: string;
  status_changed_at?: string | null;
  /** Branch (stage 33): of the chair, else the doctor, else the deal */
  branch_id?: Identifier | null;
};

/** Dictionary «Кресла» */
export type Chair = {
  id: Identifier;
  name: string;
  is_active: boolean;
  position: number;
  /** Branch (stage 33); null: shared by every branch */
  branch_id?: Identifier | null;
};

/** "09:00" … "18:00" */
export type HoursRange = { start: string; end: string };
export type DayHours = HoursRange & { breaks?: HoursRange[] };
/** ISO weekday "1" (Monday) … "7" (Sunday); a missing day is a day off */
export type WeekDay = "1" | "2" | "3" | "4" | "5" | "6" | "7";
export const WEEK_DAYS: WeekDay[] = ["1", "2", "3", "4", "5", "6", "7"];
export type WeeklyHours = Partial<Record<WeekDay, DayHours>>;

/** A day of a doctor that differs from the weekly template */
export type DoctorException = {
  id: Identifier;
  doctor_id: Identifier;
  /** YYYY-MM-DD */
  day: string;
  /** null: day off */
  start_time: string | null;
  end_time: string | null;
  note?: string | null;
};

/** What a status does to the deal (Settings → Расписание) */
export type StatusMapEntry = {
  stage_id?: Identifier | null;
  tag_id?: Identifier | null;
  /** Tag by name, created when first needed */
  tag?: string | null;
  /** Text of a call task */
  task?: string | null;
};
export type ScheduleStatusMap = Partial<Record<VisitStatus, StatusMapEntry>>;

/** public.get_schedule_settings() */
export type ScheduleSettings = {
  hours_start: string;
  hours_end: string;
  status_map: ScheduleStatusMap;
  confirm_keywords: string[];
  reschedule_keywords: string[];
  /** The MIS keeps the schedule (dentist_plus, macdent), else null */
  mis_kind: string | null;
};

export type ScheduleSettingsPatch = Partial<Omit<ScheduleSettings, "mis_kind">>;

/** Busy time of the visits the employee does not see */
export type BusySlot = {
  doctor_id: Identifier | null;
  chair_id: Identifier | null;
  starts_at: string;
  ends_at: string;
};
