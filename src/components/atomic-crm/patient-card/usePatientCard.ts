import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useDataProvider,
  useGetList,
  useNotify,
  type Identifier,
} from "ra-core";

import { useMyAccessRights } from "../access-rights/useAccessRights";
import type { CrmDataProvider } from "../providers/types";
import type { TreatmentPlanItem, TreatmentStage } from "../treatment/types";
import { usePlans } from "../treatment/useTreatmentPlans";
import type {
  ConsentTemplate,
  PatientConsent,
  PatientFile,
  PatientFileKind,
  PatientQuestionnaire,
  PatientTooth,
  ToothHistoryRow,
  VisitRecord,
  VisitRecordTemplate,
} from "./types";

const ALL = { page: 1, perPage: 1000 };

/**
 * Who does what with the medical data (stage 37, the same rules as the
 * database): everybody who sees the patient reads it, but not the
 * integrator; the owner, the head and the managers write it; the owner, the
 * head or the author delete a record, a consent or a file; consent
 * templates are the owner's and the head's.
 */
export const useMedicalRights = () => {
  const { data, isPending } = useMyAccessRights();
  const role = data?.role;
  const me = data?.sales_id ?? null;
  const canEdit = role === "owner" || role === "head" || role === "manager";
  const chief = role === "owner" || role === "head";
  return {
    isPending,
    me,
    canSee: !!role && role !== "integrator",
    canEdit,
    canEditTemplates: chief,
    canDelete: (authorId: Identifier | null | undefined) =>
      chief ||
      (role === "manager" &&
        authorId != null &&
        me != null &&
        String(authorId) === String(me)),
  };
};

const usePatientList = <T>(
  resource: string,
  patientId: Identifier,
  sort: { field: string; order: "ASC" | "DESC" },
  enabled = true,
) =>
  useGetList<T & { id: Identifier }>(
    resource,
    { filter: { patient_id: patientId }, sort, pagination: ALL },
    { enabled },
  );

export const usePatientTeeth = (patientId: Identifier, enabled = true) =>
  usePatientList<PatientTooth>(
    "patient_teeth",
    patientId,
    { field: "tooth", order: "ASC" },
    enabled,
  );

export const useToothHistory = (patientId: Identifier, enabled = true) =>
  usePatientList<ToothHistoryRow>(
    "patient_tooth_history",
    patientId,
    { field: "created_at", order: "DESC" },
    enabled,
  );

export const useVisitRecords = (patientId: Identifier, enabled = true) =>
  usePatientList<VisitRecord>(
    "visit_records",
    patientId,
    { field: "record_date", order: "DESC" },
    enabled,
  );

export const usePatientFiles = (patientId: Identifier, enabled = true) =>
  usePatientList<PatientFile>(
    "patient_files",
    patientId,
    { field: "created_at", order: "DESC" },
    enabled,
  );

export const usePatientConsents = (patientId: Identifier, enabled = true) =>
  usePatientList<PatientConsent>(
    "patient_consents",
    patientId,
    { field: "created_at", order: "DESC" },
    enabled,
  );

export const useQuestionnaire = (patientId: Identifier, enabled = true) => {
  const result = usePatientList<PatientQuestionnaire>(
    "patient_questionnaires",
    patientId,
    { field: "id", order: "ASC" },
    enabled,
  );
  return { ...result, questionnaire: result.data?.[0] };
};

export const useRecordTemplates = (enabled = true) =>
  useGetList<VisitRecordTemplate>(
    "visit_record_templates",
    { sort: { field: "position", order: "ASC" }, pagination: ALL },
    { enabled },
  );

export const useConsentTemplates = (enabled = true) =>
  useGetList<ConsentTemplate>(
    "consent_templates",
    { sort: { field: "position", order: "ASC" }, pagination: ALL },
    { enabled },
  );

/** Everything the medical writes change */
const TOUCHED = [
  "patient_teeth",
  "patient_tooth_history",
  "visit_records",
  "patient_files",
  "patient_consents",
  "patient_questionnaires",
  "audit_log",
];

export const useRefreshPatientCard = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      TOUCHED.map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
};

/** Uploads files of one type one after another; each failure is reported */
export const useUploadPatientFiles = (patientId: Identifier) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshPatientCard();
  const notify = useNotify();
  return useMutation({
    mutationFn: async ({
      files,
      kind,
      takenAt,
    }: {
      files: File[];
      kind: PatientFileKind;
      takenAt?: string | null;
    }) => {
      let uploaded = 0;
      for (const file of files) {
        try {
          await dataProvider.uploadPatientFile(patientId, file, kind, {
            taken_at: takenAt ?? null,
          });
          uploaded++;
        } catch (error) {
          notify((error as Error).message || "files.errors.upload", {
            type: "error",
            messageArgs: { name: file.name },
          });
        }
      }
      return uploaded;
    },
    onSuccess: (uploaded) => {
      refresh();
      if (uploaded) {
        notify("files.uploaded", {
          type: "info",
          messageArgs: { smart_count: uploaded },
        });
      }
    },
  });
};

export const useDeletePatientFile = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const refresh = useRefreshPatientCard();
  const notify = useNotify();
  return useMutation({
    mutationFn: (file: PatientFile) => dataProvider.deletePatientFile(file),
    onSuccess: () => {
      refresh();
      notify("files.deleted", { type: "info" });
    },
    onError: (error: Error) =>
      notify(error.message || "files.errors.delete", { type: "error" }),
  });
};

/** Items and stages of all the plans of the patient */
export const usePatientPlanItems = (patientId: Identifier) => {
  const { data: plans = [] } = usePlans({ patient_id: patientId });
  const ids = plans.map((plan) => plan.id).join(",");
  const { data: items = [] } = useGetList<TreatmentPlanItem>(
    "treatment_plan_items",
    {
      filter: { "plan_id@in": `(${ids})` },
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 2000 },
    },
    { enabled: plans.length > 0 },
  );
  const { data: stages = [] } = useGetList<TreatmentStage>(
    "treatment_stages",
    {
      filter: { "plan_id@in": `(${ids})` },
      sort: { field: "position", order: "ASC" },
      pagination: { page: 1, perPage: 500 },
    },
    { enabled: plans.length > 0 },
  );
  return { plans, items: plans.length ? items : [], stages };
};
