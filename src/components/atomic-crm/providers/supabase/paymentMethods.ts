import type { Identifier } from "ra-core";

import type { CashMethodRow, ShiftClosing } from "../../payments/types";
import { getSupabaseClient } from "./supabase";

/**
 * Payments, deposits and the cash desk (stage 36). The operations are the
 * resource account_operations (lists: account_operations_summary), the
 * accounts patient_accounts, the shifts cash_shifts; the database keeps the
 * balances, the deal payments and deals.paid_amount in sync.
 */
export const getPaymentMethods = () => ({
  /** «Открыть смену» (public.open_cash_shift) */
  async openCashShift(
    openingCash: number,
    branchId?: Identifier | null,
  ): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc("open_cash_shift", {
      opening_cash: openingCash,
      target_branch_id: branchId ?? null,
    });
    if (error) throw error;
    return data as Identifier;
  },
  /** «Закрыть смену»: the cash counted (public.close_cash_shift) */
  async closeCashShift(
    shiftId: Identifier,
    countedCash: number,
    note?: string | null,
  ): Promise<ShiftClosing> {
    const { data, error } = await getSupabaseClient().rpc("close_cash_shift", {
      target_shift_id: shiftId,
      counted_cash: countedCash,
      note: note ?? null,
    });
    if (error) throw error;
    return data as ShiftClosing;
  },
  /** The cash expected in an open shift (public.cash_shift_expected) */
  async cashShiftExpected(shiftId: Identifier): Promise<number> {
    const { data, error } = await getSupabaseClient().rpc(
      "cash_shift_expected",
      { target_shift_id: shiftId },
    );
    if (error) throw error;
    return Number(data ?? 0);
  },
  /**
   * «Оплачено» of a treatment plan (public.plan_paid_amount): its
   * operations and, for the main plan, those of its deal without a plan
   */
  async planPaidAmount(planId: Identifier): Promise<number> {
    const { data, error } = await getSupabaseClient().rpc("plan_paid_amount", {
      target_plan_id: planId,
    });
    if (error) throw error;
    return Number(data ?? 0);
  },
  /** Money in and out of the till by method (public.report_cash_methods) */
  async getCashMethodsReport(filters: {
    from?: string | null;
    to?: string | null;
    branch_id?: Identifier | null;
  }): Promise<CashMethodRow[]> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_cash_methods",
      {
        period_from: filters.from ?? null,
        period_to: filters.to ?? null,
        filter_branch_id: filters.branch_id ?? null,
      },
    );
    if (error) throw error;
    return (data as CashMethodRow[]) ?? [];
  },
});
