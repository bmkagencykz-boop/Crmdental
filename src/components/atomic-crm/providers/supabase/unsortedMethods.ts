import type { Identifier } from "ra-core";

import type {
  DuplicateGroupRow,
  MergeChoices,
  PatientDuplicate,
} from "../../duplicates/duplicates";
import { getSupabaseClient } from "./supabase";

/**
 * «Неразобранное» and duplicate patients (stage 18): the custom methods of
 * the data provider. The unsorted leads are listed from the view
 * unsorted_leads (resource of the same name).
 */
export const getUnsortedMethods = () => ({
  /** «Принять»: stage and responsible, null for the defaults */
  async acceptUnsorted(
    dealId: Identifier,
    stageId?: Identifier | null,
    salesId?: Identifier | null,
  ): Promise<void> {
    const { error } = await getSupabaseClient().rpc("accept_unsorted", {
      lead_deal_id: dealId,
      target_stage_id: stageId ?? null,
      target_sales_id: salesId ?? null,
    });
    if (error) throw error;
  },
  /** «Отклонить»: lost, «Спам / не целевое» */
  async rejectUnsorted(dealId: Identifier, comment?: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc("reject_unsorted", {
      lead_deal_id: dealId,
      comment: comment?.trim() || null,
    });
    if (error) throw error;
  },
  /** «Объединить с…»: the lead's history goes to an open deal */
  async mergeUnsorted(
    dealId: Identifier,
    targetDealId: Identifier,
  ): Promise<{ deal_id: Identifier; merged_patient_id: Identifier | null }> {
    const { data, error } = await getSupabaseClient().rpc("merge_unsorted", {
      lead_deal_id: dealId,
      target_deal_id: targetDealId,
    });
    if (error) throw error;
    return data;
  },
  async getPatientDuplicates(
    patientId: Identifier,
  ): Promise<PatientDuplicate[]> {
    const { data, error } = await getSupabaseClient().rpc(
      "patient_duplicates",
      { target_patient_id: patientId },
    );
    if (error) throw error;
    return (data ?? []) as PatientDuplicate[];
  },
  async getDuplicateGroups(): Promise<DuplicateGroupRow[]> {
    const { data, error } = await getSupabaseClient().rpc("duplicate_groups");
    if (error) throw error;
    return (data ?? []) as DuplicateGroupRow[];
  },
  /** Owner and head: mergeId is merged into keepId */
  async mergePatients(
    keepId: Identifier,
    mergeId: Identifier,
    choices: MergeChoices,
  ): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc("merge_patients", {
      keep_id: keepId,
      merge_id: mergeId,
      field_choices: choices,
    });
    if (error) throw error;
    return data as Identifier;
  },
});
