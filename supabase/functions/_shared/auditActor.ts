import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * A service-role client whose writes the audit log attributes to an employee
 * (header x-crm-actor, read by private.audit_actor() and only trusted from the
 * service role). Without it, a write of an edge function is logged without
 * author, with the source 'webhook'.
 */
export const supabaseAdminAs = (salesId: number | string): SupabaseClient =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { headers: { "x-crm-actor": String(salesId) } },
    },
  );
