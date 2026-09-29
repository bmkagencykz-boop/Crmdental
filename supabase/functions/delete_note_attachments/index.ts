import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { User } from "jsr:@supabase/supabase-js@2";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { isInOrganizationFolder } from "./isInOrganizationFolder.ts";

const ATTACHMENTS_BUCKET =
  Deno.env.get("VITE_ATTACHMENTS_BUCKET") || "attachments";

type NoteAttachment = {
  path?: string | null;
  src?: string | null;
};

type NoteRecord = {
  id?: number | string | null;
  attachments?: NoteAttachment[] | null;
};

type WebhookPayload = {
  type?: string | null;
  old_record?: NoteRecord | null;
  record?: NoteRecord | null;
};

const deleteNoteAttachments = async (req: Request, user?: User) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  const sale = user ? await getUserSale(user) : null;
  if (!sale || sale.disabled) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const payload = (await req.json()) as WebhookPayload;
  // Files are stored under "<organization_id>/": never touch another clinic's files
  const paths = getPathsToDelete(payload).filter((path) =>
    isInOrganizationFolder(path, sale.organization_id),
  );

  if (paths.length === 0) {
    return jsonResponse({
      status: "skipped",
      reason: "no_paths_to_delete",
    });
  }

  // Only files no note of the clinic still references: the payload comes
  // from the caller, a crafted one must not delete a live attachment
  const { data: inUse, error: inUseError } = await supabaseAdmin.rpc(
    "note_attachment_paths_in_use",
    { org_id: sale.organization_id, paths },
  );
  if (inUseError) {
    console.error("Failed to check note attachments", inUseError);
    return jsonResponse({ error: "Failed to delete note attachments" }, 500);
  }
  const kept = new Set((inUse ?? []) as string[]);
  const orphans = paths.filter((path) => !kept.has(path));
  if (orphans.length === 0) {
    return jsonResponse({ status: "skipped", reason: "still_in_use" });
  }

  const { error } = await supabaseAdmin.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(orphans);

  if (error) {
    console.error("Failed to delete note attachments", {
      type: payload.type ?? null,
      paths: orphans,
      error,
    });
    return jsonResponse({ error: "Failed to delete note attachments" }, 500);
  }

  return jsonResponse({
    status: "ok",
  });
};

Deno.serve(async (req: Request) =>
  AuthMiddleware(req, async (req: Request) =>
    UserMiddleware(req, async (req: Request, user?: User) =>
      deleteNoteAttachments(req, user),
    ),
  ),
);

const getPathsToDelete = (payload: WebhookPayload): string[] => {
  const oldPaths = extractAttachmentPaths(payload.old_record?.attachments);
  const newPaths = extractAttachmentPaths(payload.record?.attachments);

  if (payload.type === "UPDATE") {
    const newPathsSet = new Set(newPaths);
    return oldPaths.filter((path) => !newPathsSet.has(path));
  }

  if (payload.type === "DELETE") {
    return oldPaths;
  }

  return [];
};

const extractAttachmentPaths = (
  attachments?: NoteAttachment[] | null,
): string[] => {
  const paths = attachments
    ?.map((attachment) => extractAttachmentPath(attachment))
    .filter((path): path is string => path != null && path.length > 0);

  return paths ? Array.from(new Set(paths)) : [];
};

const extractAttachmentPath = (attachment?: NoteAttachment | null) => {
  if (!attachment) {
    return null;
  }

  if (attachment.path) {
    return normalizeStoragePath(attachment.path);
  }

  if (!attachment.src) {
    return null;
  }

  const pathname = getPathname(attachment.src);
  if (!pathname) {
    return null;
  }

  const bucketSegment = `/${ATTACHMENTS_BUCKET}/`;
  const bucketIndex = pathname.lastIndexOf(bucketSegment);
  if (bucketIndex < 0) {
    return null;
  }

  const path = pathname.slice(bucketIndex + bucketSegment.length);
  return normalizeStoragePath(path);
};

const getPathname = (value: string) => {
  try {
    return new URL(value, "http://localhost").pathname;
  } catch {
    return null;
  }
};

const safelyDecodePath = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const normalizeStoragePath = (path: string) => {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0) {
    return null;
  }

  const parsedPath = getPathname(trimmedPath);
  const candidatePath = parsedPath ?? trimmedPath;

  const bucketSegment = `/${ATTACHMENTS_BUCKET}/`;
  const bucketIndex = candidatePath.lastIndexOf(bucketSegment);
  const withoutBucket =
    bucketIndex >= 0
      ? candidatePath.slice(bucketIndex + bucketSegment.length)
      : candidatePath.replace(/^\/+/, "").replace(/^attachments\//, "");

  if (withoutBucket.length === 0) {
    return null;
  }

  return safelyDecodePath(withoutBucket);
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
