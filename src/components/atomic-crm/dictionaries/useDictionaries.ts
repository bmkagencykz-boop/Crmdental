import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useGetList, type Identifier } from "ra-core";

import type { CrmDataProvider } from "../providers/types";

import type {
  Doctor,
  LeadSource,
  LostReason,
  Pipeline,
  Service,
  Stage,
} from "../types";

// Dictionaries change rarely: cache them for a few minutes
const options = { staleTime: 5 * 60 * 1000 };
const all = { page: 1, perPage: 500 };
const byPosition = { field: "position", order: "ASC" as const };
// A stable empty list while loading: callers memoize on it
const EMPTY: never[] = [];

const useDictionary = <T extends { id: Identifier }>(resource: string) => {
  const { data, isPending } = useGetList<T>(
    resource,
    { pagination: all, sort: byPosition },
    options,
  );
  return { data: data ?? (EMPTY as T[]), isPending };
};

export const usePipelines = () => useDictionary<Pipeline>("pipelines");
export const useStages = () => useDictionary<Stage>("stages");
export const useServices = () => useDictionary<Service>("services");
export const useLeadSources = () => useDictionary<LeadSource>("lead_sources");
export const useLostReasons = () => useDictionary<LostReason>("lost_reasons");
export const useDoctors = () => useDictionary<Doctor>("doctors");

/** Clinic rules (Settings → Access) */
export const useOrganizationSettings = () => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  return useQuery({
    queryKey: ["organization_settings"],
    queryFn: () => dataProvider.getOrganizationSettings(),
  });
};

/** The pipeline shown by default: the one flagged default, else the first */
export const getDefaultPipeline = (pipelines: Pipeline[]) =>
  pipelines.find((pipeline) => pipeline.is_default) ?? pipelines[0];

/** Stages of a pipeline, in board order */
export const getPipelineStages = (
  stages: Stage[],
  pipelineId: Identifier | undefined,
) =>
  stages
    .filter((stage) => String(stage.pipeline_id) === String(pipelineId))
    .sort((a, b) => a.position - b.position || Number(a.id) - Number(b.id));

export const findById = <T extends { id: Identifier }>(
  items: T[],
  id: Identifier | null | undefined,
) =>
  id == null ? undefined : items.find((item) => String(item.id) === String(id));

/** Choices for a select input, archived entries hidden unless selected */
export const toChoices = <
  T extends { id: Identifier; name: string; is_archived?: boolean },
>(
  items: T[],
  selected?: Identifier | null,
) =>
  items
    .filter((item) => !item.is_archived || String(item.id) === String(selected))
    .map((item) => ({ id: item.id, name: item.name }));

/** Doctor choices: inactive doctors hidden unless selected */
export const toDoctorChoices = (
  doctors: Doctor[],
  selected?: Identifier | null,
) =>
  doctors
    .filter(
      (doctor) => doctor.is_active || String(doctor.id) === String(selected),
    )
    .map((doctor) => ({ id: doctor.id, name: doctor.name }));
