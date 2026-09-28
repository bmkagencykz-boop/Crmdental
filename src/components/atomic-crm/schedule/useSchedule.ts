import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDataProvider, useGetList, type Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";
import { clinicHours } from "./scheduleLayout";
import type {
  Chair,
  DoctorException,
  ScheduleSettingsPatch,
  Visit,
} from "./types";

const EMPTY: never[] = [];

/** Settings of the schedule (clinic hours, mapping, keywords, MIS mode) */
export const useScheduleSettings = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const query = useQuery({
    queryKey: ["schedule_settings"],
    queryFn: () => dataProvider.getScheduleSettings(),
    staleTime: 60 * 1000,
  });
  return {
    ...query,
    hours: clinicHours(query.data),
    /** The MIS keeps the schedule: visits are read-only */
    misKind: query.data?.mis_kind ?? null,
  };
};

export const useSaveScheduleSettings = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: ScheduleSettingsPatch) =>
      dataProvider.saveScheduleSettings(patch),
    onSuccess: (data) => queryClient.setQueryData(["schedule_settings"], data),
  });
};

/** Dictionary «Кресла», in order */
export const useChairs = () => {
  const { data, isPending } = useGetList<Chair>(
    "chairs",
    {
      pagination: { page: 1, perPage: 200 },
      sort: { field: "position", order: "ASC" },
    },
    { staleTime: 5 * 60 * 1000 },
  );
  return { data: data ?? (EMPTY as Chair[]), isPending };
};

/** Day exceptions of the doctors between two days (included) */
export const useDoctorExceptions = (from?: string, to?: string) => {
  const { data, isPending } = useGetList<DoctorException>(
    "doctor_exceptions",
    {
      pagination: { page: 1, perPage: 500 },
      sort: { field: "day", order: "ASC" },
      filter: {
        ...(from ? { "day@gte": from } : {}),
        ...(to ? { "day@lte": to } : {}),
      },
    },
    { staleTime: 60 * 1000 },
  );
  return { data: data ?? (EMPTY as DoctorException[]), isPending };
};

/** Visits starting in [from, to) */
export const useVisits = (
  from: Date,
  to: Date,
  extra: Record<string, unknown> = {},
  enabled = true,
) => {
  const { data, isPending, refetch } = useGetList<Visit>(
    "visits",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "starts_at", order: "ASC" },
      filter: {
        "starts_at@gte": from.toISOString(),
        "starts_at@lt": to.toISOString(),
        ...extra,
      },
    },
    { enabled },
  );
  return { data: data ?? (EMPTY as Visit[]), isPending, refetch };
};

/** Visits of a deal or of a patient, newest first */
export const useVisitsOf = (
  field: "deal_id" | "patient_id",
  id: Identifier | undefined,
) => {
  const { data, isPending } = useGetList<Visit>(
    "visits",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "starts_at", order: "DESC" },
      filter: { [field]: id },
    },
    { enabled: id != null },
  );
  return { data: data ?? (EMPTY as Visit[]), isPending };
};

/** Busy time of the visits of deals the employee does not see */
export const useScheduleBusy = (from: Date, to: Date) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { data } = useQuery({
    queryKey: ["schedule_busy", from.toISOString(), to.toISOString()],
    queryFn: () =>
      dataProvider.getScheduleBusy(from.toISOString(), to.toISOString()),
    staleTime: 30 * 1000,
  });
  return data ?? EMPTY;
};
