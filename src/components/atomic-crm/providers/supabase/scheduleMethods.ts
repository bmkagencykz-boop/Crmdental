import type { Identifier } from "ra-core";

import type {
  BusySlot,
  ScheduleSettings,
  ScheduleSettingsPatch,
  WeeklyHours,
} from "../../schedule/types";
import type { Doctor } from "../../types";
import { getSupabaseClient } from "./supabase";

/**
 * Schedule (stage 28): the settings and the doctors' hours go through the
 * public.*_schedule_* functions (owner, head, integrator); visits, chairs
 * and day exceptions are the resources visits, chairs, doctor_exceptions.
 */
export const getScheduleMethods = () => ({
  async getScheduleSettings(): Promise<ScheduleSettings> {
    const { data, error } = await getSupabaseClient().rpc(
      "get_schedule_settings",
    );
    if (error) throw error;
    return data as ScheduleSettings;
  },
  async saveScheduleSettings(
    patch: ScheduleSettingsPatch,
  ): Promise<ScheduleSettings> {
    const { data, error } = await getSupabaseClient().rpc(
      "save_schedule_settings",
      { settings: patch },
    );
    if (error) throw error;
    return data as ScheduleSettings;
  },
  async saveDoctorHours(
    doctorId: Identifier,
    hours: WeeklyHours | null,
    minutes?: number | null,
  ): Promise<Doctor> {
    const { data, error } = await getSupabaseClient().rpc("save_doctor_hours", {
      target_doctor_id: doctorId,
      hours,
      minutes: minutes ?? null,
    });
    if (error) throw error;
    return data as Doctor;
  },
  /** Busy time of the visits of deals the employee does not see */
  async getScheduleBusy(from: string, to: string): Promise<BusySlot[]> {
    const { data, error } = await getSupabaseClient().rpc("schedule_busy", {
      from_at: from,
      to_at: to,
    });
    if (error) throw error;
    return (data ?? []) as BusySlot[];
  },
});
