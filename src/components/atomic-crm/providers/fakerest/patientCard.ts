import type {
  DataProvider,
  GetListResult,
  Identifier,
  ResourceCallbacks,
} from "ra-core";

import { resolveMime, validateFile } from "../../files/fileTypes";
import { normalizeIcdCode } from "../../patient-card/icd10";
import { parseIin } from "../../patient-card/iin";
import {
  plannedToothStates,
  toothChange,
} from "../../patient-card/toothStates";
import {
  QUESTIONS,
  TOOTH_STATES,
  type PatientConsent,
  type PatientFile,
  type PatientFileKind,
  type PatientQuestionnaire,
  type PatientTooth,
  type ToothHistoryRow,
  type VisitRecord,
} from "../../patient-card/types";
import { isTooth } from "../../dental-chart/teeth";
import type { Visit } from "../../schedule/types";
import type { TreatmentPlan, TreatmentPlanItem } from "../../treatment/types";
import type { AuditLogEntry, Patient, Sale } from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

/** Medical resources: never for the integrator (stage 25) */
export const MEDICAL_RESOURCES = [
  "patient_teeth",
  "patient_tooth_history",
  "visit_records",
  "visit_record_templates",
  "patient_questionnaires",
  "consent_templates",
  "patient_consents",
  "patient_files",
];

const RECORD_AUDITED = [
  "visit_id",
  "doctor_id",
  "record_date",
  "complaints",
  "anamnesis",
  "objective",
  "diagnosis_codes",
  "diagnosis",
  "treatment",
  "recommendations",
] as const;

const diff = (
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: readonly string[],
) => {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = [a, b];
  }
  return changes;
};

/**
 * The full patient card of the demo (stage 37): the same rules as
 * supabase/schemas/37_patient_card.sql — the IIN (checked, the birth date
 * and the sex derived), one row per tooth with its history (who, when, the
 * plan item), the states of the done plan items, visit records bound to a
 * visit of the patient, the questionnaire, consents, patient files (data:
 * URLs), rights (the integrator sees nothing medical; managers write;
 * deleting — the owner, the head or the author) and the audit log.
 */
