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

  const { error } = await supabaseAdmin.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(paths);

  if (error) {
    console.error("Failed to delete note attachments", {
      type: payload.type ?? null,
      paths,
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
