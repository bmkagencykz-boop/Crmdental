import type { DataProvider, Identifier } from "ra-core";

import {
  duplicateGroupRows,
  mergePatientRecords,
  patientDuplicates,
  patientLabel,
  type DuplicateGroupRow,
  type MergeChoices,
  type PatientDuplicate,
} from "../../duplicates/duplicates";
import type { MailingMessage } from "../../mailings/types";
import type {
  Call,
  Deal,
  DealNote,
  LostReason,
  Message,
  OrganizationSettings,
  Patient,
  Sale,
  Stage,
  Task,
} from "../../types";
import { defaultAcceptStage, unsortedLeads } from "../../unsorted/unsorted";
import { normalizePatient } from "../commons/domain";

const SPAM_REASON = "Спам / не целевое";

/**
 * «Неразобранное» and duplicate patients of the demo (stage 18): the same
 * rules as the database (supabase/schemas/18_unsorted_duplicates.sql) on the
 * in-browser data. The deal triggers (automations when a lead is accepted)
 * are the deal callbacks of dataProvider.ts.
 */
export const createUnsortedDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getDataProvider,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  /** The provider with the lifecycle callbacks (deal triggers) */
  getDataProvider: () => DataProvider;
}) => {
  const same = (a: unknown, b: unknown) => a != null && String(a) === String(b);

  const getDeal = async (id: Identifier) => {
    const deal = (await all<Deal>("deals")).find((d) => same(d.id, id));
    if (!deal) throw new Error("Сделка не найдена");
    return deal;
  };

  const unsortedDeal = async (id: Identifier) => {
    const deal = await getDeal(id);
    if (!deal.unsorted_at) throw new Error("unsorted.errors.not_unsorted");
    return deal;
  };

  // Same as private.next_responsible (round robin among the chosen employees)
  const nextResponsible = async (): Promise<Identifier | null> => {
    const [settings] = await all<OrganizationSettings & { id: number }>(
      "organization_settings",
    );
    if (settings?.lead_distribution !== "round_robin") return null;
    const sales = await all<Sale>("sales");
    const chosen = settings.lead_distribution_sales_ids.filter((id) =>
      sales.some((sale) => same(sale.id, id) && !sale.disabled),
    );
    if (!chosen.length) return null;
    const last = chosen.findIndex((id) =>
      same(id, settings.last_distributed_sales_id),
    );
    const next = chosen[(last + 1) % chosen.length];
    await baseDataProvider.update("organization_settings", {
      id: settings.id,
      data: { last_distributed_sales_id: next },
      previousData: settings,
    });
    return next;
  };

  // Same as private.spam_lost_reason
  const spamReason = async (): Promise<Identifier> => {
    const reasons = await all<LostReason>("lost_reasons");
    const existing =
      reasons.find((r) => r.code === "spam") ??
      reasons.find(
        (r) =>
          !r.code && r.name.trim().toLowerCase() === SPAM_REASON.toLowerCase(),
      );
    if (existing) {
      if (existing.code !== "spam") {
        await baseDataProvider.update("lost_reasons", {
          id: existing.id,
          data: { code: "spam" },
          previousData: existing,
        });
      }
      return existing.id;
    }
    const { data } = await baseDataProvider.create<LostReason>("lost_reasons", {
      data: {
        name: SPAM_REASON,
        code: "spam",
        position: Math.max(-1, ...reasons.map((r) => r.position)) + 1,
        is_archived: false,
      },
    });
    return data.id;
  };

  const moveRows = async <T extends { id: Identifier }>(
    resource: string,
    match: (row: T) => boolean,
    data: Partial<T>,
  ) => {
    const rows = (await all<T>(resource).catch(() => [] as T[])).filter(match);
    for (const row of rows) {
      await baseDataProvider.update(resource, {
        id: row.id,
        data,
        previousData: row,
      });
    }
  };

  const checkManager = async () => {
    const salesId = await currentSalesId();
    const me = (await all<Sale>("sales")).find((sale) =>
      same(sale.id, salesId),
    );
    if (me?.role !== "owner" && me?.role !== "head") {
      throw new Error("duplicates.errors.forbidden");
    }
  };

  // Same as private.merge_patient_rows
  const mergePatientRows = async (
    keepId: Identifier,
    mergeId: Identifier,
    choices: MergeChoices,
  ) => {
    if (same(keepId, mergeId)) throw new Error("duplicates.errors.same");
    const patients = await all<Patient>("patients");
    const keep = patients.find((p) => same(p.id, keepId));
    const merge = patients.find((p) => same(p.id, mergeId));
    if (!keep || !merge) throw new Error("duplicates.errors.not_found");
    const ofMerged = (row: { patient_id: Identifier }) =>
      same(row.patient_id, mergeId);

    // A mailing reaches a patient once
    const mailingRows = await all<MailingMessage>("mailing_messages").catch(
      () => [] as MailingMessage[],
    );
    for (const row of mailingRows.filter(
      (r) =>
        ofMerged(r) &&
        r.mailing_id != null &&
        mailingRows.some(
          (k) => same(k.mailing_id, r.mailing_id) && same(k.patient_id, keepId),
        ),
    )) {
      await baseDataProvider.delete("mailing_messages", {
        id: row.id,
        previousData: row,
      });
    }
    for (const resource of [
      "patient_notes",
      "calls",
      "messages",
      "notifications",
      "recalls",
      "mailing_messages",
      "patient_chats",
      "lead_submissions",
      // Stages 28–40: the schedule, plans, money, the patient card, the
      // waiting list, the lab (private.merge_patient_rows moves every row)
      "visits",
      "treatment_plans",
      "account_operations",
      "patient_tooth_history",
      "visit_records",
      "patient_consents",
      "patient_files",
      "deal_files",
      "waiting_list",
      "lab_orders",
      "mis_appointments",
    ]) {
      await moveRows<any>(resource, ofMerged, { patient_id: keepId });
    }
    // One row per tooth and one questionnaire: the kept patient's own wins
    for (const [resource, sameRow] of [
      ["patient_teeth", (a: any, b: any) => a.tooth === b.tooth],
      ["patient_questionnaires", () => true],
    ] as const) {
      const rows = await all<any>(resource).catch(() => [] as any[]);
      const kept = rows.filter((row) => same(row.patient_id, keepId));
      for (const row of rows.filter(ofMerged)) {
        if (kept.some((k) => sameRow(k, row))) {
          await baseDataProvider.delete(resource, {
            id: row.id,
            previousData: row,
          });
        } else {
          await baseDataProvider.update(resource, {
            id: row.id,
            data: { patient_id: keepId },
            previousData: row,
          });
        }
      }
    }
    for (const deal of (await all<Deal>("deals")).filter(ofMerged)) {
      await getDataProvider().update("deals", {
        id: deal.id,
        data: { patient_id: keepId },
        previousData: deal,
      });
    }
    await moveRows<any>(
      "external_refs",
      (ref) => ref.entity === "patient" && same(ref.entity_id, mergeId),
      { entity_id: keepId },
    );
    await baseDataProvider.delete("patients", {
      id: merge.id,
      previousData: merge,
    });
    const merged = normalizePatient(mergePatientRecords(keep, merge, choices));
    await baseDataProvider.update("patients", {
      id: keep.id,
      data: merged,
      previousData: keep,
    });
    const salesId = (await currentSalesId()) ?? null;
    await baseDataProvider.create("audit_log", {
      data: {
        at: new Date().toISOString(),
        sales_id: salesId,
        source: salesId == null ? "system" : "user",
        entity: "patient",
        entity_id: keep.id,
        action: "merge",
        changes: {
          merged_patient_id: [merge.id, keep.id],
          merged_patient: [patientLabel(merge), patientLabel(merged)],
        },
        deal_id: null,
        patient_id: keep.id,
      },
    });
    return keep.id;
  };

  const methods = {
    // Same as public.accept_unsorted
    acceptUnsorted: async (
      dealId: Identifier,
      stageId?: Identifier | null,
      salesId?: Identifier | null,
    ): Promise<void> => {
      const deal = await unsortedDeal(dealId);
      const stages = await all<Stage>("stages");
      const stage =
        stageId != null
          ? stages.find((s) => same(s.id, stageId))
          : defaultAcceptStage(stages, deal.pipeline_id);
      if (!stage || stage.kind !== "open") {
        throw new Error("unsorted.errors.stage_not_open");
      }
      const responsible =
        salesId ?? deal.sales_id ?? (await nextResponsible()) ?? null;
      await getDataProvider().update("deals", {
        id: deal.id,
        data: {
          unsorted_at: null,
          pipeline_id: stage.pipeline_id,
          stage_id: stage.id,
          sales_id: responsible,
        },
        previousData: deal,
      });
    },
    // Same as public.reject_unsorted
    rejectUnsorted: async (
      dealId: Identifier,
      comment?: string,
    ): Promise<void> => {
      const deal = await unsortedDeal(dealId);
      const lost = (await all<Stage>("stages"))
        .filter(
          (s) => same(s.pipeline_id, deal.pipeline_id) && s.kind === "lost",
        )
        .sort((a, b) => a.position - b.position)[0];
      await getDataProvider().update("deals", {
        id: deal.id,
        data: {
          unsorted_at: null,
          stage_id: lost.id,
          lost_reason_id: await spamReason(),
          lost_comment: comment?.trim() || null,
        },
        previousData: deal,
      });
      await moveRows<Task>(
        "tasks",
        (task) => same(task.deal_id, deal.id) && !task.done_date,
        { done_date: new Date().toISOString() },
      );
    },
    // Same as public.merge_unsorted
    mergeUnsorted: async (
      dealId: Identifier,
      targetDealId: Identifier,
    ): Promise<{
      deal_id: Identifier;
      merged_patient_id: Identifier | null;
    }> => {
      const lead = await unsortedDeal(dealId);
      const target = await getDeal(targetDealId);
      const stage = (await all<Stage>("stages")).find((s) =>
        same(s.id, target.stage_id),
      );
      if (
        same(target.id, lead.id) ||
        target.archived_at ||
        stage?.kind !== "open"
      ) {
        throw new Error("unsorted.errors.merge_target");
      }
      const ofLead = (row: { deal_id?: Identifier | null }) =>
        same(row.deal_id, lead.id);
      await moveRows<Message>("messages", ofLead, {
        deal_id: target.id,
        patient_id: target.patient_id,
      });
      await moveRows<Call>("calls", ofLead, {
        deal_id: target.id,
        patient_id: target.patient_id,
      });
      await moveRows<DealNote>("deal_notes", ofLead, { deal_id: target.id });
      for (const task of (await all<Task>("tasks")).filter(ofLead)) {
        await baseDataProvider.update("tasks", {
          id: task.id,
          data: {
            deal_id: target.id,
            sales_id: task.sales_id ?? target.sales_id ?? undefined,
          },
          previousData: task,
        });
      }
      await moveRows<any>("deal_payments", ofLead, { deal_id: target.id });
      await moveRows<any>("notifications", ofLead, {
        deal_id: target.id,
        patient_id: target.patient_id,
      });
      await moveRows<any>("mailing_messages", ofLead, { deal_id: target.id });
      await baseDataProvider.update("deals", {
        id: target.id,
        data: { updated_at: new Date().toISOString() },
        previousData: target,
      });
      await baseDataProvider.delete("deals", {
        id: lead.id,
        previousData: lead,
      });
      let merged: Identifier | null = null;
      if (
        !same(lead.patient_id, target.patient_id) &&
        !(await all<Deal>("deals")).some((d) =>
          same(d.patient_id, lead.patient_id),
        )
      ) {
        await mergePatientRows(target.patient_id, lead.patient_id, {});
        merged = lead.patient_id;
      }
      return { deal_id: target.id, merged_patient_id: merged };
    },
    // Same as public.patient_duplicates (the demo keeps no chat table)
    getPatientDuplicates: async (
      patientId: Identifier,
    ): Promise<PatientDuplicate[]> =>
      patientDuplicates(patientId, await all<Patient>("patients")),
    // Same as public.duplicate_groups
    getDuplicateGroups: async (): Promise<DuplicateGroupRow[]> => {
      const counts = new Map<string, number>();
      for (const deal of await all<Deal>("deals")) {
        const key = String(deal.patient_id);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return duplicateGroupRows(await all<Patient>("patients"), [], counts);
    },
    // Same as public.merge_patients (owner and head)
    mergePatients: async (
      keepId: Identifier,
      mergeId: Identifier,
      choices: MergeChoices,
    ): Promise<Identifier> => {
      await checkManager();
      return mergePatientRows(keepId, mergeId, choices);
    },
  };

  const views: Record<string, () => Promise<any[]>> = {
    unsorted_leads: async () => {
      const [deals, patients, messages, notes, calls] = await Promise.all([
        all<Deal>("deals"),
        all<Patient>("patients"),
        all<Message>("messages"),
        all<DealNote>("deal_notes"),
        all<Call>("calls"),
      ]);
      return unsortedLeads({ deals, patients, messages, notes, calls });
    },
  };

  return { methods, views };
};