export const createPatientCardDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  logAudit,
  patientVisible,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  logAudit: (
    row: Omit<AuditLogEntry, "id" | "at" | "sales_id" | "source">,
  ) => Promise<unknown>;
  /** The patient is visible to the employee (access rights, stage 30) */
  patientVisible: (patientId: Identifier) => Promise<boolean>;
}) => {
  const me = async () => {
    const id = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, id));
  };
  // The demo's default user (no staff row) is the owner
  const myRole = async () => (await me())?.role ?? "owner";
  const canWrite = async () =>
    ["owner", "head", "manager"].includes(await myRole());
  const requireWriter = async (patientId?: Identifier | null) => {
    if (!(await canWrite())) {
      throw fail("Нет права менять медицинские данные", "42501");
    }
    if (patientId != null && !(await patientVisible(patientId))) {
      throw fail("Пациент недоступен", "42501");
    }
  };
  /** Owner, head, or the author of the row */
  const requireDeleter = async (authorId: Identifier | null | undefined) => {
    const role = await myRole();
    if (role === "owner" || role === "head") return;
    if (role === "manager" && same(authorId, await currentSalesId())) return;
    throw fail("Удалить может владелец, руководитель или автор", "42501");
  };

  // --- the dental chart -------------------------------------------------

  let toothSource: { source: "manual" | "plan"; itemId: Identifier | null } = {
    source: "manual",
    itemId: null,
  };
  const previousTeeth = new Map<string, PatientTooth>();

  const writeHistory = async (
    before: PatientTooth | null,
    after: PatientTooth | null,
  ) => {
    const change = toothChange(before, after);
    const row = (after ?? before)!;
    if (!change) return;
    await baseDataProvider.create<ToothHistoryRow>("patient_tooth_history", {
      data: {
        patient_id: row.patient_id,
        tooth: row.tooth,
        ...change,
        sales_id: (await currentSalesId()) ?? null,
        source: toothSource.source,
        plan_item_id: toothSource.source === "plan" ? toothSource.itemId : null,
        created_at: new Date().toISOString(),
      } as ToothHistoryRow,
    });
    await logAudit({
      entity: "patient_tooth",
      entity_id: row.id,
      action: !before ? "create" : !after ? "delete" : "update",
      changes: diff(
        before as Record<string, unknown> | null,
        after as Record<string, unknown> | null,
        ["tooth", "state", "note"],
      ) as AuditLogEntry["changes"],
      patient_id: row.patient_id,
    });
  };

  const checkTooth = (data: Partial<PatientTooth>) => {
    if (data.tooth != null && !isTooth(Number(data.tooth))) {
      throw fail("Нет такого зуба", "23514");
    }
    if (data.state != null && !TOOTH_STATES.includes(data.state)) {
      throw fail("Неизвестное состояние зуба", "23514");
    }
  };

  /** Sets a tooth as the database would (insert or update of the row) */
  const setTooth = async (
    patientId: Identifier,
    tooth: number,
    state: PatientTooth["state"],
  ) => {
    const existing = (await all<PatientTooth>("patient_teeth")).find(
      (row) => same(row.patient_id, patientId) && row.tooth === tooth,
    );
    const now = new Date().toISOString();
    const salesId = (await currentSalesId()) ?? null;
    if (existing) {
      if (existing.state === state) return;
      const { data } = await baseDataProvider.update<PatientTooth>(
        "patient_teeth",
        {
          id: existing.id,
          data: { state, updated_at: now, updated_by: salesId },
          previousData: existing,
        },
      );
      await writeHistory(existing, data);
      return;
    }
    const { data } = await baseDataProvider.create<PatientTooth>(
      "patient_teeth",
      {
        data: {
          patient_id: patientId,
          tooth,
          state,
          note: null,
          updated_at: now,
          updated_by: salesId,
          created_at: now,
        } as PatientTooth,
      },
    );
    await writeHistory(null, data);
  };

  const previousItems = new Map<string, boolean>();
  /** The trigger of the plan items: a done service sets its teeth */
  const applyPlanItem = async (item: TreatmentPlanItem) => {
    const wasDone = previousItems.get(String(item.id)) ?? false;
    previousItems.delete(String(item.id));
    const rows = plannedToothStates(item, wasDone);
    if (!rows.length) return;
    const plan = (await all<TreatmentPlan>("treatment_plans")).find((p) =>
      same(p.id, item.plan_id),
    );
    if (!plan) return;
    toothSource = { source: "plan", itemId: item.id };
    try {
      for (const row of rows)
        await setTooth(plan.patient_id, row.tooth, row.state);
    } finally {
      toothSource = { source: "manual", itemId: null };
    }
  };

  // --- visit records ------------------------------------------------------

  const previousRecords = new Map<string, VisitRecord>();
  const prepareRecord = async (
    data: Partial<VisitRecord>,
    previous?: VisitRecord,
  ): Promise<Partial<VisitRecord>> => {
    const next = { ...previous, ...data } as VisitRecord;
    const codes = (next.diagnosis_codes ?? []).map((code) => {
      const normalized = normalizeIcdCode(String(code));
      if (!normalized) throw fail("Неверный код МКБ-10", "23514");
      return normalized;
    });
    const result: Partial<VisitRecord> = {
      ...data,
      diagnosis_codes: [...new Set(codes)],
      updated_at: new Date().toISOString(),
      updated_by: (await currentSalesId()) ?? null,
    };
    if (next.visit_id != null) {
      const visit = (await all<Visit>("visits")).find((v) =>
        same(v.id, next.visit_id),
      );
      if (!visit || !same(visit.patient_id, next.patient_id)) {
        throw fail("Визит другого пациента");
      }
      const taken = (await all<VisitRecord>("visit_records")).find(
        (record) =>
          same(record.visit_id, next.visit_id) &&
          !same(record.id, previous?.id),
      );
      if (taken) throw fail("У визита уже есть запись приёма", "23505");
      result.deal_id = visit.deal_id ?? null;
      result.doctor_id = next.doctor_id ?? visit.doctor_id ?? null;
      if (!next.record_date) {
        const day = new Date(visit.starts_at);
        const pad = (n: number) => String(n).padStart(2, "0");
        result.record_date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
      }
    }
    if (!next.record_date && !result.record_date) {
      result.record_date = new Date().toISOString().slice(0, 10);
    }
    return result;
  };

  // --- the questionnaire ----------------------------------------------------

  const checkAnswers = (
    answers: PatientQuestionnaire["answers"] | undefined,
  ) => {
    for (const [key, value] of Object.entries(answers ?? {})) {
      if (!QUESTIONS.includes(key as (typeof QUESTIONS)[number])) {
        throw fail("Неизвестный вопрос анкеты", "23514");
      }
      if (value?.answer != null && !["yes", "no"].includes(value.answer)) {
        throw fail("Ответ — да или нет", "23514");
      }
    }
  };

  const previousRows = new Map<string, Record<string, unknown>>();
  const auditRow = async (
    entity: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    fields: readonly string[],
  ) => {
    const changes = diff(before, after, fields);
    if (before && after && !Object.keys(changes).length) return;
    const row = (after ?? before)!;
    await logAudit({
      entity,
      entity_id: row.id as Identifier,
      action: !before ? "create" : !after ? "delete" : "update",
      changes: changes as AuditLogEntry["changes"],
      patient_id: row.patient_id as Identifier,
    });
  };

  /** Keeps the row before an update or a delete, for the history and the log */
  const remember = (resource: string) => async (params: any) => {
    const { data } = await baseDataProvider.getOne(resource, { id: params.id });
    previousRows.set(`${resource}:${params.id}`, data);
    return params;
  };
  const recall = (resource: string, id: Identifier) => {
    const key = `${resource}:${id}`;
    const row = previousRows.get(key) ?? null;
    previousRows.delete(key);
    return row;
  };

  const hideFromIntegrator = (resource: string): ResourceCallbacks => ({
    resource,
    afterGetList: async (result: GetListResult) => {
      if ((await myRole()) === "integrator") {
        return { ...result, data: [], total: 0 };
      }
      if (["visit_record_templates", "consent_templates"].includes(resource)) {
        return result;
      }
      // Rows of the patients the employee sees (access rights, stage 30)
      const data = [];
      for (const row of result.data) {
        if (await patientVisible(row.patient_id)) data.push(row);
      }
      return { ...result, data, total: data.length };
    },
  });

  const callbacks: ResourceCallbacks[] = [
    ...MEDICAL_RESOURCES.map(hideFromIntegrator),
    // The IIN: checked, without spaces; an empty birth date and sex from it
    {
      resource: "patients",
      beforeSave: async (data: Partial<Patient>) => {
        if (data.iin === undefined) return data;
        const raw = (data.iin ?? "").replace(/[\s-]/g, "");
        if (!raw) return { ...data, iin: null };
        const parsed = parseIin(raw);
        if (!parsed.valid) {
          throw fail("Неверный ИИН: 12 цифр с контрольной суммой");
        }
        return {
          ...data,
          iin: parsed.iin,
          birth_date: data.birth_date || parsed.birthDate,
          gender: data.gender || parsed.gender,
          card_number:
            data.card_number === undefined
              ? undefined
              : data.card_number?.trim() || null,
        };
      },
    } as ResourceCallbacks<Patient>,
    {
      resource: "patient_teeth",
      beforeCreate: async (params) => {
        await requireWriter(params.data.patient_id);
        checkTooth(params.data);
        const taken = (await all<PatientTooth>("patient_teeth")).some(
          (row) =>
            same(row.patient_id, params.data.patient_id) &&
            row.tooth === Number(params.data.tooth),
        );
        if (taken) throw fail("Состояние этого зуба уже записано", "23505");
        const now = new Date().toISOString();
        return {
          ...params,
          data: {
            ...params.data,
            tooth: Number(params.data.tooth),
            note: params.data.note?.trim() || null,
            updated_by: (await currentSalesId()) ?? null,
            updated_at: now,
            created_at: now,
          },
        };
      },
      afterCreate: async (result) => {
        await writeHistory(null, result.data as PatientTooth);
        return result;
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<PatientTooth>(
          "patient_teeth",
          { id: params.id },
        );
        await requireWriter(previous.patient_id);
        checkTooth(params.data);
        previousTeeth.set(String(params.id), previous);
        return {
          ...params,
          data: {
            ...params.data,
            note:
              params.data.note === undefined
                ? previous.note
                : params.data.note?.trim() || null,
            updated_by: (await currentSalesId()) ?? null,
            updated_at: new Date().toISOString(),
          },
        };
      },
      afterUpdate: async (result) => {
        const before = previousTeeth.get(String(result.data.id)) ?? null;
        previousTeeth.delete(String(result.data.id));
        await writeHistory(before, result.data as PatientTooth);
        return result;
      },
      beforeDelete: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<PatientTooth>(
          "patient_teeth",
          { id: params.id },
        );
        await requireWriter(previous.patient_id);
        previousTeeth.set(String(params.id), previous);
        return params;
      },
      afterDelete: async (result) => {
        const before = previousTeeth.get(String(result.data.id)) ?? null;
        previousTeeth.delete(String(result.data.id));
        if (before) await writeHistory(before, null);
        return result;
      },
    } as ResourceCallbacks<PatientTooth>,
    // A done item of a plan sets its teeth (private.handle_plan_item_tooth_state)
    {
      resource: "treatment_plan_items",
      beforeUpdate: async (params) => {
        const { data: previous } =
          await baseDataProvider.getOne<TreatmentPlanItem>(
            "treatment_plan_items",
            { id: params.id },
          );
        previousItems.set(String(params.id), previous.done);
        return params;
      },
      afterUpdate: async (result) => {
        await applyPlanItem(result.data as TreatmentPlanItem);
        return result;
      },
      afterCreate: async (result) => {
        await applyPlanItem(result.data as TreatmentPlanItem);
        return result;
      },
    } as ResourceCallbacks<TreatmentPlanItem>,
    {
      resource: "visit_records",
      beforeCreate: async (params) => {
        await requireWriter(params.data.patient_id);
        const salesId = (await currentSalesId()) ?? null;
        return {
          ...params,
          data: {
            ...(await prepareRecord(params.data)),
            created_by: salesId,
            created_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result) => {
        await auditRow("visit_record", null, result.data, RECORD_AUDITED);
        return result;
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<VisitRecord>(
          "visit_records",
          { id: params.id },
        );
        await requireWriter(previous.patient_id);
        previousRecords.set(String(params.id), previous);
        return {
          ...params,
          data: await prepareRecord(params.data, previous),
        };
      },
      afterUpdate: async (result) => {
        const before = previousRecords.get(String(result.data.id)) ?? null;
        previousRecords.delete(String(result.data.id));
        await auditRow("visit_record", before, result.data, RECORD_AUDITED);
        return result;
      },
      beforeDelete: async (params) => {
        const { data: previous } = await baseDataProvider.getOne<VisitRecord>(
          "visit_records",
          { id: params.id },
        );
        await requireDeleter(previous.created_by);
        previousRecords.set(String(params.id), previous);
        return params;
      },
      afterDelete: async (result) => {
        const before = previousRecords.get(String(result.data.id)) ?? null;
        previousRecords.delete(String(result.data.id));
        if (before)
          await auditRow("visit_record", before, null, RECORD_AUDITED);
        return result;
      },
    } as ResourceCallbacks<VisitRecord>,
    {
      resource: "visit_record_templates",
      beforeCreate: async (params) => {
        await requireWriter();
        return {
          ...params,
          data: {
            content: {},
            diagnosis_codes: [],
            position: 0,
            ...params.data,
            created_by: (await currentSalesId()) ?? null,
            created_at: new Date().toISOString(),
          },
        };
      },
      beforeUpdate: async (params) => {
        const { data } = await baseDataProvider.getOne(
          "visit_record_templates",
          {
            id: params.id,
          },
        );
        await requireDeleter(data.created_by);
        return params;
      },
      beforeDelete: async (params) => {
        const { data } = await baseDataProvider.getOne(
          "visit_record_templates",
          {
            id: params.id,
          },
        );
        await requireDeleter(data.created_by);
        return params;
      },
    },
    {
      resource: "patient_questionnaires",
      beforeCreate: async (params) => {
        await requireWriter(params.data.patient_id);
        checkAnswers(params.data.answers);
        const taken = (
          await all<PatientQuestionnaire>("patient_questionnaires")
        ).some((row) => same(row.patient_id, params.data.patient_id));
        if (taken) throw fail("Анкета пациента уже есть", "23505");
        return {
          ...params,
          data: {
            answers: {},
            ...params.data,
            updated_by: (await currentSalesId()) ?? null,
            updated_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result) => {
        await auditRow("patient_questionnaire", null, result.data, [
          "answers",
          "signed_at",
        ]);
        return result;
      },
      beforeUpdate: async (params) => {
        const { data: previous } = await baseDataProvider.getOne(
          "patient_questionnaires",
          { id: params.id },
        );
        await requireWriter(previous.patient_id);
        checkAnswers(params.data.answers);
        previousRows.set(`patient_questionnaires:${params.id}`, previous);
        return {
          ...params,
          data: {
            ...params.data,
            updated_by: (await currentSalesId()) ?? null,
            updated_at: new Date().toISOString(),
          },
        };
      },
      afterUpdate: async (result) => {
        await auditRow(
          "patient_questionnaire",
          recall("patient_questionnaires", result.data.id),
          result.data,
          ["answers", "signed_at"],
        );
        return result;
      },
    },
    {
      resource: "consent_templates",
      beforeSave: async (data: any) => {
        if (!["owner", "head"].includes(await myRole())) {
          throw fail(
            "Шаблоны согласий меняют владелец и руководитель",
            "42501",
          );
        }
        return { ...data, updated_at: new Date().toISOString() };
      },
      beforeDelete: async (params) => {
        if (!["owner", "head"].includes(await myRole())) {
          throw fail(
            "Шаблоны согласий меняют владелец и руководитель",
            "42501",
          );
        }
        return params;
      },
    },
    {
      resource: "patient_consents",
      beforeCreate: async (params) => {
        await requireWriter(params.data.patient_id);
        return {
          ...params,
          data: {
            signed_at: null,
            file_id: null,
            ...params.data,
            created_by: (await currentSalesId()) ?? null,
            created_at: new Date().toISOString(),
          },
        };
      },
      afterCreate: async (result) => {
        await auditRow("patient_consent", null, result.data, [
          "title",
          "signed_at",
        ]);
        return result;
      },
      beforeUpdate: async (params) => {
        const previous = await remember("patient_consents")(params);
        const row = previousRows.get(`patient_consents:${params.id}`);
        await requireWriter(row?.patient_id as Identifier);
        return previous;
      },
      afterUpdate: async (result) => {
        await auditRow(
          "patient_consent",
          recall("patient_consents", result.data.id),
          result.data,
          ["title", "signed_at"],
        );
        return result;
      },
      beforeDelete: async (params) => {
        const { data } = await baseDataProvider.getOne<PatientConsent>(
          "patient_consents",
          { id: params.id },
        );
        await requireDeleter(data.created_by);
        previousRows.set(`patient_consents:${params.id}`, data);
        return params;
      },
      afterDelete: async (result) => {
        const before = recall("patient_consents", result.data.id);
        if (before)
          await auditRow("patient_consent", before, null, [
            "title",
            "signed_at",
          ]);
        return result;
      },
    },
    {
      resource: "patient_files",
      beforeUpdate: async (params) => {
        const { data } = await baseDataProvider.getOne<PatientFile>(
          "patient_files",
          { id: params.id },
        );
        await requireWriter(data.patient_id);
        previousRows.set(`patient_files:${params.id}`, data);
        // Only the type, the date and the note change
        const { kind, taken_at, note } = params.data;
        return { ...params, data: { kind, taken_at, note } };
      },
      afterUpdate: async (result) => {
        await auditRow(
          "patient_file",
          recall("patient_files", result.data.id),
          result.data,
          ["kind", "taken_at", "note"],
        );
        return result;
      },
    },
  ];

  /** A file of the demo: kept in memory as a data: URL (no storage) */
  const readFile = async (file: File) => {
    const problem = validateFile(file);
    if (problem) throw new Error(`files.errors.${problem}`);
    const mime = resolveMime(file.type, file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return { path: `data:${mime};base64,${btoa(binary)}`, mime };
  };

  const methods = {
    async uploadPatientFile(
      patientId: Identifier,
      file: File,
      kind: PatientFileKind,
      extra: { taken_at?: string | null; note?: string | null } = {},
    ): Promise<PatientFile> {
      await requireWriter(patientId);
      const { path, mime } = await readFile(file);
      const { data } = await baseDataProvider.create<PatientFile>(
        "patient_files",
        {
          data: {
            patient_id: patientId,
            path,
            name: file.name,
            size: file.size,
            mime,
            kind,
            taken_at: extra.taken_at ?? null,
            note: extra.note ?? null,
            sales_id: (await currentSalesId()) ?? null,
            created_at: new Date().toISOString(),
          } as PatientFile,
        },
      );
      await auditRow("patient_file", null, data, ["name", "kind", "size"]);
      return data;
    },
    async deletePatientFile(file: PatientFile): Promise<void> {
      try {
        await requireDeleter(file.sales_id);
      } catch {
        throw new Error("files.errors.delete");
      }
      await baseDataProvider.delete("patient_files", {
        id: file.id,
        previousData: file,
      });
      await auditRow("patient_file", file, null, ["name", "kind", "size"]);
    },
  };

  return { callbacks, methods };
};
