import { type User } from "jsr:@supabase/supabase-js@2";
import { supabaseAdmin } from "./supabaseAdmin.ts";

/**
 * Get the sale associated to the provided user. An integrator whose access
 * expired (sales.access_expires_at, stage 25) is returned as disabled, like
 * the database helpers treat them.
 */
export const getUserSale = async (user: User) => {
  const sale = (
    await supabaseAdmin
      .from("sales")
      .select("*")
      .eq("user_id", user.id)
      .single()
  )?.data;
  if (
    sale?.access_expires_at &&
    new Date(sale.access_expires_at).getTime() <= Date.now()
  ) {
    return { ...sale, disabled: true };
  }
  return sale;
};
