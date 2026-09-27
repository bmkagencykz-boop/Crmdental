import type { Identifier } from "ra-core";

import {
  DEAL_FILES_BUCKET,
  dealFilePath,
  resolveMime,
  validateFile,
} from "../../files/fileTypes";
import type { DealFile } from "../../types";
import { getCurrentOrganizationId } from "./authProvider";
import { getSupabaseClient } from "./supabase";

/** A file uploaded to the folder of a deal, before it is listed or sent */
export type UploadedFile = {
  path: string;
  name: string;
  mime: string;
  size: number;
};

/**
 * Uploads a file to "<organization_id>/deals/<deal_id>/<uuid>-<name>" of the
 * private "deal-files" bucket (the storage policies only accept the deals
 * the employee sees).
 */
export const uploadToDealFolder = async (
  dealId: Identifier,
  file: File,
): Promise<UploadedFile> => {
  const problem = validateFile(file);
  if (problem) throw new Error(`files.errors.${problem}`);
  const mime = resolveMime(file.type, file.name);
  const path = dealFilePath(
    await getCurrentOrganizationId(),
    dealId,
    crypto.randomUUID(),
    file.name,
  );
  const { error } = await getSupabaseClient()
    .storage.from(DEAL_FILES_BUCKET)
    .upload(path, file, { contentType: mime });
  if (error) {
    console.error("Upload failed", error);
    throw new Error("files.errors.upload");
  }
  return { path, name: file.name, mime, size: file.size };
};

/**
 * Files of the deals (stage 22): upload, signed links, deletion. The list
 * itself is the resource deal_files.
 */
export const getFileMethods = () => ({
  /** Uploads a file on the «Файлы» tab and lists it in the deal */
  async uploadDealFile(dealId: Identifier, file: File): Promise<DealFile> {
    const uploaded = await uploadToDealFolder(dealId, file);
    const { data, error } = await getSupabaseClient()
      .from("deal_files")
      .insert({
        deal_id: dealId,
        path: uploaded.path,
        name: uploaded.name,
        size: uploaded.size,
        mime: uploaded.mime,
      })
      .select()
      .single();
    if (error) {
      await getSupabaseClient()
        .storage.from(DEAL_FILES_BUCKET)
        .remove([uploaded.path]);
      throw new Error("files.errors.upload");
    }
    return data as DealFile;
  },
  /**
   * A link valid for an hour (the bucket is private). With downloadName, the
   * browser saves the file under that name instead of opening it.
   */
  async getFileUrl(path: string, downloadName?: string): Promise<string> {
    const { data, error } = await getSupabaseClient()
      .storage.from(DEAL_FILES_BUCKET)
      .createSignedUrl(
        path,
        60 * 60,
        downloadName ? { download: downloadName } : undefined,
      );
    if (error || !data) throw new Error("files.errors.not_found");
    return data.signedUrl;
  },
  /** Removed from the list (RLS: owner, head or uploader), then from storage */
  async deleteDealFile(file: DealFile): Promise<void> {
    const { data, error } = await getSupabaseClient()
      .from("deal_files")
      .delete()
      .eq("id", file.id)
      .select("id");
    if (error || !data?.length) throw new Error("files.errors.delete");
    await getSupabaseClient()
      .storage.from(DEAL_FILES_BUCKET)
      .remove([file.path]);
  },
});
