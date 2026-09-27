import { supabaseAdmin } from "./supabaseAdmin.ts";
import {
  DEAL_FILES_BUCKET,
  dealFilePath,
  isAllowedMime,
  MAX_FILE_SIZE,
  resolveMime,
} from "./attachments.ts";

/** What public.ingest_message / ingest_telegram_message return */
export type IngestResult = {
  message_id?: number;
  deal_id?: number;
  duplicate?: boolean;
} | null;

/**
 * Copies the file of a received message into our storage so that it stays
 * available when the messenger's link expires: uploaded to the deal folder
 * of the "deal-files" bucket, set on the message (attachment_*) and listed
 * in the deal files. Best effort: a file that cannot be downloaded, is too
 * big or of another type keeps its messenger link only. Never throws (the
 * webhooks run it after answering, EdgeRuntime.waitUntil).
 */
export const copyIncomingFile = async (
  ingested: IngestResult,
  download: () => Promise<{ blob: Blob; name: string; mime: string } | null>,
) => {
  try {
    if (!ingested?.message_id || ingested.duplicate) return;
    const { data: message } = await supabaseAdmin
      .from("messages")
      .select("id, organization_id, deal_id, attachment_path")
      .eq("id", ingested.message_id)
      .maybeSingle();
    if (!message || message.attachment_path) return;

    const file = await download();
    if (!file) return;
    const mime = resolveMime(file.mime || file.blob.type, file.name);
    if (
      file.blob.size <= 0 ||
      file.blob.size > MAX_FILE_SIZE ||
      !isAllowedMime(mime)
    ) {
      return;
    }
    const path = dealFilePath(
      message.organization_id,
      message.deal_id,
      crypto.randomUUID(),
      file.name,
    );
    const { error: uploadError } = await supabaseAdmin.storage
      .from(DEAL_FILES_BUCKET)
      .upload(path, file.blob, { contentType: mime });
    if (uploadError) {
      console.error("Copying a received file failed", uploadError);
      return;
    }
    const attachment = {
      attachment_path: path,
      attachment_name: file.name,
      attachment_mime: mime,
      attachment_size: file.blob.size,
    };
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update(attachment)
      .eq("id", message.id);
    if (updateError) console.error("Linking a received file", updateError);
    const { error: listError } = await supabaseAdmin.from("deal_files").insert({
      organization_id: message.organization_id,
      deal_id: message.deal_id,
      path,
      name: file.name,
      size: file.blob.size,
      mime,
      sales_id: null,
      message_id: message.id,
    });
    if (listError) console.error("Listing a received file", listError);
  } catch (error) {
    console.error("Copying a received file failed", error);
  }
};

/**
 * Lets the webhook answer at once and finish the copy afterwards (Supabase
 * Edge Runtime), else waits for it.
 */
export const runInBackground = async (task: Promise<void>) => {
  const runtime = (
    globalThis as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }
  ).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else await task;
};

/** Downloads a link, refusing more than the size limit */
export const downloadUrl = async (url: string) => {
  const response = await fetch(url).catch(() => null);
  if (!response?.ok) return null;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_FILE_SIZE) return null;
  const blob = await response.blob();
  return { blob, mime: response.headers.get("content-type") ?? blob.type };
};
