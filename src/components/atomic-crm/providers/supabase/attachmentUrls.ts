import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { attachmentPath, isSignedUrl } from "../../data-safety/dataSafety";
import { getSupabaseClient } from "./supabase";

/**
 * The note attachments, avatars and logos live in the private bucket
 * "attachments" (stage 41): the app reads them through signed links, made
 * for every file of the records it receives, in one call per batch. The
 * database keeps the stable address (the path and the public-style URL).
 */

/** A signed link lives 12 hours: longer than a working day on one page */
export const ATTACHMENT_URL_TTL = 12 * 60 * 60;

type FileLike = { path?: string | null; src?: string | null } & Record<
  string,
  any
>;

const signPaths = async (paths: string[]) => {
  const unique = [...new Set(paths)];
  if (!unique.length) return new Map<string, string>();
  const { data, error } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrls(unique, ATTACHMENT_URL_TTL);
  const urls = new Map<string, string>();
  if (error || !data) return urls;
  for (const row of data) {
    if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  return urls;
};

/** Files of a record: note attachments, an avatar, the notes of an activity */
const filesOf = (record: Record<string, any>): FileLike[] => {
  const files: FileLike[] = [];
  if (Array.isArray(record?.attachments)) files.push(...record.attachments);
  if (record?.avatar && typeof record.avatar === "object") {
    files.push(record.avatar);
  }
  for (const key of ["patientNote", "dealNote"]) {
    if (record?.[key]) files.push(...filesOf(record[key]));
  }
  return files;
};

/** Replaces the address of every stored file of the records by a signed link */
export const signRecordFiles = async <T extends Record<string, any>>(
  records: T[],
): Promise<T[]> => {
  const files = records.flatMap(filesOf);
  const paths = files
    .map((file) => attachmentPath(file, ATTACHMENTS_BUCKET))
    .filter((path): path is string => !!path);
  if (!paths.length) return records;
  const urls = await signPaths(paths);
  for (const file of files) {
    const path = attachmentPath(file, ATTACHMENTS_BUCKET);
    const url = path ? urls.get(path) : undefined;
    if (path && url) {
      file.path = path;
      file.src = url;
    }
  }
  return records;
};

/** A signed link for one stored address (a logo, the identity's avatar) */
export const signedUrlOf = async (src?: string | null) => {
  const path = attachmentPath({ src }, ATTACHMENTS_BUCKET);
  if (!path) return src ?? undefined;
  return (await signPaths([path])).get(path) ?? src ?? undefined;
};

/** The stable address of a stored file: never a link that expires */
export const storedUrlOf = (path: string) =>
  getSupabaseClient().storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path).data
    .publicUrl;

/** A file about to be saved: its signed link back to the stable address */
export const unsignFile = <F extends FileLike>(file: F): F => {
  if (!isSignedUrl(file?.src)) return file;
  const path = attachmentPath(file, ATTACHMENTS_BUCKET);
  return path ? { ...file, path, src: storedUrlOf(path) } : file;
};
