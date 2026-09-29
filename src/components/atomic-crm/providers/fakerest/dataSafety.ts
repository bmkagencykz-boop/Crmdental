import type { DataProvider, Identifier, ResourceCallbacks } from "ra-core";

import type { MyAccessRights } from "../../access-rights/accessRights";
import {
  DEAL_HAS_PAYMENTS,
  PATIENT_DELETE_OWNER_ONLY,
  PATIENT_HAS_HISTORY,
  applyArchivedFilter,
  cardCounterStart,
  nextCardNumber,
  patientHasHistory,
} from "../../data-safety/dataSafety";
import { MEDICAL_FIELDS } from "../../treatment/medical";
import type { Deal, Patient, Sale } from "../../types";

const same = (
  a: Identifier | null | undefined,
  b: Identifier | null | undefined,
) => a != null && b != null && String(a) === String(b);

const fail = (message: string, code = "22023") =>
  Object.assign(new Error(message), { code });

/** The medical data the integrator never reads (public.patient_medical) */
const MEDICAL_COLUMNS = ["iin", ...MEDICAL_FIELDS] as const;

/** Tables that keep a patient from being deleted */
const HISTORY_TABLES = [
  "account_operations",
  "deal_payments",
  "visits",
  "visit_records",
  "treatment_plans",
  "patient_teeth",
  "patient_tooth_history",
  "patient_questionnaires",
  "patient_consents",
  "patient_files",
  "lab_orders",
] as const;

/**
 * Data safety of the demo (stage 41): the same rules as
 * supabase/schemas/41_data_safety.sql — the patient archive (the patients
 * «delete» right archives, the owner and the head restore), hard deletion
 * for the owner of a patient without history only, deals with payments
 * kept, the medical data hidden from the integrator, a unique IIN per
 * clinic, card numbers. The closed cash shifts are in payments.ts.
 */
