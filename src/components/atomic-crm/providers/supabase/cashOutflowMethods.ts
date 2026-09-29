import type { Identifier } from "ra-core";

import type { CashExpenseRow, ExpenseMethod } from "../../payments/types";
import type { LabPaymentMethod } from "../../lab/types";
import { getSupabaseClient } from "./supabase";

/** What «Выдать из кассы» / «Оплатить» wrote */
export type CashLinkResult = {
  operation_id: Identifier | null;
  adjustment_id?: Identifier;
  payment_id?: Identifier;
};

/**
 * Money going out of the cash desk (stage 42). An expense is a row of the
 * resource account_operations (kind 'expense', a category of the resource
 * cash_expense_categories); lab payments are the resource lab_payments
 * (lists: lab_payments_summary). A payout of the payroll or a lab payment
 * «из кассы» goes through an RPC that writes the expense and links it.
 */
export const getCashOutflowMethods = () => ({
  /** Reports «Расходы по статьям» (public.report_cash_expenses) */
  async getCashExpensesReport(filters: {
    from?: string | null;
    to?: string | null;
    branch_id?: Identifier | null;
  }): Promise<CashExpenseRow[]> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_cash_expenses",
      {
        period_from: filters.from ?? null,
        period_to: filters.to ?? null,
        filter_branch_id: filters.branch_id ?? null,
      },
    );
    if (error) throw error;
    return (data as CashExpenseRow[]) ?? [];
  },
  /**
   * «Выплата» of the payroll; fromCash: «Выдать из кассы» — the expense
   * «Зарплата» in the open shift (public.record_payroll_payout)
   */
  async recordPayrollPayout(input: {
    doctor_id?: Identifier | null;
    sales_id?: Identifier | null;
    month: string;
    amount: number;
    day?: string | null;
    note?: string | null;
    fromCash?: boolean;
    method?: ExpenseMethod;
  }): Promise<CashLinkResult> {
    const { data, error } = await getSupabaseClient().rpc(
      "record_payroll_payout",
      {
        target_doctor_id: input.doctor_id ?? null,
        target_sales_id: input.sales_id ?? null,
        target_month: input.month,
        payout_amount: input.amount,
        payout_day: input.day ?? null,
        payout_note: input.note ?? null,
        from_cash: !!input.fromCash,
        payout_method: input.method ?? "cash",
      },
    );
    if (error) throw error;
    return data as CashLinkResult;
  },
  /**
   * «Оплатить» a lab for a month; fromCash — the expense «Лаборатория»;
   * allocations — the orders it pays, stage 43 (public.record_lab_payment)
   */
  async recordLabPayment(input: {
    lab_id: Identifier;
    month: string;
    amount: number;
    method: LabPaymentMethod;
    day?: string | null;
    comment?: string | null;
    fromCash?: boolean;
    allocations?: Array<{ order_id: Identifier; amount: number }>;
  }): Promise<CashLinkResult> {
    const { data, error } = await getSupabaseClient().rpc(
      "record_lab_payment",
      {
        target_lab_id: input.lab_id,
        target_month: input.month,
        payment_amount: input.amount,
        payment_method: input.method,
        payment_day: input.day ?? null,
        payment_comment: input.comment ?? null,
        from_cash: !!input.fromCash,
        payment_allocations: input.allocations?.length
          ? input.allocations
          : null,
      },
    );
    if (error) throw error;
    return data as CashLinkResult;
  },
});
