import type { PayrollMonth } from "../../payroll/types";
import { getSupabaseClient } from "./supabase";

/**
 * Payroll (stage 39). The schemes and the bonuses / penalties / payouts are
 * the resources payroll_schemes and payroll_adjustments; the month is
 * computed by the database (public.payroll_month).
 */
export const getPayrollMethods = () => ({
  /** «Зарплаты» of a month: any day of it, YYYY-MM-DD */
  async getPayrollMonth(month: string): Promise<PayrollMonth> {
    const { data, error } = await getSupabaseClient().rpc("payroll_month", {
      target_month: month,
    });
    if (error) throw error;
    return data as PayrollMonth;
  },
  /** «Закрыть месяц»: its lines are frozen */
  async closePayrollMonth(
    month: string,
  ): Promise<{ month: string; lines: number; accrued: number }> {
    const { data, error } = await getSupabaseClient().rpc(
      "close_payroll_month",
      { target_month: month },
    );
    if (error) throw error;
    return data as { month: string; lines: number; accrued: number };
  },
  /** «Открыть месяц» (the owner) */
  async reopenPayrollMonth(month: string): Promise<void> {
    const { error } = await getSupabaseClient().rpc("reopen_payroll_month", {
      target_month: month,
    });
    if (error) throw error;
  },
});
