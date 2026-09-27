import type { Identifier } from "ra-core";

import { DEFAULT_MAILING_SETTINGS, shortTime } from "../../mailings/limits";
import type {
  MailingSegment,
  MailingSettings,
  RecallReport,
  SegmentPreview,
} from "../../mailings/types";
import { getCurrentOrganizationId } from "./authProvider";
import { getSupabaseClient } from "./supabase";

export type PatientOptOut = {
  messaging_opt_out: boolean;
  messaging_opt_out_at: string | null;
};

/**
 * Repeat sales and mailings (stage 17): the custom methods of the data
 * provider. Mailings are listed from the view mailings_summary (progress),
 * created and paused / resumed / cancelled through the resource mailings.
 */
export const getMailingMethods = () => ({
  /** Live count and preview of a segment (owner and head) */
  async getSegmentPreview(segment: MailingSegment): Promise<SegmentPreview> {
    const { data, error } = await getSupabaseClient().rpc(
      "mailing_segment_preview",
      { segment, preview_limit: 20 },
    );
    if (error) throw error;
    return data as SegmentPreview;
  },
  /** Repeat sales screen: upcoming recalls, handled ones, conversion */
  async getRecallReport(filters: {
    from?: string | null;
    to?: string | null;
  }): Promise<RecallReport> {
    const { data, error } = await getSupabaseClient().rpc("report_recalls", {
      period_from: filters.from ?? null,
      period_to: filters.to ?? null,
    });
    if (error) throw error;
    return data as RecallReport;
  },
  async getMailingSettings(): Promise<MailingSettings> {
    const { data, error } = await getSupabaseClient()
      .from("mailing_settings")
      .select("per_minute, per_day, work_start, work_end")
      .maybeSingle();
    if (error) throw error;
    return data
      ? {
          ...data,
          work_start: shortTime(data.work_start),
          work_end: shortTime(data.work_end),
        }
      : DEFAULT_MAILING_SETTINGS;
  },
  async updateMailingSettings(
    settings: MailingSettings,
  ): Promise<MailingSettings> {
    const { error } = await getSupabaseClient()
      .from("mailing_settings")
      .upsert({
        organization_id: await getCurrentOrganizationId(),
        ...settings,
      });
    if (error) throw error;
    return settings;
  },
  async getPatientOptOut(patientId: Identifier): Promise<PatientOptOut> {
    const { data, error } = await getSupabaseClient()
      .from("patients")
      .select("messaging_opt_out, messaging_opt_out_at")
      .eq("id", patientId)
      .single();
    if (error) throw error;
    return data as PatientOptOut;
  },
  async setPatientOptOut(
    patientId: Identifier,
    value: boolean,
  ): Promise<PatientOptOut> {
    const { data, error } = await getSupabaseClient()
      .from("patients")
      .update({ messaging_opt_out: value })
      .eq("id", patientId)
      .select("messaging_opt_out, messaging_opt_out_at")
      .single();
    if (error) throw error;
    return data as PatientOptOut;
  },
});
