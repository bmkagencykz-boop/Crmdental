/**
 * Files of a deal (stage 22): types, the 20 MB limit and storage paths.
 * The edge functions have the same rules in
 * supabase/functions/_shared/attachments.ts (and the database checks the
 * size and the path of deal_files, the bucket the size and the type).
 */

export const DEAL_FILES_BUCKET = "deal-files";

export const MAX_FILE_SIZE = 20 * 1024 * 1024;

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

const DOCUMENT_MIMES = new Set(
  Object.values(MIME_BY_EXTENSION).filter(
    (mime) =>
      !mime.startsWith("image/") &&
      !mime.startsWith("audio/") &&
      !mime.startsWith("video/"),
  ),
);

/** accept attribute of the file inputs */
export const FILE_ACCEPT = [
  "image/*",
  "video/*",
  "audio/*",
  ...Object.keys(MIME_BY_EXTENSION)
    .filter((extension) => DOCUMENT_MIMES.has(MIME_BY_EXTENSION[extension]))
    .map((extension) => `.${extension}`),
].join(",");

export const extensionOf = (name: string) => {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : "";
};

/** The type of a file: its own, else guessed from the name */
export const resolveMime = (mime: string | null | undefined, name = "") => {
  const own = (mime ?? "").split(";")[0].trim().toLowerCase();
  return own && own !== "application/octet-stream"
    ? own
    : (MIME_BY_EXTENSION[extensionOf(name)] ??
        (own || "application/octet-stream"));
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

export type FileProblem = "empty" | "too_large" | "type_not_allowed";

export const validateFile = ({
  name,
  size,
  type,
}: {
  name: string;
  size: number;
  type?: string | null;
}): FileProblem | null => {
  if (!name.trim() || size <= 0) return "empty";
  if (size > MAX_FILE_SIZE) return "too_large";
  if (!isAllowedMime(resolveMime(type, name))) return "type_not_allowed";
  return null;
};

/** «1,5 МБ», «320 КБ», «12 Б» */
export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} Б`;
  const format = (value: number) =>
    value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${format(bytes / 1024)} КБ`;
  return `${format(bytes / 1024 / 1024)} МБ`;
};

/** Storage keys are ASCII only: the real name stays in deal_files.name */
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

/** "<organization_id>/deals/<deal_id>/<uuid>-<name>": the storage policies check it */
export const dealFilePath = (
  organizationId: unknown,
  dealId: unknown,
  id: string,
  name: string,
) => `${organizationId}/deals/${dealId}/${id}-${storageSafeName(name)}`;

/** A demo file (FakeRest) is its own address */
export const isInlineFile = (path: string) =>
  path.startsWith("data:") || path.startsWith("blob:");

/**
 * Placeholder text of a received file («[Фото]: подпись», «[Файл x.pdf]»)
 * shown without the placeholder once the file itself is displayed.
 */
export const captionOf = (text: string | null | undefined) => {
  if (!text) return null;
  const match =
    /^\[(Фото|Видео|Аудио|Голосовое сообщение|Файл[^\]]*)\](?::\s*([\s\S]*))?$/.exec(
      text.trim(),
    );
  if (!match) return text;
  return match[2]?.trim() || null;
};
