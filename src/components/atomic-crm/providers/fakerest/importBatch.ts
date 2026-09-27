import type { DataProvider, GetListParams, Identifier } from "ra-core";

import type { BatchRow, ImportMode } from "../../import/importMapping";
import {
  customValuesDiff,
  sanitizeCustomValues,
} from "../../custom-fields/customFields";
import type {
  CustomField,
  CustomFieldEntity,
  CustomValues,
  Deal,
  DealPayment,
  ExternalRef,
  ImportBatchResult,
  LostReason,
  Patient,
  Pipeline,
  SaleRole,
  Stage,
} from "../../types";
import { normalizePatient, normalizePhone } from "../commons/domain";

const everything: GetListParams = {
  pagination: { page: 1, perPage: 1_000_000 },
  sort: { field: "id", order: "ASC" },
  filter: {},
};

const text = (value?: string | null) => value?.trim() || null;
const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

/**
 * Same as public.import_batch / private.import_row, for the demo. Writes go
 * straight to the FakeRest store, past the lifecycle callbacks: imported
 * deals get no rule tasks and skip the stage checklists, as in the database.
 */
export const importBatchInMemory = async ({
  base,
  kind,
  rows,
  role,
}: {
  base: DataProvider;
  kind: ImportMode;
  rows: BatchRow[];
  role?: SaleRole;
}): Promise<ImportBatchResult> => {
  if (role !== "owner" && role !== "head") {
    throw new Error("Импорт доступен владельцу и руководителю клиники");
  }
  // A collection the store has never seen (external_refs of an older demo
  // database) is empty
  const all = async <T>(resource: string) => {
    try {
      return (await base.getList(resource, everything)).data as T[];
    } catch {
      return [] as T[];
    }
  };
  const result: ImportBatchResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    patients_created: 0,
    patients_updated: 0,
    deals_created: 0,
    deals_updated: 0,
    errors: [],
  };
  const [pipelines, stages, lostReasons, customFields] = await Promise.all([
    all<Pipeline>("pipelines"),
    all<Stage>("stages"),
    all<LostReason>("lost_reasons"),
    all<CustomField>("custom_fields"),
  ]);
  // Custom fields of the file: checked like the database does, an existing
  // row only gets the fields it has no value for
  const importedValues = (
    entity: CustomFieldEntity,
    incoming: CustomValues | null | undefined,
    previous?: CustomValues | null,
  ): CustomValues | undefined => {
    const before = previous ?? {};
    if (!incoming || typeof incoming !== "object") return previous ?? {};
    const values = sanitizeCustomValues({
      fields: customFields,
      entity,
      previous: before,
      next: { ...incoming, ...before },
    });
    // Unchanged: the row as it was (no false "updated")
    return Object.keys(customValuesDiff(before, values)).length
      ? values
      : (previous ?? {});
  };

  const findRef = async (
    entity: ExternalRef["entity"],
    system: string,
    externalId: string,
  ) =>
    (await all<ExternalRef & { id: Identifier }>("external_refs")).find(
      (ref) =>
        ref.entity === entity &&
        ref.system === system &&
        ref.external_id === externalId,
    );
  const saveRef = async (
    entity: ExternalRef["entity"],
    system: string,
    externalId: string,
    entityId: Identifier,
  ) => {
    const ref = await findRef(entity, system, externalId);
    if (ref) {
      if (!same(ref.entity_id, entityId)) {
        await base.update("external_refs", {
          id: ref.id,
          data: { entity_id: entityId },
          previousData: ref,
        });
      }
      return;
    }
    await base.create("external_refs", {
      data: {
        entity,
        entity_id: entityId,
        system,
        external_id: externalId,
        created_at: new Date().toISOString(),
      },
    });
  };

  const importRow = async (row: BatchRow) => {
    const system = row.system || "excel";
    const p = row.patient;
    const phones = [
      ...new Set(
        p.phones.map((phone) => normalizePhone(phone)).filter(Boolean),
      ),
    ] as string[];
    const patientExt = text(p.external_id);
    if (
      !phones.length &&
      !patientExt &&
      !text(p.first_name) &&
      !text(p.last_name)
    ) {
      throw new Error("Нет ни имени, ни телефона пациента");
    }
    const patients = await all<Patient>("patients");
    let patient: Patient | undefined;
    if (patientExt) {
      const ref = await findRef("patient", system, patientExt);
      patient = ref && patients.find((pt) => same(pt.id, ref.entity_id));
    }
    if (!patient && phones.length) {
      patient = patients.find((pt) =>
        pt.phones?.some((n) => phones.includes(n)),
      );
    }
    if (!patient && !phones.length) {
      const key = (v?: string | null) => (v ?? "").trim().toLowerCase();
      patient = patients.find(
        (pt) =>
          !pt.phones?.length &&
          key(pt.last_name) === key(p.last_name) &&
          key(pt.first_name) === key(p.first_name) &&
          key(pt.middle_name) === key(p.middle_name) &&
          (pt.birth_date ?? null) === (p.birth_date ?? null),
      );
    }

    let patientOutcome: "created" | "updated" | "skipped";
    if (!patient) {
      const created = p.created_at ?? new Date().toISOString();
      const { data } = await base.create<Patient>("patients", {
        data: normalizePatient({
          first_name: text(p.first_name) ?? undefined,
          last_name: text(p.last_name) ?? undefined,
          middle_name: text(p.middle_name),
          phone_jsonb: phones.map((number) => ({ number, type: "Mobile" })),
          birth_date: p.birth_date ?? null,
          city: text(p.city),
          source_id: p.source_id ?? null,
          sales_id: p.sales_id ?? null,
          tags: (p.tags ?? []).map(Number),
          background: text(p.background),
          first_seen: created,
          last_seen: created,
          custom_values: importedValues("patient", p.custom_values),
        }) as Patient,
      });
      patient = data;
      patientOutcome = "created";
    } else {
      const previous = patient;
      const next = normalizePatient({
        ...previous,
        first_name:
          previous.first_name || text(p.first_name) || previous.first_name,
        last_name:
          previous.last_name || text(p.last_name) || previous.last_name,
        middle_name: previous.middle_name || text(p.middle_name),
        phone_jsonb: [
          ...previous.phone_jsonb,
          ...phones
            .filter((n) => !previous.phones?.includes(n))
            .map((number) => ({ number, type: "Mobile" })),
        ],
        birth_date: previous.birth_date ?? p.birth_date ?? null,
        city: previous.city ?? text(p.city),
        source_id: previous.source_id ?? p.source_id ?? null,
        sales_id: previous.sales_id ?? p.sales_id ?? null,
        tags: [
          ...previous.tags,
          ...(p.tags ?? [])
            .map(Number)
            .filter((t) => !previous.tags.includes(t)),
        ],
        background: previous.background || text(p.background),
        custom_values: importedValues(
          "patient",
          p.custom_values,
          previous.custom_values,
        ),
      });
      if (JSON.stringify(next) !== JSON.stringify(normalizePatient(previous))) {
        const { data } = await base.update<Patient>("patients", {
          id: previous.id,
          data: next,
          previousData: previous,
        });
        patient = data;
        patientOutcome = "updated";
      } else {
        patientOutcome = "skipped";
      }
    }
    if (patientExt) await saveRef("patient", system, patientExt, patient.id);

    if (kind !== "deals" || !row.deal) {
      return { patient: patientOutcome };
    }

    const d = row.deal;
    const dealExt = text(d.external_id);
    const name = text(d.name) ?? "Обращение";
    const deals = await all<Deal>("deals");
    let deal: Deal | undefined;
    if (dealExt) {
      const ref = await findRef("deal", system, dealExt);
      deal = ref && deals.find((dl) => same(dl.id, ref.entity_id));
    } else {
      deal = deals.find(
        (dl) =>
          same(dl.patient_id, patient!.id) &&
          (dl.name ?? "").trim().toLowerCase() === name.toLowerCase(),
      );
    }
    const target =
      d.stage_id != null
        ? stages.find((s) => same(s.id, d.stage_id))
        : undefined;
    if (d.stage_id != null && !target) throw new Error("Этап не найден");
    const reasonId =
      d.lost_reason_id ??
      (target?.kind === "lost"
        ? ([...lostReasons].sort(
            (a, b) =>
              Number(b.name === "Другое") - Number(a.name === "Другое") ||
              a.position - b.position,
          )[0]?.id ?? null)
        : null);
    const paid = Math.round(Number(d.paid_amount ?? 0));
    const now = new Date().toISOString();

    let dealOutcome: "created" | "updated" | "skipped";
    if (!deal) {
      const pipelineId =
        target?.pipeline_id ??
        (pipelines.find((pl) => pl.is_default) ?? pipelines[0])?.id;
      const stage =
        target ??
        stages
          .filter((s) => same(s.pipeline_id, pipelineId))
          .sort((a, b) => a.position - b.position)[0];
      if (stage?.kind === "lost" && reasonId == null) {
        throw new Error("Укажите причину отказа");
      }
      const created = d.created_at ?? now;
      const { data } = await base.create<Deal>("deals", {
        data: {
          patient_id: patient.id,
          pipeline_id: pipelineId,
          stage_id: stage?.id,
          name,
          source_id: d.source_id ?? null,
          service_id: d.service_id ?? null,
          plan_amount: Math.round(Number(d.plan_amount ?? 0)),
          paid_amount: 0,
          sales_id: d.sales_id ?? null,
          lost_reason_id: stage?.kind === "lost" ? reasonId : null,
          tags: (d.tags ?? []).map(Number),
          description: text(d.description),
          custom_values: importedValues("deal", d.custom_values),
          index: 0,
          created_at: created,
          updated_at: now,
          stage_changed_at: created,
          closed_at: stage?.kind === "open" ? null : created,
        } as Partial<Deal>,
      });
      deal = data;
      await base.create("deal_events", {
        data: {
          deal_id: deal.id,
          type: "created",
          to_stage_id: deal.stage_id,
          changes: {},
          created_at: now,
        },
      });
      // Same as handle_deal_after_write: the first deal fills the patient
      if (patient.source_id == null && deal.source_id != null) {
        patient = (
          await base.update<Patient>("patients", {
            id: patient.id,
            data: { source_id: deal.source_id },
            previousData: patient,
          })
        ).data;
      }
      if (patient.sales_id == null && deal.sales_id != null) {
        await base.update<Patient>("patients", {
          id: patient.id,
          data: { sales_id: deal.sales_id },
          previousData: patient,
        });
      }
      dealOutcome = "created";
    } else {
      const previous = deal;
      const currentKind = stages.find((s) =>
        same(s.id, previous.stage_id),
      )?.kind;
      const moves =
        target != null &&
        same(target.pipeline_id, previous.pipeline_id) &&
        currentKind !== "lost";
      const next: Deal = {
        ...previous,
        plan_amount:
          d.plan_amount != null
            ? Math.round(Number(d.plan_amount))
            : previous.plan_amount,
        source_id: previous.source_id ?? d.source_id ?? null,
        service_id: previous.service_id ?? d.service_id ?? null,
        sales_id: previous.sales_id ?? d.sales_id ?? null,
        tags: [
          ...previous.tags,
          ...(d.tags ?? [])
            .map(Number)
            .filter((t) => !previous.tags.includes(t)),
        ],
        description: previous.description || text(d.description),
        custom_values: importedValues(
          "deal",
          d.custom_values,
          previous.custom_values,
        ),
        stage_id: moves ? target!.id : previous.stage_id,
        lost_reason_id:
          moves && target!.kind === "lost"
            ? (previous.lost_reason_id ?? reasonId)
            : previous.lost_reason_id,
      };
      if (JSON.stringify(next) !== JSON.stringify(previous)) {
        const stageChanged = !same(next.stage_id, previous.stage_id);
        const kindNow = stages.find((s) => same(s.id, next.stage_id))?.kind;
        deal = (
          await base.update<Deal>("deals", {
            id: previous.id,
            data: {
              ...next,
              updated_at: now,
              ...(stageChanged
                ? {
                    stage_changed_at: now,
                    closed_at: kindNow === "open" ? null : now,
                  }
                : {}),
            },
            previousData: previous,
          })
        ).data;
        if (stageChanged) {
          await base.create("deal_events", {
            data: {
              deal_id: deal.id,
              type: "stage_changed",
              from_stage_id: previous.stage_id,
              to_stage_id: deal.stage_id,
              changes: {},
              created_at: now,
            },
          });
        }
        dealOutcome = "updated";
      } else {
        dealOutcome = "skipped";
      }
    }

    if (paid > Number(deal.paid_amount ?? 0)) {
      await base.create<DealPayment>("deal_payments", {
        data: {
          deal_id: deal.id,
          amount: paid - Number(deal.paid_amount ?? 0),
          paid_at: (d.created_at ?? now).slice(0, 10),
          comment: "Импорт",
          sales_id: null,
          created_at: now,
        },
      });
      await base.update<Deal>("deals", {
        id: deal.id,
        data: { paid_amount: paid },
        previousData: deal,
      });
      if (dealOutcome === "skipped") dealOutcome = "updated";
    }
    if (dealExt) await saveRef("deal", system, dealExt, deal.id);
    return { patient: patientOutcome, deal: dealOutcome };
  };

  for (const [position, row] of rows.entries()) {
    try {
      const outcome = await importRow(row);
      const outcomes = [
        outcome.patient,
        "deal" in outcome ? outcome.deal : null,
      ];
      const rowOutcome = outcomes.includes("created")
        ? "created"
        : outcomes.includes("updated")
          ? "updated"
          : "skipped";
      result[rowOutcome] += 1;
      if (outcome.patient !== "skipped") {
        result[`patients_${outcome.patient}`] += 1;
      }
      if ("deal" in outcome && outcome.deal && outcome.deal !== "skipped") {
        result[`deals_${outcome.deal}`] += 1;
      }
    } catch (error) {
      result.errors.push({
        index: row.index ?? position + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
};
