import type { ClinicProfile, OnboardingProgress } from "../../types";
import { getSupabaseClient } from "./supabase";

type ProgressPatch = Partial<
  Pick<
    OnboardingProgress,
    "steps" | "postponed_at" | "dismissed_at" | "completed_at"
  >
>;

/**
 * Setup wizard (stage 24): the progress row of the clinic (RLS: members
 * read, owner and head update) and the clinic profile
 * (public.save_clinic_profile).
 */
export const getOnboardingMethods = () => ({
  /** null for clinics older than the wizard (no row) */
  async getOnboardingProgress(): Promise<OnboardingProgress | null> {
    const { data, error } = await getSupabaseClient()
      .from("onboarding_progress")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return (data as OnboardingProgress | null) ?? null;
  },
  async updateOnboardingProgress(
    patch: ProgressPatch,
  ): Promise<OnboardingProgress> {
    const { data: current, error: readError } = await getSupabaseClient()
      .from("onboarding_progress")
      .select("organization_id")
      .single();
    if (readError) throw readError;
    const { data, error } = await getSupabaseClient()
      .from("onboarding_progress")
      .update(patch)
      .eq("organization_id", current.organization_id)
      .select("*")
      .single();
    if (error) throw error;
    return data as OnboardingProgress;
  },
  /** Name, time zone and contacts; fills the address quick reply */
  async saveClinicProfile(profile: ClinicProfile): Promise<void> {
    const { error } = await getSupabaseClient().rpc("save_clinic_profile", {
      clinic_name: profile.name,
      city: profile.city,
      time_zone: profile.timezone,
      phone: profile.phone,
      address: profile.address,
    });
    if (error) throw error;
  },
});
