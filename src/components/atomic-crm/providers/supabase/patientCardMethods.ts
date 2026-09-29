import type { Identifier } from "ra-core";

import {
  DEAL_FILES_BUCKET,
  resolveMime,
  storageSafeName,
  validateFile,
} from "../../files/fileTypes";
import type { PatientFile, PatientFileKind } from "../../patient-card/types";
import { getCurrentOrganizationId } from "./authProvider";
import { getSupabaseClient } from "./supabase";

/** "<organization_id>/patients/<patient_id>/<uuid>-<name>": the storage policies check it */
export const patientFilePath = (
  organizationId: unknown,
  patientId: unknown,
  id: string,
  name: string,
) => `${organizationId}/patients/${patientId}/${id}-${storageSafeName(name)}`;

/**
 * The full patient card (stage 37). The chart, the records, the
 * questionnaire and the consents are plain resources (patient_teeth,
 * visit_records, patient_questionnaires, patient_consents…); the files of
 * the patient (X-rays, photos, signed consents) go to the patient folder of
 * the private bucket deal-files and are listed in patient_files.
 */
export const getPatientCardMethods = () => ({
  async uploadPatientFile(
    patientId: Identifier,
    file: File,
    kind: PatientFileKind,
    extra: {
      taken_at?: string | null;
      note?: string | null;
      /** A file of a lab work order (stage 40) */
      lab_order_id?: Identifier | null;
    } = {},
  ): Promise<PatientFile> {
    const problem = validateFile(file);
    if (problem) throw new Error(`files.errors.${problem}`);
    const mime = resolveMime(file.type, file.name);
    const path = patientFilePath(
      await getCurrentOrganizationId(),
      patientId,
      crypto.randomUUID(),
      file.name,
    );
    const client = getSupabaseClient();
    const { error: uploadError } = await client.storage
      .from(DEAL_FILES_BUCKET)
      .upload(path, file, { contentType: mime });
    if (uploadError) {
      console.error("Upload failed", uploadError);
      throw new Error("files.errors.upload");
    }
    const { data, error } = await client
      .from("patient_files")
      .insert({
        patient_id: patientId,
        path,
        name: file.name,
        size: file.size,
        mime,
        kind,
        taken_at: extra.taken_at ?? null,
        note: extra.note ?? null,
        lab_order_id: extra.lab_order_id ?? null,
      })
      .select()
      .single();
    if (error) {
      await client.storage.from(DEAL_FILES_BUCKET).remove([path]);
      throw new Error("files.errors.upload");
    }
    return data as PatientFile;
  },
  /** Removed from the list (RLS: owner, head or uploader), then from storage */
  async deletePatientFile(file: PatientFile): Promise<void> {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("patient_files")
      .delete()
      .eq("id", file.id)
      .select("id");
    if (error || !data?.length) throw new Error("files.errors.delete");
    await client.storage.from(DEAL_FILES_BUCKET).remove([file.path]);
  },
});
