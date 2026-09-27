/**
 * Files of a deal (stage 22): the private "deal-files" bucket, its paths
 * "<organization_id>/deals/<deal_id>/<uuid>-<name>", the 20 MB limit and the
 * allowed types. The app has the same rules in
 * src/components/atomic-crm/files/fileTypes.ts. No Deno import here so that
 * it can be unit tested.
 */

export const DEAL_FILES_BUCKET = "deal-files";

/** Same as the bucket's file_size_limit and deal_files_size_check */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Links given to the messengers: they download the file from it */
export const SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export type FileKind = "image" | "video" | "audio" | "pdf" | "document";

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  csv: "text/csv",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
};

/** Office documents, PDF and text accepted besides images, audio and video */
const DOCUMENT_MIMES = new Set(
  Object.values(MIME_BY_EXTENSION).filter(
    (mime) =>
      !mime.startsWith("image/") &&
      !mime.startsWith("audio/") &&
      !mime.startsWith("video/"),
  ),
);

export const extensionOf = (name: string) => {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
};

export const mimeFromName = (name: string): string | null =>
  MIME_BY_EXTENSION[extensionOf(name)] ?? null;

/** The type of a file: its own, else guessed from the name */
export const resolveMime = (mime: string | null | undefined, name: string) => {
  const own = (mime ?? "").split(";")[0].trim().toLowerCase();
  return own && own !== "application/octet-stream"
    ? own
    : (mimeFromName(name) ?? (own || "application/octet-stream"));
};

export const isAllowedMime = (mime: string) =>
  mime.startsWith("image/") ||
  mime.startsWith("audio/") ||
  mime.startsWith("video/") ||
  DOCUMENT_MIMES.has(mime);

export const fileKind = (
  mime: string | null | undefined,
  name = "",
): FileKind => {
  const type = resolveMime(mime, name);
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  return "document";
};

/** messages.content_type of a file (the Wazzup24 names) */
export const messageContentType = (kind: FileKind) =>
  kind === "pdf" ? "document" : kind;

export type FileProblem = "empty" | "too_large" | "type_not_allowed";

export const validateFile = ({
  name,
  size,
  mime,
}: {
  name: string;
  size: number;
  mime?: string | null;
}): FileProblem | null => {
  if (!name.trim() || size <= 0) return "empty";
  if (size > MAX_FILE_SIZE) return "too_large";
  if (!isAllowedMime(resolveMime(mime, name))) return "type_not_allowed";
  return null;
};

/**
 * A storage key keeps ASCII letters, digits, dots, dashes and underscores
 * only (Supabase refuses other characters): «Снимок 1.jpg» -> «1.jpg».
 * The real name is kept in deal_files.name.
 */
export const storageSafeName = (name: string) => {
  const extension = extensionOf(name);
  const base = (extension ? name.trim().slice(0, -extension.length - 1) : name)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 60);
  return `${base || "file"}${extension ? `.${extension}` : ""}`;
};

export const dealFileFolder = (organizationId: unknown, dealId: unknown) =>
  `${organizationId}/deals/${dealId}/`;

export const dealFilePath = (
  organizationId: unknown,
  dealId: unknown,
  id: string,
  name: string,
) => `${dealFileFolder(organizationId, dealId)}${id}-${storageSafeName(name)}`;

/** A file of this deal of this clinic, and not a folder trick */
export const isDealFilePath = (
  path: unknown,
  organizationId: unknown,
  dealId: unknown,
) => {
  if (typeof path !== "string") return false;
  const folder = dealFileFolder(organizationId, dealId);
  const rest = path.slice(folder.length);
  return (
    path.startsWith(folder) &&
    rest.length > 0 &&
    !rest.includes("/") &&
    !rest.includes("..")
  );
};

/** The file name at the end of a link (Wazzup24 media), else the fallback */
export const fileNameFromUrl = (url: string, fallback: string) => {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    const name = last ? decodeURIComponent(last) : "";
    return name && /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : fallback;
  } catch {
    return fallback;
  }
};

/** Default name of a received file without a name, by its type */
export const defaultFileName = (mime: string) => {
  const extension =
    Object.entries(MIME_BY_EXTENSION).find(([, type]) => type === mime)?.[0] ??
    "bin";
  const kind = fileKind(mime);
  const base =
    kind === "image"
      ? "photo"
      : kind === "video"
        ? "video"
        : kind === "audio"
          ? "audio"
          : "file";
  return `${base}.${extension}`;
};

/** The file attached to a message sent from the CRM */
export type OutgoingAttachment = {
  /** Signed link the messenger downloads the file from */
  url: string;
  name: string;
  mime: string;
  size: number;
};