export const createDataSafetyDemo = ({
  baseDataProvider,
  all,
  currentSalesId,
  getMyAccessRights,
}: {
  baseDataProvider: DataProvider;
  all: <T>(resource: string) => Promise<T[]>;
  currentSalesId: () => Promise<Identifier | undefined>;
  getMyAccessRights: () => Promise<MyAccessRights | null>;
}) => {
  const me = async () => {
    const id = await currentSalesId();
    return (await all<Sale>("sales")).find((sale) => same(sale.id, id));
  };
  // The demo's default user (no staff row) is the owner
  const myRole = async () => (await me())?.role ?? "owner";

  let cardCounter: number | null = null;
  const takeCardNumber = async () => {
    const patients = await all<Patient>("patients");
    if (cardCounter == null) {
      // The existing patients show their id as the card number
      cardCounter = Math.max(
        cardCounterStart(patients.map((p) => p.card_number)),
        ...patients.map((p) => Number(p.id) || 0),
      );
    }
    const { number, counter } = nextCardNumber(
      cardCounter,
      patients.map((p) => p.card_number),
    );
    cardCounter = counter;
    return number;
  };

  const requireUniqueIin = async (
    iin: string | null | undefined,
    patientId?: Identifier,
  ) => {
    iin = iin?.replace(/[\s-]/g, "");
    if (!iin) return;
    const taken = (await all<Patient>("patients")).some(
      (p) => p.iin === iin && !same(p.id, patientId),
    );
    if (taken) {
      throw fail(`Пациент с ИИН ${iin} уже есть в клинике`, "23505");
    }
  };

  /** The patients «delete» right on this patient (all, or own) */
  const canArchive = async (patient: Patient) => {
    const role = await myRole();
    if (role === "owner") return true;
    if (role === "integrator") return false;
    const scope = (await getMyAccessRights())?.rights.patients.delete;
    if (scope === "all") return true;
    if (scope !== "own") return false;
    const salesId = await currentSalesId();
    return (
      same(patient.sales_id, salesId) ||
      (await all<Deal>("deals")).some(
        (deal) =>
          same(deal.patient_id, patient.id) && same(deal.sales_id, salesId),
      )
    );
  };

  const checkPatientDelete = async (id: Identifier) => {
    if ((await myRole()) !== "owner") {
      throw fail(PATIENT_DELETE_OWNER_ONLY, "42501");
    }
    const rows = Object.fromEntries(
      await Promise.all(
        HISTORY_TABLES.map(
          async (table) =>
            [table, await all<any>(table).catch(() => [] as any[])] as const,
        ),
      ),
    );
    const dealIds = (await all<Deal>("deals"))
      .filter((deal) => same(deal.patient_id, id))
      .map((deal) => deal.id);
    if (patientHasHistory(id, rows, dealIds)) {
      throw fail(PATIENT_HAS_HISTORY, "23503");
    }
  };

  const checkDealDelete = async (id: Identifier) => {
    const [payments, ops] = await Promise.all([
      all<{ deal_id: Identifier }>("deal_payments").catch(() => []),
      all<{ deal_id?: Identifier | null }>("account_operations").catch(
        () => [],
      ),
    ]);
    if (
      payments.some((p) => same(p.deal_id, id)) ||
      ops.some((op) => same(op.deal_id, id))
    ) {
      throw fail(DEAL_HAS_PAYMENTS, "23503");
    }
  };

  /** patients_summary without the medical data for the integrator */
  const hideMedical = async <T extends Record<string, any>>(rows: T[]) => {
    if ((await myRole()) !== "integrator") return rows;
    return rows.map((row) => ({
      ...row,
      ...Object.fromEntries(MEDICAL_COLUMNS.map((column) => [column, null])),
    }));
  };

  const callbacks: ResourceCallbacks[] = [
    {
      resource: "patients",
      // Archived patients only with the «Архив» filter
      beforeGetList: async (params) => applyArchivedFilter(params),
      beforeCreate: async (params) => {
        const data = { ...params.data };
        await requireUniqueIin(data.iin);
        if (!String(data.card_number ?? "").trim()) {
          data.card_number = await takeCardNumber();
        }
        data.archived_at = null;
        data.archived_by = null;
        return { ...params, data };
      },
      beforeUpdate: async (params) => {
        const data = { ...params.data };
        const previous = (await all<Patient>("patients")).find((p) =>
          same(p.id, params.id),
        );
        if (!previous) return params;
        if (
          data.iin !== undefined &&
          (data.iin ?? "").replace(/[\s-]/g, "") !== (previous.iin ?? "")
        ) {
          await requireUniqueIin(data.iin, previous.id);
        }
        if (
          data.archived_at !== undefined &&
          !!data.archived_at !== !!previous.archived_at
        ) {
          if (data.archived_at) {
            if (!(await canArchive(previous))) {
              throw fail("Нет права переместить пациента в архив", "42501");
            }
            data.archived_at = new Date().toISOString();
            data.archived_by = (await currentSalesId()) ?? null;
          } else {
            if (!["owner", "head"].includes(await myRole())) {
              throw fail(
                "Вернуть пациента из архива могут владелец или руководитель",
                "42501",
              );
            }
            data.archived_by = null;
          }
        } else {
          data.archived_at = previous.archived_at ?? null;
          data.archived_by = previous.archived_by ?? null;
        }
        return { ...params, data };
      },
      // Bulk «В архив» / «Вернуть из архива» of the patient list
      beforeUpdateMany: async (params) => {
        if (params.data?.archived_at === undefined) return params;
        const patients = await all<Patient>("patients");
        const archive = !!params.data.archived_at;
        for (const id of params.ids) {
          const patient = patients.find((p) => same(p.id, id));
          if (!patient) continue;
          if (archive && !(await canArchive(patient))) {
            throw fail("Нет права переместить пациента в архив", "42501");
          }
          if (!archive && !["owner", "head"].includes(await myRole())) {
            throw fail(
              "Вернуть пациента из архива могут владелец или руководитель",
              "42501",
            );
          }
        }
        return {
          ...params,
          data: {
            ...params.data,
            archived_at: archive ? new Date().toISOString() : null,
            archived_by: archive ? ((await currentSalesId()) ?? null) : null,
          },
        };
      },
      beforeDelete: async (params) => {
        await checkPatientDelete(params.id);
        return params;
      },
      beforeDeleteMany: async (params) => {
        for (const id of params.ids) await checkPatientDelete(id);
        return params;
      },
    } as ResourceCallbacks<Patient>,
    {
      resource: "deals",
      beforeDelete: async (params) => {
        await checkDealDelete(params.id);
        return params;
      },
      beforeDeleteMany: async (params) => {
        for (const id of params.ids) await checkDealDelete(id);
        return params;
      },
    } as ResourceCallbacks<Deal>,
  ];

  return {
    callbacks,
    hideMedical,
    /** For the tests */
    resetCardCounter: () => {
      cardCounter = null;
    },
    baseDataProvider,
  };
};
