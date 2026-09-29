import type { Identifier } from "ra-core";

import type {
  LabFault,
  LabQualityReport,
  LabReconciliation,
} from "../../lab/types";
import { getSupabaseClient } from "./supabase";

/**
 * The lab module of stage 43: «Переделка» with its reason and fault
 * (public.lab_order_remake), the quality report (public.report_lab_quality)
 * and the reconciliation act (public.report_lab_reconciliation). The
 * rest are resources: lab_order_remakes, lab_order_events,
 * lab_remake_reasons, lab_work_type_terms, lab_payment_allocations,
 * lab_order_balances.
 */
export const getLabPlusMethods = () => ({
  async labOrderRemake(input: {
    order_id: Identifier;
    reason_id?: Identifier | null;
    reason?: string | null;
    fault?: LabFault | null;
    comment?: string | null;
  }): Promise<Identifier> {
    const { data, error } = await getSupabaseClient().rpc("lab_order_remake", {
      target_order_id: input.order_id,
      target_reason_id: input.reason_id ?? null,
      reason_text: input.reason ?? null,
      remake_fault: input.fault ?? null,
      remake_comment: input.comment ?? null,
    });
    if (error) throw error;
    return data as Identifier;
  },
  async getLabQualityReport(filters: {
    from: string;
    to: string;
    branch_id?: Identifier | null;
  }): Promise<LabQualityReport> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_lab_quality",
      {
        period_from: filters.from,
        period_to: filters.to,
        filter_branch_id: filters.branch_id ?? null,
      },
    );
    if (error) throw error;
    return data as LabQualityReport;
  },
  async getLabReconciliation(input: {
    lab_id: Identifier;
    from: string;
    to: string;
  }): Promise<LabReconciliation> {
    const { data, error } = await getSupabaseClient().rpc(
      "report_lab_reconciliation",
      {
        target_lab_id: input.lab_id,
        period_from: input.from,
        period_to: input.to,
      },
    );
    if (error) throw error;
    return data as LabReconciliation;
  },
});
